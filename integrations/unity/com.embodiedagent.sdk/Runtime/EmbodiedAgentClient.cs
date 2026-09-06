using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Events;

namespace EmbodiedAgent.Unity
{
    [Serializable] public sealed class AvatarStringEvent : UnityEvent<string> { }
    [Serializable] public sealed class AvatarApprovalEvent : UnityEvent<string, string, string> { }
    [Serializable] public sealed class AvatarVisemeEvent : UnityEvent<string, float> { }
    [Serializable] public sealed class AvatarEmotionEvent : UnityEvent<string, float> { }

    public sealed class EmbodiedAgentClient : MonoBehaviour
    {
        [Header("Connection")]
        public AvatarConnectionMode connectionMode = AvatarConnectionMode.Auto;
        public string clientID = "embodied-unity";
        public string characterID = "instructor";
        public string gameID = "safety-training";
        public string saveSlotID = "trainee-1";
        [Tooltip("Leave empty to select unity-editor, pcvr, or quest from the build target.")]
        public string surfaceIdentity;
        public string bootstrapUrl = AvatarBootstrap.DefaultUrl;
        public bool connectOnStart = true;

        [Header("Advanced manual connection")]
        [TextArea(5, 14)] public string connectionJson;

        [Header("World and capabilities")]
        public AvatarCapabilityRegistry capabilityRegistry;
        public AvatarWorldSensor worldSensor;
        public EmbodiedScenarioRunner scenarioRunner;

        [Header("Voice")]
        public bool receiveVoice = true;
        public AudioSource audioSource;
        public string voiceProvider = "fish-local";
        public string fishPresetID;
        public string voiceEndpoint = "http://127.0.0.1:8080/v1/tts";
        public string voiceModel = "fish-speech-s2-pro";
        public string voiceName = "default";

        [Header("Quest microphone → Mac realtime voice (protocol v2.5)")]
        public bool enableMicrophoneStreaming = true;
        public bool handsFree;
        public string microphoneDevice;
        [Range(8000, 48000)] public int microphoneSampleRate = 16000;
        [Range(0.001f, 0.2f)] public float voiceActivationThreshold = 0.018f;
        [Range(0.25f, 2f)] public float handsFreeSilenceSeconds = 0.75f;
        public string speechLocale = "uk-UA";

        [Header("Events")]
        public AvatarStringEvent onConnected = new AvatarStringEvent();
        public AvatarStringEvent onAssistantText = new AvatarStringEvent();
        public AvatarStringEvent onAssistantDelta = new AvatarStringEvent();
        public AvatarStringEvent onError = new AvatarStringEvent();
        public AvatarApprovalEvent onApprovalRequested = new AvatarApprovalEvent();
        public AvatarStringEvent onGoalChanged = new AvatarStringEvent();
        public AvatarVisemeEvent onViseme = new AvatarVisemeEvent();
        public AvatarEmotionEvent onSpeechEmotion = new AvatarEmotionEvent();
        public AvatarStringEvent onAssistantState = new AvatarStringEvent();
        public AvatarStringEvent onTranscriptPartial = new AvatarStringEvent();
        public AvatarStringEvent onUserText = new AvatarStringEvent();
        public AvatarStringEvent onTurnPhase = new AvatarStringEvent();
        public AvatarStringEvent onGestureHint = new AvatarStringEvent();
        public AvatarStringEvent onGazeTarget = new AvatarStringEvent();
        public AvatarStringEvent onAITraineeState = new AvatarStringEvent();
        [Tooltip("Sanitized fixture frames only. Live actions are never executed by Replay Lab.")]
        public AvatarReplayEvent onReplayFixtureFrame = new AvatarReplayEvent();

        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        readonly Dictionary<string, CancellationTokenSource> activeActions = new Dictionary<string, CancellationTokenSource>();
        readonly Dictionary<string, bool> activeActionCancellable = new Dictionary<string, bool>();
        readonly Dictionary<string, AvatarActionResult> completedActions = new Dictionary<string, AvatarActionResult>();
        readonly Dictionary<string, InstructorCommandResult> instructorCommandResults = new Dictionary<string, InstructorCommandResult>();
        readonly Queue<string> instructorCommandOrder = new Queue<string>();
        readonly Dictionary<string, JObject> scenarioTestResetResults = new Dictionary<string, JObject>();
        readonly Queue<string> scenarioTestResetOrder = new Queue<string>();
        readonly MemoryStream audioBuffer = new MemoryStream();
        readonly Queue<PendingPlayback> playbackQueue = new Queue<PendingPlayback>();
        CancellationTokenSource lifetime;
        CancellationTokenSource transportLifetime;
        IAvatarTransport transport;
        AvatarConnectionProfile profile;
        ApprovalRequest currentApproval;
        long lastServerSequence;
        string audioContentType;
        string currentRequestID;
        VisemeCue[] pendingVisemes = Array.Empty<VisemeCue>();
        int reconnectAttempt;
        AudioClip microphoneClip;
        int microphoneReadPosition;
        bool microphoneStreaming;
        bool microphoneSpeechDetected;
        bool audioFlowPaused;
        float lastMicrophoneSpeechAt;
        readonly Queue<byte[]> audioSendQueue = new Queue<byte[]>();
        readonly SemaphoreSlim connectionGate = new SemaphoreSlim(1, 1);
        bool audioSendActive;
        Task connectionLoop;
        Coroutine visemePlayback;
        Coroutine audioPlaybackCompletion;
        bool completeTurnAfterAudio;
        bool audioDecodeActive;
        bool welcomeReceived;
        float nextScenarioSnapshotAt;
        string audioPurpose = "conversation";
        string audioDemonstrationID;

        sealed class PendingPlayback
        {
            public byte[] bytes;
            public string contentType;
            public VisemeCue[] visemes;
        }

