using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Events;

namespace OpenCode.Customs.AvatarBridge
{
    [Serializable] public sealed class AvatarStringEvent : UnityEvent<string> { }
    [Serializable] public sealed class AvatarApprovalEvent : UnityEvent<string, string, string> { }
    [Serializable] public sealed class AvatarVisemeEvent : UnityEvent<string, float> { }
    [Serializable] public sealed class AvatarEmotionEvent : UnityEvent<string, float> { }

    public sealed class OpenCodeAvatarBridgeV2 : MonoBehaviour
    {
        [Header("Connection copied from OpenCode Customs > Avatar & VR")]
        [TextArea(5, 14)] public string connectionJson;
        public bool connectOnStart = true;

        [Header("World and capabilities")]
        public AvatarCapabilityRegistry capabilityRegistry;
        public AvatarWorldSensor worldSensor;

        [Header("Voice")]
        public bool receiveVoice;
        public AudioSource audioSource;
        public string voiceProvider = "fish-local";
        public string fishPresetID;
        public string voiceEndpoint = "http://127.0.0.1:8080/v1/tts";
        public string voiceModel = "fish-speech-s2-pro";
        public string voiceName = "default";

        [Header("Events")]
        public AvatarStringEvent onConnected;
        public AvatarStringEvent onAssistantText;
        public AvatarStringEvent onError;
        public AvatarApprovalEvent onApprovalRequested;
        public AvatarStringEvent onGoalChanged;
        public AvatarVisemeEvent onViseme;
        public AvatarEmotionEvent onSpeechEmotion;
        public AvatarStringEvent onAssistantState;

        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        readonly Dictionary<string, CancellationTokenSource> activeActions = new Dictionary<string, CancellationTokenSource>();
        readonly Dictionary<string, AvatarActionResult> completedActions = new Dictionary<string, AvatarActionResult>();
        readonly MemoryStream audioBuffer = new MemoryStream();
        CancellationTokenSource lifetime;
        IAvatarTransport transport;
        AvatarConnectionProfile profile;
        ApprovalRequest currentApproval;
        long lastServerSequence;
        string audioContentType;
        string currentRequestID;
        VisemeCue[] pendingVisemes = Array.Empty<VisemeCue>();
        int reconnectAttempt;

        public bool IsConnected => transport != null && transport.State == WebSocketState.Open;
        public string CurrentGoal { get; private set; }
        public AgentGoalState CurrentGoalState { get; private set; }
        public string LastAction { get; private set; }
        public long LastActionLatencyMs { get; private set; }
        public ApprovalRequest CurrentApproval => currentApproval;

        async void Start()
        {
            if (!connectOnStart) return;
            try { await ConnectAsync(); }
            catch (Exception error) { RaiseError(error.Message); }
        }

        void Update()
        {
            while (mainThread.TryDequeue(out var action)) action();
        }

        async void OnDestroy()
        {
            lifetime?.Cancel();
            foreach (var action in activeActions.Values) action.Cancel();
            if (transport != null)
            {
                try { await transport.CloseAsync(CancellationToken.None); } catch { }
                transport.Dispose();
            }
            lifetime?.Dispose();
            audioBuffer.Dispose();
        }

        public async Task ConnectAsync()
        {
            profile = Newtonsoft.Json.JsonConvert.DeserializeObject<AvatarConnectionProfile>(connectionJson);
            if (profile == null || string.IsNullOrWhiteSpace(profile.url) || string.IsNullOrWhiteSpace(profile.token))
                throw new InvalidOperationException("Paste valid protocol v2 connection JSON from OpenCode Customs settings.");
            profile.clientID = AvatarIDs.Normalize(profile.clientID, "unity-vr");
            profile.characterID = AvatarIDs.Normalize(profile.characterID, "assistant");
            profile.gameID = AvatarIDs.Normalize(profile.gameID, "game");
            profile.saveSlotID = AvatarIDs.Normalize(profile.saveSlotID, "default");
            if (capabilityRegistry == null) capabilityRegistry = GetComponentInChildren<AvatarCapabilityRegistry>();
            if (worldSensor == null) worldSensor = GetComponentInChildren<AvatarWorldSensor>();
            lifetime?.Cancel();
            lifetime = new CancellationTokenSource();
            ConfigureSensor();
            _ = ConnectionLoop(lifetime.Token);
            await Task.Yield();
        }

        public async void SubmitSpeechStart(string requestID)
        {
            currentRequestID = string.IsNullOrWhiteSpace(requestID) ? Guid.NewGuid().ToString("N") : requestID;
            audioSource?.Stop();
            CancelActiveActions();
            await SendAsync(new { type = "speech.start", requestID = currentRequestID });
        }

