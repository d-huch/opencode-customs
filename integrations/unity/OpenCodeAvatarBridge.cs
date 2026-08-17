using System;
using System.Collections;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Events;

namespace OpenCode.Customs
{
    [Serializable] public sealed class OpenCodeStringEvent : UnityEvent<string> { }

    public sealed class OpenCodeAvatarBridge : MonoBehaviour
    {
        [Header("Paste from OpenCode Customs > Settings > Avatar & VR")]
        [TextArea(4, 10)] public string pairingJson;
        public string clientID = "unity-vr";
        public string characterID = "assistant";

        [Header("Optional existing OpenCode selection")]
        public string sessionID;
        public string providerID;
        public string modelID;

        [Header("Optional voice returned to Unity")]
        public bool receiveVoice;
        public string voiceProvider = "fish-local";
        public string fishPresetID;
        public string voiceEndpoint = "http://127.0.0.1:8080/v1/tts";
        public string voiceModel = "fish-speech-s2-pro";
        public string voiceName = "default";
        public string voiceMode = "quality";

        [Header("Character")]
        public Animator animator;
        public AudioSource audioSource;
        public Transform characterRoot;
        public float defaultMoveSpeed = 1.5f;

        [Header("Events")]
        public OpenCodeStringEvent onConnected;
        public OpenCodeStringEvent onAssistantText;
        public OpenCodeStringEvent onError;

        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        ClientWebSocket socket;
        CancellationTokenSource lifetime;
        Vector3? moveTarget;
        float moveSpeed;

        async void Start()
        {
            try
            {
                await ConnectAsync();
            }
            catch (Exception error)
            {
                mainThread.Enqueue(() => onError?.Invoke(error.Message));
            }
        }

        void Update()
        {
            while (mainThread.TryDequeue(out var action)) action();
            if (!moveTarget.HasValue || characterRoot == null) return;
            characterRoot.position = Vector3.MoveTowards(
                characterRoot.position,
                moveTarget.Value,
                Mathf.Max(0.01f, moveSpeed) * Time.deltaTime
            );
            if (Vector3.Distance(characterRoot.position, moveTarget.Value) < 0.01f) moveTarget = null;
        }

        async void OnDestroy()
        {
            lifetime?.Cancel();
            if (socket != null && socket.State == WebSocketState.Open)
            {
                try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Unity stopped", CancellationToken.None); }
                catch { }
            }
            socket?.Dispose();
            lifetime?.Dispose();
            sendLock.Dispose();
        }

        public async Task ConnectAsync()
        {
            var pairing = JsonUtility.FromJson<Pairing>(pairingJson);
            if (pairing == null || string.IsNullOrWhiteSpace(pairing.url) || string.IsNullOrWhiteSpace(pairing.token))
                throw new InvalidOperationException("Paste valid Avatar & VR pairing JSON from OpenCode Customs settings.");

            lifetime = new CancellationTokenSource();
            socket = new ClientWebSocket();
            await socket.ConnectAsync(new Uri(pairing.url), lifetime.Token);
            await SendAsync(new Hello
            {
                type = "hello",
                protocol = 1,
                token = pairing.token,
                clientID = clientID,
                characterID = characterID,
                sessionID = EmptyToNull(sessionID),
                model = string.IsNullOrWhiteSpace(providerID) || string.IsNullOrWhiteSpace(modelID)
                    ? null
                    : new Model { providerID = providerID, id = modelID },
                actions = new[] { "animation.trigger", "emotion.set", "gesture.play", "look_at", "move_to", "speech.stop" },
                voice = receiveVoice ? new Voice
                {
                    provider = voiceProvider,
                    fishPresetID = EmptyToNull(fishPresetID),
                    endpoint = voiceEndpoint,
                    model = voiceModel,
                    voice = voiceName,
                    mode = voiceMode,
                } : null,
            }, lifetime.Token);
            _ = ReceiveLoop(lifetime.Token);
        }