        public bool IsConnected => transport != null && transport.State == WebSocketState.Open;
        public string CurrentGoal { get; private set; }
        public AgentGoalState CurrentGoalState { get; private set; }
        public string LastAction { get; private set; }
        public long LastActionLatencyMs { get; private set; }
        public string LastError { get; private set; }
        public string LastTranscript { get; private set; }
        public string LastAssistantText { get; private set; }
        public string AudioPlaybackState { get; private set; } = "Idle";
        public string ConnectionState { get; private set; } = "Idle";
        public string ResponseModel { get; private set; }
        public long ResponseTTFTMs { get; private set; }
        public long ResponseGenerationMs { get; private set; }
        public string ResponseFallback { get; private set; }
        public string VoiceEngine { get; private set; } = "cascade";
        public string RealtimeStage { get; private set; } = "idle";
        public string CurrentTurnID { get; private set; }
        public string CurrentTurnPhase { get; private set; } = "completed";
        public int MediaQueuedSentences { get; private set; }
        public int MediaActiveJobs { get; private set; }
        public long CancellationLatencyMs { get; private set; }
        public string AITraineeStatus { get; private set; } = "idle";
        public string AITraineeProfile { get; private set; }
        public string AITraineeRunID { get; private set; }
        public string AITraineeTargetID { get; private set; }
        public string AITraineeModel { get; private set; }
        public int AITraineeAttempts { get; private set; }
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
            PumpMicrophone();
            if (IsConnected && (scenarioRunner?.Run?.status == "running" || scenarioRunner?.Run?.status == "paused") && Time.unscaledTime >= nextScenarioSnapshotAt)
            {
                nextScenarioSnapshotAt = Time.unscaledTime + 1f;
                _ = SendScenarioSnapshotAsync();
            }
        }

        async void OnDestroy()
        {
            if (scenarioRunner != null) scenarioRunner.SnapshotChanged -= OnScenarioSnapshotChanged;
            lifetime?.Cancel();
            transportLifetime?.Cancel();
            foreach (var action in activeActions.Values) action.Cancel();
            if (connectionLoop != null)
            {
                try { await connectionLoop; } catch { }
            }
            lifetime?.Dispose();
            audioBuffer.Dispose();
            StopMicrophoneCapture();
        }

        public async Task ConnectAsync()
        {
            await connectionGate.WaitAsync();
            try
            {
                if (connectionLoop != null && !connectionLoop.IsCompleted && lifetime != null && !lifetime.IsCancellationRequested)
                    return;
                await StartConnectionAsync();
            }
            finally { connectionGate.Release(); }
        }

        public async Task ReconnectAsync()
        {
            await connectionGate.WaitAsync();
            try
            {
                lifetime?.Cancel();
                if (connectionLoop != null)
                {
                    try { await connectionLoop; }
                    catch (OperationCanceledException) { }
                }
                await StartConnectionAsync();
            }
            finally { connectionGate.Release(); }
        }

        async Task StartConnectionAsync()
        {
            clientID = AvatarIDs.Normalize(clientID, $"unity-{Application.productName}-{SystemInfo.deviceUniqueIdentifier}");
            characterID = AvatarIDs.Normalize(characterID, "jarvis");
            gameID = AvatarIDs.Normalize(gameID, Application.productName);
            saveSlotID = AvatarIDs.Normalize(saveSlotID, "slot-1");
            if (EffectiveConnectionMode() == AvatarConnectionMode.Manual)
            {
                profile = Newtonsoft.Json.JsonConvert.DeserializeObject<AvatarConnectionProfile>(connectionJson);
                if (profile == null || string.IsNullOrWhiteSpace(profile.url) || string.IsNullOrWhiteSpace(profile.token))
                    throw new InvalidOperationException("Manual mode requires valid protocol v2 connection JSON.");
                NormalizeProfile(profile);
            }
            if (capabilityRegistry == null) capabilityRegistry = GetComponentInChildren<AvatarCapabilityRegistry>();
            if (worldSensor == null) worldSensor = GetComponentInChildren<AvatarWorldSensor>();
            ConfigureScenarioRunner();
            var previousLifetime = lifetime;
            previousLifetime?.Cancel();
            lifetime = new CancellationTokenSource();
            previousLifetime?.Dispose();
            connectionLoop = ConnectionLoop(lifetime.Token);
            await Task.Yield();
        }