        public async void SubmitSpeechPartial(string text)
        {
            if (string.IsNullOrWhiteSpace(currentRequestID) || string.IsNullOrWhiteSpace(text)) return;
            await SendAsync(new { type = "speech.partial", requestID = currentRequestID, text });
        }

        public async void SubmitSpeechFinal(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            if (string.IsNullOrWhiteSpace(currentRequestID)) currentRequestID = Guid.NewGuid().ToString("N");
            await SendAsync(new { type = "speech.final", requestID = currentRequestID, text = text.Trim() });
        }

        public async void CancelSpeech()
        {
            if (string.IsNullOrWhiteSpace(currentRequestID)) return;
            audioSource?.Stop();
            await SendAsync(new { type = "speech.cancel", requestID = currentRequestID });
        }

        public async void ResolveCurrentApproval(bool approved)
        {
            var approval = currentApproval;
            if (approval == null) return;
            currentApproval = null;
            await SendAsync(new { type = "approval.result", id = approval.id, approved, source = "vr" });
        }

        public void ResolveApprovalByVoice(string finalTranscript)
        {
            if (currentApproval == null || string.IsNullOrWhiteSpace(finalTranscript)) return;
            var normalized = finalTranscript.Trim().ToLowerInvariant();
            if (normalized == "yes" || normalized == "allow" || normalized == "так" || normalized == "дозволяю") ResolveCurrentApproval(true);
            if (normalized == "no" || normalized == "deny" || normalized == "ні" || normalized == "відхилити") ResolveCurrentApproval(false);
        }

