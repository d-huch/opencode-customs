using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace EmbodiedAgent.Unity
{
    public enum EmbodiedExperienceMode { InstructorRecording, TraineeTraining }

    [Serializable]
    public sealed class DemonstrationEvent
    {
        public string demonstrationID;
        public string eventID;
        public int sequence;
        public long timestamp;
        public string entityID;
        public string capabilityID;
        public string actionID;
        public bool ok;
        public string code;
        public string risk;
        public string permissionCategory;
        public string[] postconditions = Array.Empty<string>();
    }

    [Serializable]
    public sealed class DemonstrationRun
    {
        public string demonstrationID;
        public string title;
        public string status;
        public long startedAt;
        public long completedAt;
        public List<DemonstrationEvent> events = new List<DemonstrationEvent>();
    }

    [Serializable] public sealed class DemonstrationStringEvent : UnityEvent<string> { }

    public sealed class EmbodiedDemonstrationRecorder : MonoBehaviour
    {
        public EmbodiedAgentClient client;
        public EmbodiedExperienceMode mode = EmbodiedExperienceMode.TraineeTraining;
        public string recordingTitle = "Equipment Isolation Demonstration";
        public DemonstrationStringEvent onRecordingChanged = new DemonstrationStringEvent();
        public DemonstrationRun Run { get; private set; }
        public bool Recording => Run != null && Run.status == "recording";
        public int RemainingActions => Mathf.Max(0, 64 - (Run?.events.Count ?? 0));

        void Awake()
        {
            if (client == null) client = GetComponentInParent<EmbodiedAgentClient>();
        }

        void OnEnable()
        {
            if (client != null) client.onConnected.AddListener(OnConnected);
        }

        void OnDisable()
        {
            if (client != null) client.onConnected.RemoveListener(OnConnected);
        }

        void Update()
        {
            if (!Recording || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Run.startedAt <= 20 * 60_000) return;
            CancelRecording("Recording stopped after the 20-minute safety limit.");
        }

        public async void StartRecording()
        {
            if (Recording) return;
            if (client == null || !client.IsConnected)
            {
                onRecordingChanged?.Invoke("error:runtime_not_connected");
                return;
            }
            Run = new DemonstrationRun
            {
                demonstrationID = Guid.NewGuid().ToString("N"), title = recordingTitle,
                status = "recording", startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            mode = EmbodiedExperienceMode.InstructorRecording;
            await client.SendDemonstrationStartAsync(Run.demonstrationID, Run.title);
            onRecordingChanged?.Invoke("recording");
        }

        public async void StopRecording()
        {
            if (!Recording) return;
            Run.status = "completed";
            Run.completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await client.SendDemonstrationCompleteAsync(Run.demonstrationID, false);
            mode = EmbodiedExperienceMode.TraineeTraining;
            onRecordingChanged?.Invoke("completed:" + Run.demonstrationID);
        }

        public async void CancelRecording(string reason = "cancelled")
        {
            if (!Recording) return;
            Run.status = "cancelled";
            Run.completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await client.SendDemonstrationCompleteAsync(Run.demonstrationID, true);
            mode = EmbodiedExperienceMode.TraineeTraining;
            onRecordingChanged?.Invoke("cancelled:" + reason);
        }

        public async void RecordAction(string entityID, string capabilityID, string actionID, AvatarActionResult result, AvatarRisk risk, string permissionCategory, params string[] postconditions)
        {
            if (!Recording) return;
            if (Run.events.Count >= 64)
            {
                onRecordingChanged?.Invoke("limit:64");
                return;
            }
            var value = new DemonstrationEvent
            {
                demonstrationID = Run.demonstrationID, eventID = Guid.NewGuid().ToString("N"), sequence = Run.events.Count + 1,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), entityID = AvatarIDs.Normalize(entityID, "entity"),
                capabilityID = AvatarIDs.Normalize(capabilityID, "capability"), actionID = AvatarIDs.Normalize(actionID, "action"),
                ok = result != null && result.ok, code = AvatarIDs.Normalize(result?.code, result != null && result.ok ? "completed" : "failed"),
                risk = risk.ToString().ToLowerInvariant(), permissionCategory = permissionCategory,
                postconditions = postconditions ?? Array.Empty<string>(),
            };
            Run.events.Add(value);
            await client.SendDemonstrationEventAsync(value);
            onRecordingChanged?.Invoke("event:" + value.eventID);
        }

        public void BeginNarration() { if (Recording) client?.BeginDemonstrationVoiceCapture(Run.demonstrationID); }
        public void EndNarration() { if (Recording) client?.EndDemonstrationVoiceCapture(); }

        async void OnConnected(string _)
        {
            if (Run == null) return;
            await client.SendDemonstrationStartAsync(Run.demonstrationID, Run.title);
            foreach (var value in Run.events) await client.SendDemonstrationEventAsync(value);
            if (Run.status == "completed") await client.SendDemonstrationCompleteAsync(Run.demonstrationID, false);
            if (Run.status == "cancelled") await client.SendDemonstrationCompleteAsync(Run.demonstrationID, true);
        }
    }
}