        // Connect this method to the final transcript event of your VR microphone/STT component.
        public async void SubmitTranscript(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            if (socket == null || socket.State != WebSocketState.Open)
            {
                onError?.Invoke("Avatar Bridge is not connected.");
                return;
            }
            try
            {
                await SendAsync(new Transcript
                {
                    type = "user.transcript",
                    requestID = Guid.NewGuid().ToString("N"),
                    text = text.Trim(),
                }, lifetime.Token);
            }
            catch (Exception error)
            {
                mainThread.Enqueue(() => onError?.Invoke(error.Message));
            }
        }

        async Task ReceiveLoop(CancellationToken cancellation)
        {
            var buffer = new byte[64 * 1024];
            while (!cancellation.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                using var message = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellation);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    message.Write(buffer, 0, result.Count);
                    if (message.Length > 32 * 1024 * 1024) throw new InvalidDataException("Avatar Bridge message exceeded 32 MB.");
                } while (!result.EndOfMessage);
                HandleMessage(Encoding.UTF8.GetString(message.ToArray()), cancellation);
            }
        }

        void HandleMessage(string json, CancellationToken cancellation)
        {
            var envelope = JsonUtility.FromJson<Envelope>(json);
            if (envelope == null) return;
            switch (envelope.type)
            {
                case "welcome":
                    var welcome = JsonUtility.FromJson<Welcome>(json);
                    if (!string.IsNullOrWhiteSpace(welcome.sessionID)) sessionID = welcome.sessionID;
                    mainThread.Enqueue(() => onConnected?.Invoke(welcome.characterID));
                    return;
                case "assistant.text":
                    var text = JsonUtility.FromJson<AssistantText>(json);
                    if (!string.IsNullOrWhiteSpace(text.sessionID)) sessionID = text.sessionID;
                    mainThread.Enqueue(() => onAssistantText?.Invoke(text.text));
                    return;
                case "assistant.audio":
                    var audio = JsonUtility.FromJson<AssistantAudio>(json);
                    _ = DecodeAndPlay(audio.data);
                    return;
                case "assistant.error":
                    var error = JsonUtility.FromJson<AssistantError>(json);
                    mainThread.Enqueue(() => onError?.Invoke(error.error));
                    return;
                case "character.action":
                    var action = JsonUtility.FromJson<CharacterAction>(json);
                    mainThread.Enqueue(() => ExecuteAction(action, cancellation));
                    return;
            }
        }

        void ExecuteAction(CharacterAction action, CancellationToken cancellation)
        {
            var ok = true;
            var message = "completed";
            try
            {
                switch (action.action)
                {
                    case "animation.trigger": animator.SetTrigger(action.name); break;
                    case "gesture.play": animator.SetTrigger(action.name); break;
                    case "emotion.set": animator.SetTrigger("Emotion_" + action.emotion); break;
                    case "look_at":
                        if (characterRoot == null) throw new InvalidOperationException("Character root is not assigned.");
                        characterRoot.LookAt(ToVector(action.target));
                        break;
                    case "move_to":
                        moveTarget = ToVector(action.position);
                        moveSpeed = action.speed > 0 ? action.speed : defaultMoveSpeed;
                        break;
                    case "speech.stop": audioSource?.Stop(); break;
                    default: throw new InvalidOperationException("Unsupported action: " + action.action);
                }
            }
            catch (Exception error)
            {
                ok = false;
                message = error.Message;
            }
            _ = SendAsync(new ActionResult
            {
                type = "character.action.result",
                id = action.id,
                ok = ok,
                message = message,
            }, cancellation);
        }

        async Task DecodeAndPlay(string base64)
        {
            try
            {
                var wav = await Task.Run(() => Wav.Decode(Convert.FromBase64String(base64)));
                mainThread.Enqueue(() =>
                {
                    if (audioSource == null) return;
                    var clip = AudioClip.Create("OpenCode Agent", wav.samples.Length / wav.channels, wav.channels, wav.rate, false);
                    clip.SetData(wav.samples, 0);
                    audioSource.clip = clip;
                    audioSource.Play();
                });
            }
            catch (Exception error)
            {
                mainThread.Enqueue(() => onError?.Invoke("Could not play agent voice: " + error.Message));
            }
        }

        async Task SendAsync(object value, CancellationToken cancellation)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonUtility.ToJson(value));
            await sendLock.WaitAsync(cancellation);
            try { await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellation); }
            finally { sendLock.Release(); }
        }

        static Vector3 ToVector(BridgeVector value) => new Vector3(value.x, value.y, value.z);
        static string EmptyToNull(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

        [Serializable] sealed class Pairing { public string url; public string token; public int protocol; }
        [Serializable] sealed class Envelope { public string type; }
        [Serializable] sealed class Model { public string providerID; public string id; }
        [Serializable] sealed class Voice
        {
            public string provider; public string fishPresetID; public string endpoint; public string model; public string voice; public string mode;
        }
        [Serializable] sealed class Hello
        {
            public string type; public int protocol; public string token; public string clientID; public string characterID;
            public string sessionID; public string[] actions; public Model model; public Voice voice;
        }
        [Serializable] sealed class Transcript { public string type; public string requestID; public string text; }
        [Serializable] sealed class Welcome { public string type; public string characterID; public string sessionID; }
        [Serializable] sealed class AssistantText { public string type; public string text; public string sessionID; }
        [Serializable] sealed class AssistantAudio { public string type; public string data; }
        [Serializable] sealed class AssistantError { public string type; public string error; }
        [Serializable] sealed class BridgeVector { public float x; public float y; public float z; }
        [Serializable] sealed class CharacterAction
        {
            public string type; public string id; public string action; public string name; public string emotion;
            public BridgeVector position; public BridgeVector target; public float speed;
        }
        [Serializable] sealed class ActionResult { public string type; public string id; public bool ok; public string message; }
    }

    static class Wav
    {
        internal sealed class Data { public float[] samples; public int channels; public int rate; }

        internal static Data Decode(byte[] bytes)
        {
            using var stream = new MemoryStream(bytes);
            using var reader = new BinaryReader(stream);
            if (new string(reader.ReadChars(4)) != "RIFF") throw new InvalidDataException("Not a RIFF WAV file.");
            reader.ReadInt32();
            if (new string(reader.ReadChars(4)) != "WAVE") throw new InvalidDataException("Not a WAVE file.");
            short format = 0, channels = 0, bits = 0;
            var rate = 0;
            byte[] audio = null;
            while (stream.Position + 8 <= stream.Length)
            {
                var chunk = new string(reader.ReadChars(4));
                var size = reader.ReadInt32();
                if (chunk == "fmt ")
                {
                    format = reader.ReadInt16(); channels = reader.ReadInt16(); rate = reader.ReadInt32();
                    reader.ReadInt32(); reader.ReadInt16(); bits = reader.ReadInt16();
                    stream.Position += size - 16;
                }
                else if (chunk == "data") audio = reader.ReadBytes(size);
                else stream.Position += size;
            }
            if (audio == null || channels < 1 || rate < 1) throw new InvalidDataException("WAV data chunk is missing.");
            var count = audio.Length / (bits / 8);
            var samples = new float[count];
            if (format == 1 && bits == 16)
                for (var index = 0; index < count; index++) samples[index] = BitConverter.ToInt16(audio, index * 2) / 32768f;
            else if (format == 3 && bits == 32)
                for (var index = 0; index < count; index++) samples[index] = BitConverter.ToSingle(audio, index * 4);
            else throw new InvalidDataException($"Unsupported WAV encoding {format}/{bits}.");
            return new Data { samples = samples, channels = channels, rate = rate };
        }
    }
}