        async Task ConnectionLoop(CancellationToken cancellation)
        {
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    transport?.Dispose();
                    transport = AvatarTransportFactory.Create();
                    await transport.ConnectAsync(new Uri(profile.url), profile.certificateFingerprint, cancellation);
                    reconnectAttempt = 0;
                    await SendHello();
                    await ReceiveLoop(cancellation);
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return; }
                catch (Exception error) { RaiseError("Avatar Bridge disconnected: " + error.Message); }
                reconnectAttempt++;
                var delay = Mathf.Min(15f, Mathf.Pow(2f, Mathf.Min(reconnectAttempt, 4)));
                await Task.Delay(TimeSpan.FromSeconds(delay), cancellation);
            }
        }

        async Task SendHello()
        {
            await SendAsync(new
            {
                type = "hello", protocol = AvatarProtocol.Version, protocolMinor = AvatarProtocol.Minor, token = profile.token,
                clientID = profile.clientID, characterID = profile.characterID,
                gameID = profile.gameID, saveSlotID = profile.saveSlotID, sessionID = profile.sessionID,
                resumeSequence = lastServerSequence,
                actions = new[] { "animation.trigger", "emotion.set", "gesture.play", "look_at", "move_to", "speech.stop" },
                voice = receiveVoice ? new
                {
                    provider = voiceProvider, fishPresetID, endpoint = voiceEndpoint, model = voiceModel,
                    voice = voiceName, mode = "quality", streaming = true,
                } : null,
            });
        }

        async Task ReceiveLoop(CancellationToken cancellation)
        {
            while (!cancellation.IsCancellationRequested && transport.State == WebSocketState.Open)
            {
                var message = await transport.ReceiveAsync(cancellation);
                if (message == null) return;
                if (message.binary) { HandleAudioChunk(message.data); continue; }
                if (System.Text.Encoding.UTF8.GetByteCount(message.text) > AvatarProtocol.MaxPayloadBytes) throw new InvalidDataException("Avatar Bridge JSON payload exceeded 64 KB.");
                HandleMessage(AvatarJson.Parse(message.text));
            }
        }

        void HandleMessage(JObject message)
        {
            var sequence = message.Value<long?>("sequence");
            if (sequence.HasValue)
            {
                if (sequence.Value <= lastServerSequence) return;
                lastServerSequence = sequence.Value;
            }
            switch (message.Value<string>("type"))
            {
                case "welcome":
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    mainThread.Enqueue(() => onConnected?.Invoke(profile.characterID));
                    _ = SendManifestAndSnapshot();
                    return;
                case "heartbeat": _ = SendAsync(new { type = "heartbeat", sequence = lastServerSequence }); return;
                case "world.resync.request": mainThread.Enqueue(() => worldSensor?.ForceSnapshot()); return;
                case "world.camera.request": mainThread.Enqueue(() => _ = CaptureCamera(message)); return;
                case "assistant.text":
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    mainThread.Enqueue(() => onAssistantText?.Invoke(message.Value<string>("text")));
                    return;
                case "assistant.started": mainThread.Enqueue(() => onAssistantState?.Invoke("thinking")); return;
                case "assistant.audio.start":
                    audioBuffer.SetLength(0);
                    audioContentType = message.Value<string>("contentType");
                    pendingVisemes = message["visemes"]?.ToObject<VisemeCue[]>() ?? Array.Empty<VisemeCue>();
                    var emotion = message.Value<string>("emotion") ?? "neutral";
                    var intensity = message.Value<float?>("intensity") ?? 0.4f;
                    mainThread.Enqueue(() => onSpeechEmotion?.Invoke(emotion, intensity));
                    mainThread.Enqueue(() => onAssistantState?.Invoke("speaking"));
                    return;
                case "assistant.audio.end": _ = DecodeAndPlay(audioBuffer.ToArray(), audioContentType); return;
                case "assistant.done": mainThread.Enqueue(() => onAssistantState?.Invoke("idle")); return;
                case "assistant.cancelled": mainThread.Enqueue(() => { audioSource?.Stop(); onAssistantState?.Invoke("listening"); }); return;
                case "assistant.error": mainThread.Enqueue(() => onAssistantState?.Invoke("uncertain")); RaiseError(message.Value<string>("error")); return;
                case "approval.request":
                    currentApproval = message.ToObject<ApprovalRequest>();
                    mainThread.Enqueue(() => onApprovalRequested?.Invoke(currentApproval.id, currentApproval.title, currentApproval.risk));
                    return;
                case "game.action": mainThread.Enqueue(() => _ = ExecuteAction(message.ToObject<GameActionRequest>())); return;
                case "game.action.cancel": mainThread.Enqueue(() => CancelAction(message.Value<string>("id"))); return;
                case "game.goal":
                    CurrentGoalState = message.ToObject<AgentGoalState>();
                    CurrentGoal = CurrentGoalState?.text;
                    mainThread.Enqueue(() => onGoalChanged?.Invoke(CurrentGoal));
                    return;
                case "game.goal.outcome":
                    var outcome = message["goal"]?.ToObject<AgentGoalState>();
                    if (outcome != null && CurrentGoalState?.id == outcome.id) { CurrentGoalState = outcome; CurrentGoal = string.Empty; }
                    mainThread.Enqueue(() => onGoalChanged?.Invoke(CurrentGoal));
                    return;
                case "game.goal.cancel": mainThread.Enqueue(() => CancelCycle(message.Value<string>("cycleID"))); return;
            }
        }

        async Task SendManifestAndSnapshot()
        {
            if (capabilityRegistry != null)
                await SendAsync(new { type = "capability.manifest", revision = capabilityRegistry.Revision, capabilities = capabilityRegistry.Manifests() });
            mainThread.Enqueue(() => worldSensor?.ForceSnapshot());
        }

        async Task CaptureCamera(JObject request)
        {
            var camera = worldSensor?.viewCamera;
            if (camera == null) return;
            var width = Mathf.Clamp(request.Value<int?>("width") ?? 320, 64, 512);
            var height = Mathf.Clamp(request.Value<int?>("height") ?? 180, 64, 512);
            var quality = Mathf.Clamp(request.Value<int?>("quality") ?? 55, 20, 75);
            var previous = camera.targetTexture;
            var target = RenderTexture.GetTemporary(width, height, 16, RenderTextureFormat.ARGB32);
            var active = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
                texture.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                texture.Apply(false);
                var data = texture.EncodeToJPG(quality);
                Destroy(texture);
                if (data.Length > 36 * 1024) throw new InvalidDataException("Compressed camera frame exceeds the protocol limit.");
                await SendAsync(new { type = "world.camera.result", id = request.Value<string>("id"), contentType = "image/jpeg", data = Convert.ToBase64String(data) });
            }
            catch (Exception error) { RaiseError("Camera capture failed: " + error.Message); }
            finally
            {
                camera.targetTexture = previous;
                RenderTexture.active = active;
                RenderTexture.ReleaseTemporary(target);
            }
        }

        async Task ExecuteAction(GameActionRequest request)
        {
            var started = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            LastAction = request.actionID;
            if (completedActions.TryGetValue(request.id, out var cached)) { await SendActionResult(request.id, cached); return; }
            if (capabilityRegistry == null || !capabilityRegistry.TryGet(request.actionID, out var capability))
            {
                await SendActionResult(request.id, AvatarActionResult.Failure("Capability is not registered.")); return;
            }
            if (!capability.CheckPreconditions(request.args ?? new JObject(), out var reason))
            {
                await SendActionResult(request.id, AvatarActionResult.Failure(reason)); return;
            }
            var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            cancellation.CancelAfter(Mathf.Clamp(request.timeoutMs, 100, 300000));
            activeActions[request.id] = cancellation;
            AvatarActionResult result;
            try { result = await capability.ExecuteAsync(request.args ?? new JObject(), cancellation.Token); }
            catch (OperationCanceledException) { capability.Cancel(); result = AvatarActionResult.Failure("Action cancelled."); }
            catch (Exception error) { result = AvatarActionResult.Failure(error.Message); }
            activeActions.Remove(request.id);
            cancellation.Dispose();
            completedActions[request.id] = result;
            LastActionLatencyMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - started;
            if (completedActions.Count > 256) completedActions.Clear();
            await SendActionResult(request.id, result);
        }

        void CancelAction(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || !activeActions.TryGetValue(id, out var action)) return;
            action.Cancel();
        }

        void CancelActiveActions()
        {
            foreach (var action in activeActions.Values) action.Cancel();
            foreach (var capability in capabilityRegistry?.All ?? Array.Empty<IAvatarCapability>()) capability.Cancel();
        }

        void CancelCycle(string cycleID)
        {
            CancelActiveActions();
            CurrentGoal = string.Empty;
            CurrentGoalState = null;
            onGoalChanged?.Invoke(string.Empty);
        }

        Task SendActionResult(string id, AvatarActionResult result) => SendAsync(new
        {
            type = "game.action.result", id, ok = result.ok, code = result.code, message = result.message, data = result.data,
            changedEntityIDs = result.changedEntityIDs, observeAgain = result.observeAgain,
        });

        void ConfigureSensor()
        {
            if (worldSensor == null) return;
            worldSensor.GameID = profile.gameID;
            worldSensor.SaveSlotID = profile.saveSlotID;
            worldSensor.CharacterID = profile.characterID;
            worldSensor.SnapshotReady -= SendSnapshot;
            worldSensor.SnapshotReady += SendSnapshot;
            worldSensor.DeltaReady -= SendDelta;
            worldSensor.DeltaReady += SendDelta;
            worldSensor.EventReady -= SendEvent;
            worldSensor.EventReady += SendEvent;
        }

        async void SendSnapshot(WorldSnapshot snapshot) => await SendAsync(new { type = "world.snapshot", world = snapshot });
        async void SendDelta(AvatarWorldDelta delta) => await SendAsync(delta);
        async void SendEvent(AvatarWorldEventMessage value) => await SendAsync(value);

        async Task SendAsync(object value)
        {
            if (transport == null || transport.State != WebSocketState.Open) return;
            try { await transport.SendTextAsync(AvatarJson.Serialize(value), lifetime.Token); }
            catch (Exception error) when (!(error is OperationCanceledException)) { RaiseError(error.Message); }
        }

        void HandleAudioChunk(byte[] payload)
        {
            if (payload.Length < 12 || payload[0] != (byte)'O' || payload[1] != (byte)'C' || payload[2] != (byte)'A' || payload[3] != (byte)'V') return;
            audioBuffer.Write(payload, 12, payload.Length - 12);
        }

        async Task DecodeAndPlay(byte[] bytes, string contentType)
        {
            if (audioSource == null || bytes.Length == 0 || (contentType != null && !contentType.Contains("wav"))) return;
            try
            {
                var wav = await Task.Run(() => AvatarWav.Decode(bytes));
                mainThread.Enqueue(() =>
                {
                    var clip = AudioClip.Create("OpenCode Agent", wav.samples.Length / wav.channels, wav.channels, wav.rate, false);
                    clip.SetData(wav.samples, 0); audioSource.clip = clip; audioSource.Play();
                    StartCoroutine(PlayVisemes(pendingVisemes));
                });
            }
            catch (Exception error) { RaiseError("Could not play agent voice: " + error.Message); }
        }

        void RaiseError(string message) => mainThread.Enqueue(() => onError?.Invoke(message));

        System.Collections.IEnumerator PlayVisemes(VisemeCue[] cues)
        {
            var previous = 0;
            foreach (var cue in cues)
            {
                yield return new WaitForSecondsRealtime(Mathf.Max(0, cue.timeMs - previous) / 1000f);
                if (audioSource == null || !audioSource.isPlaying) yield break;
                onViseme?.Invoke(cue.shape, 1f);
                previous = cue.timeMs;
            }
        }
    }
}
