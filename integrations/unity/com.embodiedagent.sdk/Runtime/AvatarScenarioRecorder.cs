using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Events;

namespace EmbodiedAgent.Unity
{
    [Serializable] public sealed class AvatarReplayEvent : UnityEvent<string> { }

    public sealed class AvatarScenarioRecorder : MonoBehaviour
    {
        public AvatarWorldSensor sensor;
        public EmbodiedScenarioRunner scenarioRunner;
        public AvatarCapabilityRegistry capabilityRegistry;
        public bool recordOnStart;
        public AvatarReplayEvent onReplayFrame;
        readonly List<string> frames = new List<string>();
        readonly List<JObject> events = new List<JObject>();
        float started;
        float lastFrame;
        int sequence;
        public bool Recording { get; private set; }

        void Start() { if (recordOnStart) StartRecording(); }

        public void StartRecording()
        {
            StopSubscriptions();
            frames.Clear();
            events.Clear();
            sequence = 0;
            started = Time.unscaledTime;
            lastFrame = started;
            Recording = true;
            if (sensor != null)
            {
                sensor.SnapshotReady += Record;
                sensor.DeltaReady += Record;
                sensor.EventReady += Record;
            }
            if (scenarioRunner != null)
            {
                scenarioRunner.Lifecycle += RecordScenario;
                scenarioRunner.InstructorIntervened += RecordInstructorIntervention;
            }
            if (capabilityRegistry != null) capabilityRegistry.ActionExecuted += RecordAction;
        }

        public string StopAndSave(string filename = null)
        {
            Recording = false;
            StopSubscriptions();
            var path = Path.Combine(Application.persistentDataPath, filename ?? $"avatar-scenario-{DateTime.UtcNow:yyyyMMdd-HHmmss}.jsonl");
            File.WriteAllLines(path, frames);
            return path;
        }

        public string StopAndSaveFixture(string filename = null)
        {
            Recording = false;
            StopSubscriptions();
            var path = Path.Combine(Application.persistentDataPath, filename ?? $"embodied-replay-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json");
            var scenarioID = scenarioRunner?.Run?.scenarioID ?? "unity.fixture";
            var fixture = new JObject
            {
                ["id"] = scenarioID + "." + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss"),
                ["name"] = scenarioRunner?.scenario?.title ?? "Unity simulation fixture",
                ["events"] = new JArray(events),
            };
            File.WriteAllText(path, fixture.ToString(Formatting.Indented));
            return path;
        }

        public async Task ReplayAsync(string path, float speed = 1f, CancellationToken cancellation = default)
        {
            if (Path.GetExtension(path).Equals(".json", StringComparison.OrdinalIgnoreCase))
            {
                var fixture = JObject.Parse(File.ReadAllText(path));
                var previous = 0L;
                foreach (var value in fixture["events"] as JArray ?? new JArray())
                {
                    cancellation.ThrowIfCancellationRequested();
                    var current = value.Value<long?>("timestamp") ?? previous;
                    await Task.Delay(TimeSpan.FromMilliseconds(Math.Max(0, current - previous) / Mathf.Max(0.1f, speed)), cancellation);
                    previous = current;
                    var type = value.Value<string>("type") ?? string.Empty;
                    if (type.StartsWith("world.", StringComparison.Ordinal) || type.StartsWith("scenario.", StringComparison.Ordinal) || type.StartsWith("simulation.", StringComparison.Ordinal))
                        onReplayFrame?.Invoke(value.ToString(Formatting.None));
                }
                return;
            }
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
            var elapsed = Time.unscaledTime - lastFrame;
            lastFrame = Time.unscaledTime;
            frames.Add(elapsed.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\t" + AvatarJson.Serialize(value));
            var source = JObject.FromObject(value);
            var data = new JObject();
            if (source["revision"] != null) data["revision"] = source["revision"];
            if (source["entities"] is JArray entities) data["entityCount"] = entities.Count;
            Add(source.Value<string>("type") ?? "world.event", data);
        }

        void RecordScenario(ScenarioLifecycleRecord record)
        {
            if (!Recording || record == null) return;
            var value = new JObject
            {
                ["scenarioID"] = record.scenarioID,
                ["scenarioRevision"] = record.scenarioRevision,
                ["stepID"] = record.stepID,
                ["outcome"] = record.outcome,
                ["durationMs"] = record.durationMs,
            };
            if (record.evidence != null) value["evidenceHashes"] = JObject.FromObject(record.evidence.ToDictionary(item => item.Key, item => Hash(item.Value)));
            Add(record.type, value);
        }

        void RecordAction(GameActionRequest request, AvatarActionResult result)
        {
            if (!Recording || request == null) return;
            events.Add(new JObject
            {
                ["sequence"] = ++sequence,
                ["type"] = "action.executed",
                ["timestamp"] = Math.Max(0, (long)((Time.unscaledTime - started) * 1000)),
                ["actionID"] = request.actionID,
                ["idempotencyKey"] = request.idempotencyKey ?? request.id,
                ["data"] = new JObject { ["ok"] = result != null && result.ok, ["code"] = result?.code ?? "failed", ["postconditionsVerified"] = result != null && result.ok },
            });
        }

        void RecordInstructorIntervention(InstructorIntervention intervention)
        {
            if (!Recording || intervention == null) return;
            Add("instructor." + intervention.command, new JObject
            {
                ["requestID"] = intervention.requestID,
                ["instructorID"] = intervention.instructorID,
                ["stepID"] = intervention.stepID,
                ["attempt"] = intervention.attempt,
                ["evidenceID"] = intervention.evidenceID,
                ["valueHash"] = intervention.valueHash,
                ["source"] = intervention.command == "evidence" ? "instructor" : null,
            });
        }

        void Add(string type, JObject data)
        {
            events.Add(new JObject
            {
                ["sequence"] = ++sequence,
                ["type"] = type,
                ["timestamp"] = Math.Max(0, (long)((Time.unscaledTime - started) * 1000)),
                ["data"] = data,
            });
        }

        void StopSubscriptions()
        {
            if (sensor != null)
            {
                sensor.SnapshotReady -= Record;
                sensor.DeltaReady -= Record;
                sensor.EventReady -= Record;
            }
            if (scenarioRunner != null)
            {
                scenarioRunner.Lifecycle -= RecordScenario;
                scenarioRunner.InstructorIntervened -= RecordInstructorIntervention;
            }
            if (capabilityRegistry != null) capabilityRegistry.ActionExecuted -= RecordAction;
        }

        static string Hash(string value)
        {
            using var algorithm = SHA256.Create();
            return string.Concat(algorithm.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty)).Select(item => item.ToString("x2")));
        }
    }
}
