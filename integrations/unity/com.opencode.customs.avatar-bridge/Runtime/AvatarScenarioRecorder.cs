using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Events;

namespace OpenCode.Customs.AvatarBridge
{
    [Serializable] public sealed class AvatarReplayEvent : UnityEvent<string> { }

    public sealed class AvatarScenarioRecorder : MonoBehaviour
    {
        public AvatarWorldSensor sensor;
        public bool recordOnStart;
        public AvatarReplayEvent onReplayFrame;
        readonly List<string> frames = new List<string>();
        float started;
        public bool Recording { get; private set; }

        void Start() { if (recordOnStart) StartRecording(); }

        public void StartRecording()
        {
            frames.Clear(); started = Time.unscaledTime; Recording = true;
            if (sensor == null) return;
            sensor.SnapshotReady += Record;
            sensor.DeltaReady += Record;
            sensor.EventReady += Record;
        }

        public string StopAndSave(string filename = null)
        {
            Recording = false;
            if (sensor != null)
            {
                sensor.SnapshotReady -= Record;
                sensor.DeltaReady -= Record;
                sensor.EventReady -= Record;
            }
            var path = Path.Combine(Application.persistentDataPath, filename ?? $"avatar-scenario-{DateTime.UtcNow:yyyyMMdd-HHmmss}.jsonl");
            File.WriteAllLines(path, frames);
            return path;
        }

        public async Task ReplayAsync(string path, float speed = 1f, CancellationToken cancellation = default)
        {
            foreach (var line in File.ReadLines(path))
            {
                cancellation.ThrowIfCancellationRequested();
                var separator = line.IndexOf('\t');
                if (separator < 0) continue;
                var delay = float.Parse(line.Substring(0, separator), System.Globalization.CultureInfo.InvariantCulture) / Mathf.Max(0.1f, speed);
                await Task.Delay(TimeSpan.FromSeconds(delay), cancellation);
                onReplayFrame?.Invoke(line.Substring(separator + 1));
            }
        }

        void Record(object value)
        {
            if (!Recording) return;
            var elapsed = Time.unscaledTime - started;
            started = Time.unscaledTime;
            frames.Add(elapsed.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\t" + AvatarJson.Serialize(value));
        }
    }
}