        public async void SubmitSpeechStart(string requestID)
        {
            currentRequestID = string.IsNullOrWhiteSpace(requestID) ? Guid.NewGuid().ToString("N") : requestID;
            ResetSpeechPresentation();
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

        public async void SubmitTypedText(string text)
        {
            if (!IsConnected || string.IsNullOrWhiteSpace(text)) return;
            var clean = text.Trim();
            currentRequestID = Guid.NewGuid().ToString("N");
            ResetSpeechPresentation();
            CancelActiveActions();
            LastTranscript = clean;
            onUserText?.Invoke(clean);
            await SendAsync(new { type = "speech.start", requestID = currentRequestID, source = "vr_keyboard" });
            await SendAsync(new { type = "speech.final", requestID = currentRequestID, text = clean, source = "vr_keyboard", responseMode = "text" });
        }

        public async void CancelSpeech()
        {
            if (string.IsNullOrWhiteSpace(currentRequestID)) return;
            ResetSpeechPresentation();
            await SendAsync(new { type = "speech.cancel", requestID = currentRequestID });
        }

        public Task ControlAITraineeAsync(string command, string profile = null, int seed = 1)
        {
            if (command != "start" && command != "pause" && command != "resume" && command != "cancel")
                throw new ArgumentException("Unsupported AI Trainee command.", nameof(command));
            if (command == "start" && profile != "guided" && profile != "blind")
                throw new ArgumentException("AI Trainee start requires guided or blind profile.", nameof(profile));
            if (command != "start")
                return SendAsync(new
                {
                    type = "ai.trainee.control", requestID = Guid.NewGuid().ToString("N"), command,
                });
            return SendAsync(new
            {
                type = "ai.trainee.control", requestID = Guid.NewGuid().ToString("N"), command,
                profile, seed = Mathf.Max(0, seed),
            });
        }

        public void BeginVoiceCapture()
        {
            if (!enableMicrophoneStreaming || !IsConnected) return;
            EnsureMicrophoneCapture();
            BeginAudioInput(handsFree ? "hands_free" : "push_to_talk");
        }

        public void BeginDemonstrationVoiceCapture(string demonstrationID)
        {
            if (!enableMicrophoneStreaming || !IsConnected || string.IsNullOrWhiteSpace(demonstrationID)) return;
            EnsureMicrophoneCapture();
            audioPurpose = "demonstration";
            audioDemonstrationID = demonstrationID;
            BeginAudioInput("push_to_talk");
        }

        public void EndVoiceCapture()
        {
            EndAudioInput(false);
            if (!handsFree) StopMicrophoneCapture();
        }

        public void EndDemonstrationVoiceCapture()
        {
            EndAudioInput(false);
            audioPurpose = "conversation";
            audioDemonstrationID = null;
            StopMicrophoneCapture();
        }

        public void CancelVoiceCapture()
        {
            EndAudioInput(true);
            if (!handsFree) StopMicrophoneCapture();
        }

        public Task SendDemonstrationStartAsync(string demonstrationID, string title = null) => SendAsync(new
        {
            type = "demonstration.start", demonstrationID, title,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });

        public Task SendDemonstrationEventAsync(DemonstrationEvent value) => SendAsync(new
        {
            type = "demonstration.event", value.demonstrationID, value.eventID, value.sequence, value.timestamp,
            value.entityID, value.capabilityID, action = value.actionID, value.ok, value.code, value.risk,
            value.permissionCategory, value.postconditions,
        });

        public Task SendDemonstrationCompleteAsync(string demonstrationID, bool cancelled) => SendAsync(new
        {
            type = cancelled ? "demonstration.cancel" : "demonstration.complete", demonstrationID,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });

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

        public Task SendScenarioLifecycleAsync(string type, ScenarioRun run, string stepID = null, string outcome = null, Dictionary<string, string> evidence = null)
        {
            if (run == null || (type != "scenario.started" && type != "scenario.step" && type != "scenario.completed" && type != "scenario.cancelled" && type != "scenario.failed"))
                throw new ArgumentException("Invalid scenario lifecycle event.", nameof(type));
            return SendAsync(new
            {
                type,
                runID = run.runID,
                scenarioID = run.scenarioID,
                scenarioRevision = run.scenarioRevision,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                sessionID = run.sessionID,
                stepID,
                outcome,
                durationMs = run.completedAt > 0 ? Math.Max(0, run.completedAt - run.startedAt) : 0,
                evidence,
                demonstrationRevision = scenarioRunner?.demonstrationRevision,
            });
        }

        async Task ConnectionLoop(CancellationToken cancellation)
        {
            var delays = new[] { 0.5f, 1f, 2f, 5f, 10f };
            var bootstrapAuthRetries = 0;
            while (!cancellation.IsCancellationRequested)
            {
                IAvatarTransport attemptTransport = null;
                CancellationTokenSource attemptLifetime = null;
                try
                {
                    var mode = EffectiveConnectionMode();
                    if (mode == AvatarConnectionMode.Auto)
                    {
                        SetConnectionState("Bootstrapping");
                        profile = await AvatarBootstrap.RequestAsync(bootstrapUrl, new AvatarBootstrapRequest
                        {
                            clientID = clientID,
                            characterID = characterID,
                            gameID = gameID,
                            saveSlotID = saveSlotID,
                        }, cancellation);
                        NormalizeProfile(profile);
                    }
                    if (mode == AvatarConnectionMode.QuestPaired)
                    {
                        SetConnectionState("Searching");
                        profile = await AvatarQuestConnection.ResolveAsync(clientID, characterID, gameID, saveSlotID, cancellation);
                        NormalizeProfile(profile);
                    }
                    if (profile == null) throw new InvalidOperationException("Avatar connection profile is unavailable.");
                    ConfigureSensor();
                    SetConnectionState("Connecting");
                    attemptTransport = AvatarTransportFactory.Create();
                    attemptLifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                    transport = attemptTransport;
                    transportLifetime = attemptLifetime;
                    welcomeReceived = false;
                    await attemptTransport.ConnectAsync(new Uri(profile.url), profile.certificateFingerprint, attemptLifetime.Token);
                    await SendHello();
                    await ReceiveLoop(attemptTransport, attemptLifetime.Token);
                    if (mode == AvatarConnectionMode.Auto && !welcomeReceived && attemptTransport.CloseStatusCode == 4401 && bootstrapAuthRetries == 0)
                    {
                        bootstrapAuthRetries++;
                        profile = null;
                        continue;
                    }
                    if (welcomeReceived) bootstrapAuthRetries = 0;
                    if (mode == AvatarConnectionMode.QuestPaired && (attemptTransport.CloseStatusCode == 4401 || attemptTransport.CloseStatusCode == 4403))
                    {
                        AvatarQuestConnection.Clear();
                        mainThread.Enqueue(() => GetComponent<AvatarQuestPairingPanel>()?.RequirePairing("Pairing was rejected or revoked. Enter a new PIN."));
                        throw new InvalidOperationException("Quest pairing was rejected or revoked.");
                    }
                    if (attemptTransport.CloseStatusCode.HasValue && attemptTransport.CloseStatusCode != 1000)
                        throw new InvalidOperationException("Avatar WebSocket closed with " + attemptTransport.CloseStatusCode +
                            (string.IsNullOrWhiteSpace(attemptTransport.CloseStatusDescription) ? "." : ": " + attemptTransport.CloseStatusDescription));
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return; }
                catch (Exception) when (cancellation.IsCancellationRequested) { return; }
                catch (OperationCanceledException) when (attemptLifetime != null && attemptLifetime.IsCancellationRequested)
                {
                    SetRetrying("Connection interrupted.", false);
                }
                catch (Exception error) when (IsTransportDisconnect(error))
                {
                    SetRetrying("Connection interrupted.", false);
                }
                catch (Exception error)
                {
                    SetRetrying("Avatar Bridge disconnected: " + error.Message, true);
                }
                finally
                {
                    attemptLifetime?.Cancel();
                    if (ReferenceEquals(transportLifetime, attemptLifetime)) transportLifetime = null;
                    if (ReferenceEquals(transport, attemptTransport))
                    {
                        transport = null;
                        audioSendQueue.Clear();
                        audioFlowPaused = false;
                        microphoneStreaming = false;
                        microphoneSpeechDetected = false;
                    }
                    attemptTransport?.Dispose();
                    attemptLifetime?.Dispose();
                }
                reconnectAttempt++;
                try { await Task.Delay(TimeSpan.FromSeconds(delays[Mathf.Min(reconnectAttempt - 1, delays.Length - 1)]), cancellation); }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return; }
            }
        }

        void NormalizeProfile(AvatarConnectionProfile value)
        {
            value.clientID = AvatarIDs.Normalize(value.clientID, clientID);
            value.characterID = AvatarIDs.Normalize(value.characterID, characterID);
            value.gameID = AvatarIDs.Normalize(value.gameID, gameID);
            value.saveSlotID = AvatarIDs.Normalize(value.saveSlotID, saveSlotID);
        }

        AvatarConnectionMode EffectiveConnectionMode()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            return connectionMode == AvatarConnectionMode.Auto ? AvatarConnectionMode.QuestPaired : connectionMode;
#else
            return connectionMode;
#endif
        }

        void SetConnectionState(string value)
        {
            mainThread.Enqueue(() => ConnectionState = value);
        }

        void SetRetrying(string reason, bool report)
        {
            mainThread.Enqueue(() =>
            {
                var visibleReason = report ? reason : null;
                var changed = ConnectionState != "Retrying" || !string.Equals(LastError, visibleReason, StringComparison.Ordinal);
                ConnectionState = "Retrying";
                LastError = visibleReason;
                if (!report || !changed) return;
                Debug.LogWarning("Embodied Agent Avatar Bridge: " + reason, this);
                onError?.Invoke(reason);
            });
        }

        async Task SendHello()
        {
            JObject voice = null;
            if (receiveVoice)
            {
                voice = new JObject
                {
                    ["provider"] = voiceProvider,
                    ["endpoint"] = voiceEndpoint,
                    ["model"] = voiceModel,
                    ["voice"] = voiceName,
                    ["mode"] = "quality",
                    ["streaming"] = true,
                };
                if (!string.IsNullOrWhiteSpace(fishPresetID)) voice["fishPresetID"] = fishPresetID.Trim();
            }
            await SendAsync(new
            {
                type = "hello", protocol = AvatarProtocol.Version, protocolMinor = AvatarProtocol.Minor, token = profile.token,
                clientID = profile.clientID, characterID = profile.characterID,
                gameID = profile.gameID, saveSlotID = profile.saveSlotID, sessionID = profile.sessionID,
                profileID = profile.profileID, profileRevision = profile.profileRevision,
                surface = ResolveSurfaceIdentity(),
                resumeSequence = lastServerSequence,
                actions = new[] { "animation.trigger", "emotion.set", "gesture.play", "look_at", "move_to", "speech.stop" },
                voice,
            });
        }

        string ResolveSurfaceIdentity()
        {
            if (!string.IsNullOrWhiteSpace(surfaceIdentity)) return surfaceIdentity.Trim();
#if UNITY_ANDROID && !UNITY_EDITOR
            return "quest";
#elif UNITY_EDITOR
            return "unity-editor";
#else
            return "pcvr";
#endif
        }

        async Task ReceiveLoop(IAvatarTransport currentTransport, CancellationToken cancellation)
        {
            while (!cancellation.IsCancellationRequested && currentTransport.State == WebSocketState.Open)
            {
                var message = await currentTransport.ReceiveAsync(cancellation);
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
                    welcomeReceived = true;
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    mainThread.Enqueue(() =>
                    {
                        reconnectAttempt = 0;
                        ConnectionState = "Connected";
                        VoiceEngine = message.Value<string>("voiceEngine") ?? VoiceEngine;
                        LastError = null;
                        onConnected?.Invoke(profile.characterID);
                    });
                    _ = SendManifestAndSnapshot();
                    if (handsFree && enableMicrophoneStreaming) mainThread.Enqueue(EnsureMicrophoneCapture);
                    return;
                case "heartbeat": _ = SendAsync(new { type = "heartbeat", sequence = lastServerSequence }); return;
                case "world.resync.request": mainThread.Enqueue(() => worldSensor?.ForceSnapshot()); return;
                case "world.camera.request": mainThread.Enqueue(() => _ = CaptureCamera(message)); return;
                case "assistant.text":
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    mainThread.Enqueue(() =>
                    {
                        LastError = null;
                        LastAssistantText = message.Value<string>("text");
                        onAssistantText?.Invoke(LastAssistantText);
                    });
                    return;
                case "assistant.text.start":
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    mainThread.Enqueue(() =>
                    {
                        LastError = null;
                        LastAssistantText = string.Empty;
                        ResponseModel = message.Value<string>("model");
                        ResponseTTFTMs = 0;
                        ResponseGenerationMs = 0;
                        ResponseFallback = null;
                        VoiceEngine = message.Value<string>("engine") ?? VoiceEngine;
                        RealtimeStage = VoiceEngine == "nemotron" ? "responding" : "generation";
                        onAssistantState?.Invoke("responding");
                    });
                    return;
                case "assistant.text.delta":
                    var delta = message.Value<string>("delta") ?? string.Empty;
                    mainThread.Enqueue(() =>
                    {
                        LastError = null;
                        LastAssistantText = (LastAssistantText ?? string.Empty) + delta;
                        ResponseTTFTMs = message.Value<long?>("ttftMs") ?? ResponseTTFTMs;
                        VoiceEngine = message.Value<string>("engine") ?? VoiceEngine;
                        RealtimeStage = "responding";
                        onAssistantState?.Invoke("responding");
                        if (!string.IsNullOrEmpty(delta)) onAssistantDelta?.Invoke(delta);
                    });
                    return;
                case "assistant.text.done":
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    mainThread.Enqueue(() =>
                    {
                        LastError = null;
                        LastAssistantText = message.Value<string>("text") ?? LastAssistantText;
                        ResponseModel = message.Value<string>("model") ?? ResponseModel;
                        ResponseTTFTMs = message.Value<long?>("ttftMs") ?? ResponseTTFTMs;
                        ResponseGenerationMs = message.Value<long?>("generationMs") ?? ResponseGenerationMs;
                        ResponseFallback = message.Value<string>("fallback");
                        VoiceEngine = message.Value<string>("engine") ?? VoiceEngine;
                        RealtimeStage = "audio";
                        onAssistantText?.Invoke(LastAssistantText);
                    });
                    return;
                case "assistant.started": mainThread.Enqueue(() => onAssistantState?.Invoke("thinking")); return;
                case "assistant.audio.start":
                    audioBuffer.SetLength(0);
                    audioContentType = message.Value<string>("contentType");
                    pendingVisemes = message["visemes"]?.ToObject<VisemeCue[]>() ?? Array.Empty<VisemeCue>();
                    completeTurnAfterAudio = false;
                    mainThread.Enqueue(() => AudioPlaybackState = "Receiving");
                    var emotion = message.Value<string>("emotion") ?? "neutral";
                    var intensity = message.Value<float?>("intensity") ?? 0.4f;
                    mainThread.Enqueue(() => onSpeechEmotion?.Invoke(emotion, intensity));
                    mainThread.Enqueue(() => onAssistantState?.Invoke("speaking"));
                    return;
                case "assistant.audio.end": QueueAudioPlayback(audioBuffer.ToArray(), audioContentType, pendingVisemes); return;
                case "assistant.done":
                    mainThread.Enqueue(() =>
                    {
                        if (AudioPlaybackState == "Receiving" || AudioPlaybackState == "Decoding" || AudioPlaybackState == "Playing")
                        {
                            completeTurnAfterAudio = true;
                            return;
                        }
                        RealtimeStage = "idle";
                        onViseme?.Invoke(null, 0f);
                        onAssistantState?.Invoke("idle");
                    });
                    return;
                case "assistant.cancelled": mainThread.Enqueue(() => { ResetSpeechPresentation(); onAssistantState?.Invoke("listening"); }); return;
                case "assistant.error": mainThread.Enqueue(() => onAssistantState?.Invoke("uncertain")); RaiseError(message.Value<string>("error")); return;
                case "avatar.presentation":
                    var presentation = message.ToObject<AvatarPresentationFrame>();
                    if (presentation == null) return;
                    CurrentGoal = presentation.goal ?? CurrentGoal;
                    mainThread.Enqueue(() =>
                    {
                        onAssistantState?.Invoke(presentation.state);
                        onSpeechEmotion?.Invoke(presentation.emotion ?? "neutral", presentation.intensity);
                        if (!string.IsNullOrWhiteSpace(presentation.goal)) onGoalChanged?.Invoke(presentation.goal);
                    });
                    return;
                case "jarvis.turn":
                    var turn = message.ToObject<AgentTurnFrame>();
                    if (turn == null) return;
                    mainThread.Enqueue(() =>
                    {
                        CurrentTurnID = turn.turnID;
                        CurrentTurnPhase = string.IsNullOrWhiteSpace(turn.phase) ? CurrentTurnPhase : turn.phase;
                        RealtimeStage = CurrentTurnPhase;
                        onTurnPhase?.Invoke(CurrentTurnPhase);
                        if (CurrentTurnPhase == "cancelled" || CurrentTurnPhase == "error") ResetSpeechPresentation();
                    });
                    return;
                case "jarvis.presentation.cue":
                    var cue = message["cue"]?.ToObject<PresentationCue>();
                    if (cue == null) return;
                    mainThread.Enqueue(() =>
                    {
                        onSpeechEmotion?.Invoke(cue.emotion ?? "neutral", Mathf.Clamp01(cue.intensity));
                        if (!string.IsNullOrWhiteSpace(cue.gestureHint)) onGestureHint?.Invoke(cue.gestureHint);
                        if (!string.IsNullOrWhiteSpace(cue.gazeTarget)) onGazeTarget?.Invoke(cue.gazeTarget);
                    });
                    return;
                case "jarvis.media.queue":
                    var media = message.ToObject<MediaFrame>();
                    if (media == null) return;
                    mainThread.Enqueue(() =>
                    {
                        MediaQueuedSentences = Mathf.Max(0, media.queued);
                        MediaActiveJobs = Mathf.Max(0, media.active);
                        RealtimeStage = media.state ?? RealtimeStage;
                    });
                    return;
                case "jarvis.cancellation.ack":
                    mainThread.Enqueue(() =>
                    {
                        CancellationLatencyMs = message.Value<long?>("latencyMs") ?? 0;
                        MediaQueuedSentences = 0;
                        MediaActiveJobs = 0;
                        RealtimeStage = "listening";
                        ResetSpeechPresentation();
                    });
                    return;
                case "jarvis.snapshot":
                    profile.sessionID = message.Value<string>("sessionID") ?? profile.sessionID;
                    var snapshotMedia = message["media"]?.ToObject<MediaFrame>();
                    if (snapshotMedia == null) return;
                    mainThread.Enqueue(() =>
                    {
                        MediaQueuedSentences = Mathf.Max(0, snapshotMedia.queued);
                        MediaActiveJobs = Mathf.Max(0, snapshotMedia.active);
                        RealtimeStage = snapshotMedia.state ?? RealtimeStage;
                    });
                    return;
                case "jarvis.replay.fixture":
                    var fixtureEvent = message["event"] as JObject;
                    if (fixtureEvent == null) return;
                    mainThread.Enqueue(() => onReplayFixtureFrame?.Invoke(fixtureEvent.ToString(Newtonsoft.Json.Formatting.None)));
                    return;
                case "jarvis.replay.fixture.done":
                    mainThread.Enqueue(() => onAssistantState?.Invoke("idle"));
                    return;
                case "ai.trainee.state":
                    mainThread.Enqueue(() =>
                    {
                        AITraineeRunID = message.Value<string>("runID");
                        AITraineeStatus = message.Value<string>("status") ?? "idle";
                        AITraineeProfile = message.Value<string>("profile");
                        AITraineeModel = message.Value<string>("model");
                        AITraineeAttempts = Mathf.Max(0, message.Value<int?>("attempts") ?? 0);
                        AITraineeTargetID = message["decision"]?.Value<string>("entityID");
                        scenarioRunner?.SetAITraineeActor(AITraineeRunID, AITraineeModel, AITraineeProfile, AITraineeAttempts);
                        onAITraineeState?.Invoke(message.ToString(Newtonsoft.Json.Formatting.None));
                    });
                    return;
                case "ai.trainee.command.result":
                    if (message.Value<bool>("ok")) return;
                    RaiseError(message.Value<string>("message") ?? message.Value<string>("code") ?? "AI Trainee command failed.");
                    return;
                case "user.transcript.partial":
                    mainThread.Enqueue(() =>
                    {
                        LastTranscript = message.Value<string>("text");
                        onTranscriptPartial?.Invoke(LastTranscript);
                    });
                    return;
                case "user.transcript.final":
                    mainThread.Enqueue(() =>
                    {
                        LastTranscript = message.Value<string>("text");
                        onTranscriptPartial?.Invoke(LastTranscript);
                        onUserText?.Invoke(LastTranscript);
                    });
                    return;
                case "audio.flow":
                case "audio.ack":
                    audioFlowPaused = message.Value<bool?>("paused") ?? false;
                    if (!audioFlowPaused) _ = FlushAudioQueue();
                    return;
                case "audio.error": RaiseError(message.Value<string>("error")); EndAudioInput(true); return;
                case "approval.request":
                    currentApproval = message.ToObject<ApprovalRequest>();
                    mainThread.Enqueue(() => onApprovalRequested?.Invoke(currentApproval.id, currentApproval.title, currentApproval.risk));
                    return;
                case "approval.resolved":
                    if (currentApproval?.id == message.Value<string>("id"))
                    {
                        var approval = currentApproval;
                        currentApproval = null;
                        var operatorID = message.Value<string>("instructorID");
                        if (!string.IsNullOrWhiteSpace(operatorID))
                            mainThread.Enqueue(() => scenarioRunner?.RecordInstructorApproval(approval.id, operatorID, approval.actionID, message.Value<bool>("approved")));
                    }
                    return;
                case "instructor.command":
                case "instructor.hint":
                    mainThread.Enqueue(() => _ = HandleInstructorCommand(message));
                    return;
                case "scenario.test.reset":
                    mainThread.Enqueue(() => _ = HandleScenarioTestReset(message));
                    return;
                case "demonstration.error": RaiseError(message.Value<string>("error")); return;
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
            mainThread.Enqueue(() => _ = SendScenarioSnapshotAsync());
        }

        void ConfigureScenarioRunner()
        {
            if (scenarioRunner == null) scenarioRunner = GetComponentInChildren<EmbodiedScenarioRunner>();
            if (scenarioRunner == null) return;
            scenarioRunner.client = this;
            scenarioRunner.SnapshotChanged -= OnScenarioSnapshotChanged;
            scenarioRunner.SnapshotChanged += OnScenarioSnapshotChanged;
        }

        void OnScenarioSnapshotChanged() => _ = SendScenarioSnapshotAsync();

        public Task SendScenarioSnapshotAsync()
        {
            var run = scenarioRunner?.Run;
            if (!IsConnected || run == null) return Task.CompletedTask;
            return SendAsync(new
            {
                type = "scenario.snapshot", runID = run.runID, scenarioID = run.scenarioID,
                scenarioRevision = run.scenarioRevision, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                sessionID = run.sessionID, traineeID = run.traineeID, instructorID = scenarioRunner.instructorID,
                status = run.status, currentStepID = run.currentStepID, attempt = scenarioRunner.CurrentAttempt,
                timeoutRemainingMs = scenarioRunner.TimeoutRemainingMs, evidence = scenarioRunner.EvidenceSnapshot,
                instructorEvidenceIDs = scenarioRunner.InstructorEvidenceIDs,
                deploymentID = scenarioRunner.deploymentID, scenarioTitle = scenarioRunner.scenario?.title,
                currentInstruction = scenarioRunner.CurrentInstruction,
                allowedCapabilityIDs = scenarioRunner.CurrentAllowedCapabilityIDs,
                simulation = scenarioRunner.simulationDeployment,
                criticalAutoApproveCategories = scenarioRunner.simulationCriticalAutoApproveCategories,
                baselineFingerprint = ResolveTestEnvironment()?.BaselineFingerprint,
                capabilityRevision = capabilityRegistry?.Revision ?? 0,
            });
        }

        async Task HandleScenarioTestReset(JObject message)
        {
            var requestID = message.Value<string>("requestID");
            var scenarioID = message.Value<string>("scenarioID");
            var scenarioRevision = message.Value<int?>("scenarioRevision") ?? 0;
            if (string.IsNullOrWhiteSpace(requestID) || string.IsNullOrWhiteSpace(scenarioID) || scenarioRevision < 1) return;
            if (scenarioTestResetResults.TryGetValue(requestID, out var cached))
            {
                await SendAsync(cached);
                return;
            }
            CancelSpeech();
            CancelActiveActions();
            var environment = ResolveTestEnvironment();
            ScenarioTestResetResult reset;
            if (scenarioRunner?.scenario == null || scenarioRunner.scenario.scenarioID != scenarioID || scenarioRunner.scenario.revision != scenarioRevision)
                reset = new ScenarioTestResetResult { ok = false, code = "scenario_conflict", message = "The active scenario ID or revision does not match the validation request." };
            else if (environment == null)
                reset = new ScenarioTestResetResult { ok = false, code = "reset_contract_missing", message = "Implement IScenarioTestEnvironment on one game-owned component." };
            else
                reset = await environment.ResetForValidationAsync(lifetime?.Token ?? CancellationToken.None);
            var expected = message.Value<string>("expectedBaselineFingerprint");
            if (reset.ok && !string.IsNullOrWhiteSpace(expected) && reset.baselineFingerprint != expected)
                reset = new ScenarioTestResetResult { ok = false, code = "baseline_mismatch", message = "The scene did not return to the captured baseline.", baselineFingerprint = reset.baselineFingerprint };
            worldSensor?.ForceSnapshot();
            var response = JObject.FromObject(new
            {
                type = "scenario.test.reset.result", requestID, ok = reset.ok, code = reset.code ?? (reset.ok ? "reset" : "reset_failed"),
                message = reset.message, scenarioID, scenarioRevision, baselineFingerprint = reset.baselineFingerprint,
                capabilityRevision = capabilityRegistry?.Revision ?? 0, worldRevision = worldSensor?.Latest?.revision ?? 0,
                runID = scenarioRunner?.Run?.runID, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
            scenarioTestResetResults[requestID] = response;
            scenarioTestResetOrder.Enqueue(requestID);
            if (scenarioTestResetOrder.Count > 128) scenarioTestResetResults.Remove(scenarioTestResetOrder.Dequeue());
            await SendAsync(response);
            await SendScenarioSnapshotAsync();
        }

        IScenarioTestEnvironment ResolveTestEnvironment()
        {
            var environments = FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include).OfType<IScenarioTestEnvironment>().ToArray();
            return environments.Length == 1 ? environments[0] : null;
        }

        async Task HandleInstructorCommand(JObject message)
        {
            var command = message.ToObject<InstructorCommandFrame>();
            if (command == null || string.IsNullOrWhiteSpace(command.requestID)) return;
            if (message.Value<string>("type") == "instructor.hint") command.command = "hint";
            if (instructorCommandResults.TryGetValue(command.requestID, out var cached))
            {
                await SendInstructorCommandResult(cached);
                return;
            }
            InstructorCommandResult result;
            if (scenarioRunner == null)
                result = CommandResult(command, false, "scenario_unavailable", "No scenario runner is attached.");
            else if (command.command == "pause" && activeActionCancellable.Values.Any(value => !value))
                result = CommandResult(command, false, "busy_non_cancellable", "A non-cancellable game action is still running.");
            else
            {
                if (command.command == "pause")
                {
                    CancelSpeech();
                    CancelActiveActions();
                }
                result = scenarioRunner.ApplyInstructorCommand(command);
            }
            instructorCommandResults[command.requestID] = result;
            instructorCommandOrder.Enqueue(command.requestID);
            if (instructorCommandOrder.Count > 128) instructorCommandResults.Remove(instructorCommandOrder.Dequeue());
            await SendInstructorCommandResult(result);
            await SendScenarioSnapshotAsync();
        }

        InstructorCommandResult CommandResult(InstructorCommandFrame command, bool ok, string code, string message) => new InstructorCommandResult
        {
            requestID = command.requestID, runID = command.runID, ok = ok, code = code, message = message,
            stepID = scenarioRunner?.Run?.currentStepID, attempt = scenarioRunner?.CurrentAttempt ?? 1,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };

        Task SendInstructorCommandResult(InstructorCommandResult result) => SendAsync(new
        {
            type = "instructor.command.result", result.requestID, result.runID, result.ok, result.code,
            result.message, result.stepID, result.attempt, result.timestamp,
        });

        void EnsureMicrophoneCapture()
        {
            if (microphoneClip != null || !enableMicrophoneStreaming) return;
            if (!Application.HasUserAuthorization(UserAuthorization.Microphone))
            {
                _ = RequestMicrophoneAndStart();
                return;
            }
            StartMicrophoneCapture();
        }

        async Task RequestMicrophoneAndStart()
        {
            var request = Application.RequestUserAuthorization(UserAuthorization.Microphone);
            while (!request.isDone) await Task.Yield();
            if (!Application.HasUserAuthorization(UserAuthorization.Microphone))
            {
                RaiseError("Quest microphone permission was denied.");
                return;
            }
            mainThread.Enqueue(StartMicrophoneCapture);
        }

        void StartMicrophoneCapture()
        {
            if (microphoneClip != null) return;
            microphoneClip = Microphone.Start(string.IsNullOrWhiteSpace(microphoneDevice) ? null : microphoneDevice, true, 10, microphoneSampleRate);
            microphoneReadPosition = 0;
        }

        void StopMicrophoneCapture()
        {
            if (microphoneClip == null) return;
            Microphone.End(string.IsNullOrWhiteSpace(microphoneDevice) ? null : microphoneDevice);
            microphoneClip = null;
            microphoneReadPosition = 0;
        }

        void BeginAudioInput(string mode)
        {
            if (microphoneStreaming || !IsConnected) return;
            currentRequestID = Guid.NewGuid().ToString("N");
            microphoneStreaming = true;
            microphoneSpeechDetected = false;
            audioFlowPaused = false;
            audioSendQueue.Clear();
            ResetSpeechPresentation();
            CancelActiveActions();
            _ = SendAsync(new AvatarSpeechFrame
            {
                requestID = currentRequestID,
                sampleRate = microphoneSampleRate,
                locale = speechLocale,
                mode = mode,
                purpose = audioPurpose,
                demonstrationID = audioDemonstrationID,
            }, "audio.start");
        }

        void EndAudioInput(bool cancel)
        {
            if (!microphoneStreaming || string.IsNullOrWhiteSpace(currentRequestID)) return;
            microphoneStreaming = false;
            _ = CompleteAudioInput(currentRequestID, cancel);
        }

        async Task CompleteAudioInput(string requestID, bool cancel)
        {
            if (cancel)
            {
                audioSendQueue.Clear();
                await SendAsync(new { type = "audio.cancel", requestID });
                return;
            }
            while (audioSendActive || audioSendQueue.Count > 0)
            {
                if (!audioSendActive) await FlushAudioQueue();
                await Task.Yield();
            }
            await SendAsync(new { type = "audio.end", requestID });
        }

        void PumpMicrophone()
        {
            if (microphoneClip == null || !IsConnected) return;
            var position = Microphone.GetPosition(string.IsNullOrWhiteSpace(microphoneDevice) ? null : microphoneDevice);
            if (position < 0 || position == microphoneReadPosition) return;
            var count = position > microphoneReadPosition ? position - microphoneReadPosition : microphoneClip.samples - microphoneReadPosition + position;
            count = Mathf.Min(count, microphoneSampleRate / 10);
            if (count <= 0) return;
            var samples = new float[count];
            microphoneClip.GetData(samples, microphoneReadPosition);
            microphoneReadPosition = (microphoneReadPosition + count) % microphoneClip.samples;
            var sum = 0f;
            for (var index = 0; index < samples.Length; index++) sum += samples[index] * samples[index];
            var level = Mathf.Sqrt(sum / samples.Length);
            if (handsFree && !microphoneStreaming && level >= voiceActivationThreshold) BeginAudioInput("hands_free");
            if (!microphoneStreaming) return;
            if (level >= voiceActivationThreshold)
            {
                microphoneSpeechDetected = true;
                lastMicrophoneSpeechAt = Time.unscaledTime;
            }
            QueueAudio(ToPCM16(samples));
            if (handsFree && microphoneSpeechDetected && Time.unscaledTime - lastMicrophoneSpeechAt >= handsFreeSilenceSeconds) EndAudioInput(false);
        }

        static byte[] ToPCM16(float[] samples)
        {
            var bytes = new byte[samples.Length * 2];
            for (var index = 0; index < samples.Length; index++)
            {
                var value = (short)Mathf.RoundToInt(Mathf.Clamp(samples[index], -1f, 1f) * short.MaxValue);
                bytes[index * 2] = (byte)(value & 0xff);
                bytes[index * 2 + 1] = (byte)((value >> 8) & 0xff);
            }
            return bytes;
        }

        void QueueAudio(byte[] chunk)
        {
            if (chunk == null || chunk.Length == 0) return;
            if (audioSendQueue.Count >= 32) audioSendQueue.Dequeue();
            audioSendQueue.Enqueue(chunk);
            if (!audioFlowPaused) _ = FlushAudioQueue();
        }

        async Task FlushAudioQueue()
        {
            var currentTransport = transport;
            var currentLifetime = transportLifetime;
            if (audioSendActive || audioFlowPaused || currentTransport == null || currentLifetime == null ||
                currentTransport.State != WebSocketState.Open || currentLifetime.IsCancellationRequested) return;
            audioSendActive = true;
            try
            {
                while (!audioFlowPaused && audioSendQueue.Count > 0 && ReferenceEquals(transport, currentTransport) &&
                    !currentLifetime.IsCancellationRequested)
                    await currentTransport.SendBinaryAsync(audioSendQueue.Dequeue(), currentLifetime.Token);
            }
            catch (Exception error) when (IsTransportDisconnect(error) || currentLifetime.IsCancellationRequested)
            {
                CancelTransportAttempt(currentTransport, currentLifetime);
            }
            catch (Exception error) { RaiseError(error.Message); }
            finally { audioSendActive = false; }
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
            var risk = capability.Manifest.risk == "critical" ? AvatarRisk.Critical : capability.Manifest.risk == "interaction" ? AvatarRisk.Interaction : AvatarRisk.Ambient;
            if (scenarioRunner?.Run?.status == "running" && !scenarioRunner.CanAcceptTraineeAction(request.actionID, risk, out var scenarioReason))
            {
                await SendActionResult(request.id, AvatarActionResult.Failure(scenarioReason)); return;
            }
            if (!capability.CheckPreconditions(request.args ?? new JObject(), out var reason))
            {
                await SendActionResult(request.id, AvatarActionResult.Failure(reason)); return;
            }
            var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            cancellation.CancelAfter(Mathf.Clamp(request.timeoutMs, 100, 300000));
            activeActions[request.id] = cancellation;
            activeActionCancellable[request.id] = capability.Manifest.cancellable;
            AvatarActionResult result;
            try { result = await capability.ExecuteAsync(request.args ?? new JObject(), cancellation.Token); }
            catch (OperationCanceledException) { capability.Cancel(); result = AvatarActionResult.Failure("Action cancelled."); }
            catch (Exception error) { result = AvatarActionResult.Failure(error.Message); }
            activeActions.Remove(request.id);
            activeActionCancellable.Remove(request.id);
            cancellation.Dispose();
            completedActions[request.id] = result;
            capabilityRegistry?.ReportResult(request, result);
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

        void ResetSpeechPresentation()
        {
            if (visemePlayback != null) StopCoroutine(visemePlayback);
            if (audioPlaybackCompletion != null) StopCoroutine(audioPlaybackCompletion);
            visemePlayback = null;
            audioPlaybackCompletion = null;
            completeTurnAfterAudio = false;
            audioDecodeActive = false;
            playbackQueue.Clear();
            audioSource?.Stop();
            AudioPlaybackState = "Idle";
            onViseme?.Invoke(null, 0f);
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
            var currentTransport = transport;
            var currentLifetime = transportLifetime;
            if (currentTransport == null || currentLifetime == null || currentTransport.State != WebSocketState.Open ||
                currentLifetime.IsCancellationRequested) return;
            try { await currentTransport.SendTextAsync(AvatarJson.Serialize(value), currentLifetime.Token); }
            catch (Exception error) when (IsTransportDisconnect(error) || currentLifetime.IsCancellationRequested)
            {
                CancelTransportAttempt(currentTransport, currentLifetime);
            }
            catch (Exception error) { RaiseError(error.Message); }
        }

        void CancelTransportAttempt(IAvatarTransport currentTransport, CancellationTokenSource currentLifetime)
        {
            if (!ReferenceEquals(transport, currentTransport) || !ReferenceEquals(transportLifetime, currentLifetime)) return;
            currentLifetime.Cancel();
            SetRetrying("Connection interrupted.", false);
        }

        static bool IsTransportDisconnect(Exception error)
        {
            if (error is OperationCanceledException || error is WebSocketException || error is ObjectDisposedException) return true;
            if (error is IOException && error.InnerException != null) return IsTransportDisconnect(error.InnerException);
            if (error.InnerException != null && IsTransportDisconnect(error.InnerException)) return true;
            return error is InvalidOperationException &&
                (error.Message.IndexOf("transport is not connected", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 error.Message.IndexOf("websocket is in an invalid state", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 error.Message.IndexOf("operation was aborted", StringComparison.OrdinalIgnoreCase) >= 0);
        }

        Task SendAsync(AvatarSpeechFrame frame, string type) => SendAsync(new
        {
            type,
            frame.requestID,
            frame.codec,
            frame.sampleRate,
            frame.channels,
            frame.locale,
            frame.mode,
            frame.purpose,
            frame.demonstrationID,
        });

        void HandleAudioChunk(byte[] payload)
        {
            if (payload.Length < 12 || payload[0] != (byte)'O' || payload[1] != (byte)'C' || payload[2] != (byte)'A' || payload[3] != (byte)'V') return;
            audioBuffer.Write(payload, 12, payload.Length - 12);
        }

        void QueueAudioPlayback(byte[] bytes, string contentType, VisemeCue[] visemes)
        {
            mainThread.Enqueue(() =>
            {
                playbackQueue.Enqueue(new PendingPlayback
                {
                    bytes = bytes,
                    contentType = contentType,
                    visemes = visemes ?? Array.Empty<VisemeCue>(),
                });
                if (!audioDecodeActive && (audioSource == null || !audioSource.isPlaying)) _ = PlayNextAudio();
            });
        }

        async Task PlayNextAudio()
        {
            if (audioDecodeActive || playbackQueue.Count == 0) return;
            audioDecodeActive = true;
            var pending = playbackQueue.Dequeue();
            var bytes = pending.bytes;
            var contentType = pending.contentType;
            if (audioSource == null)
            {
                audioDecodeActive = false;
                mainThread.Enqueue(() => AudioPlaybackState = "Error");
                RaiseError("Agent voice cannot play because the character AudioSource is missing.");
                return;
            }
            if (bytes.Length == 0)
            {
                audioDecodeActive = false;
                mainThread.Enqueue(() => AudioPlaybackState = "Error");
                RaiseError("Agent voice response contained no audio data.");
                return;
            }
            if (contentType != null && contentType.IndexOf("wav", StringComparison.OrdinalIgnoreCase) < 0)
            {
                audioDecodeActive = false;
                mainThread.Enqueue(() => AudioPlaybackState = "Error");
                RaiseError("Agent voice returned unsupported audio type: " + contentType + ".");
                return;
            }
            try
            {
                mainThread.Enqueue(() => AudioPlaybackState = "Decoding");
                var wav = await Task.Run(() => AvatarWav.Decode(bytes));
                mainThread.Enqueue(() =>
                {
                    var clip = AudioClip.Create("Embodied Agent Voice", wav.samples.Length / wav.channels, wav.channels, wav.rate, false);
                    clip.SetData(wav.samples, 0);
                    audioSource.Stop();
                    audioSource.mute = false;
                    audioSource.volume = 1f;
                    audioSource.clip = clip;
                    audioSource.Play();
                    AudioPlaybackState = "Playing";
                    pendingVisemes = pending.visemes;
                    if (visemePlayback != null) StopCoroutine(visemePlayback);
                    if (audioPlaybackCompletion != null) StopCoroutine(audioPlaybackCompletion);
                    visemePlayback = StartCoroutine(PlayVisemes(pendingVisemes));
                    audioPlaybackCompletion = StartCoroutine(FinishAudioPlayback());
                });
            }
            catch (Exception error)
            {
                audioDecodeActive = false;
                mainThread.Enqueue(() => AudioPlaybackState = "Error");
                RaiseError("Could not play agent voice: " + error.Message);
            }
        }

        void RaiseError(string message) => mainThread.Enqueue(() =>
        {
            LastError = message;
            Debug.LogWarning("Embodied Agent Avatar Bridge: " + message, this);
            onError?.Invoke(message);
        });

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

        System.Collections.IEnumerator FinishAudioPlayback()
        {
            yield return null;
            while (audioSource != null && audioSource.isPlaying) yield return null;
            visemePlayback = null;
            audioPlaybackCompletion = null;
            audioDecodeActive = false;
            AudioPlaybackState = "Idle";
            onViseme?.Invoke(null, 0f);
            if (playbackQueue.Count > 0)
            {
                _ = PlayNextAudio();
                yield break;
            }
            if (!completeTurnAfterAudio) yield break;
            completeTurnAfterAudio = false;
            onAssistantState?.Invoke("idle");
        }
    }
}
