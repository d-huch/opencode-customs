using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace EmbodiedAgent.Unity
{
    public sealed class InstructorIntervention
    {
        public string requestID;
        public string instructorID;
        public string command;
        public string stepID;
        public int attempt;
        public long timestamp;
        public string evidenceID;
        public string reason;
        public string valueHash;
    }

    public sealed class TrainingOutcome
    {
        public string deploymentID;
        public string traineeID;
        public string sessionID;
        public string runID;
        public string scenarioID;
        public int scenarioRevision;
        public string status;
        public string reason;
        public long startedAt;
        public long completedAt;
        public long durationMs;
        public List<ScenarioStepOutcome> steps = new List<ScenarioStepOutcome>();
        public List<InstructorIntervention> instructorInterventions = new List<InstructorIntervention>();
        public TrainingAssessment assessment;
        public TrainingActorMetrics actor;

        public static TrainingOutcome From(ScenarioRun run, string reason) => new TrainingOutcome
        {
            deploymentID = run.deploymentID, traineeID = run.traineeID, sessionID = run.sessionID,
            runID = run.runID, scenarioID = run.scenarioID, scenarioRevision = run.scenarioRevision,
            status = run.status, reason = reason, startedAt = run.startedAt, completedAt = run.completedAt,
            durationMs = Math.Max(0, run.completedAt - run.startedAt), steps = run.steps,
            instructorInterventions = run.instructorInterventions,
        };
    }

    [Serializable]
    public sealed class TrainingActorMetrics
    {
        public string type;
        public string runID;
        public string model;
        public string profile;
        public int decisions;
    }

    [Serializable]
    public sealed class TrainingAssessment
    {
        public bool passed;
        public long durationMs;
        public float firstAttemptAccuracy;
        public int unsafeAttempts;
        public int hintsUsed;
        public int completedSteps;
        public int totalSteps;
        public string demonstrationRevision;
    }

    public interface ITrainingResultSink
    {
        Task WriteAsync(TrainingOutcome outcome, CancellationToken cancellation = default);
    }

    public sealed class JsonTrainingResultSink : ITrainingResultSink
    {
        readonly string directory;
        public JsonTrainingResultSink(string directory = null) => this.directory = directory ?? Path.Combine(Application.persistentDataPath, "EmbodiedAgent", "Results");
        public Task WriteAsync(TrainingOutcome outcome, CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            Directory.CreateDirectory(directory);
            return File.WriteAllTextAsync(Path.Combine(directory, Safe(outcome.runID) + ".json"), JsonConvert.SerializeObject(outcome, Formatting.Indented), cancellation);
        }
        static string Safe(string value) => string.Concat((value ?? "run").Where(character => char.IsLetterOrDigit(character) || character == '-' || character == '_'));
    }

    public sealed class CsvTrainingResultSink : ITrainingResultSink
    {
        readonly string path;
        public CsvTrainingResultSink(string path = null) => this.path = path ?? Path.Combine(Application.persistentDataPath, "EmbodiedAgent", "training-results.csv");
        public Task WriteAsync(TrainingOutcome outcome, CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            var header = "deployment_id,trainee_id,session_id,run_id,scenario_id,scenario_revision,status,started_at,completed_at,duration_ms\n";
            var line = string.Join(",", new[]
            {
                outcome.deploymentID, outcome.traineeID, outcome.sessionID, outcome.runID, outcome.scenarioID,
                outcome.scenarioRevision.ToString(CultureInfo.InvariantCulture), outcome.status,
                outcome.startedAt.ToString(CultureInfo.InvariantCulture), outcome.completedAt.ToString(CultureInfo.InvariantCulture),
                outcome.durationMs.ToString(CultureInfo.InvariantCulture),
            }.Select(Escape)) + "\n";
            if (!File.Exists(path)) File.WriteAllText(path, header);
            File.AppendAllText(path, line);
            return Task.CompletedTask;
        }
        static string Escape(string value) => "\"" + (value ?? string.Empty).Replace("\"", "\"\"") + "\"";
    }

    public sealed class AuditBundleTrainingResultSink : ITrainingResultSink
    {
        readonly string directory;
        public AuditBundleTrainingResultSink(string directory = null) => this.directory = directory ?? Path.Combine(Application.persistentDataPath, "EmbodiedAgent", "Audit");
        public Task WriteAsync(TrainingOutcome outcome, CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            Directory.CreateDirectory(directory);
            var previousHash = new string('0', 64);
            var events = new JArray();
            foreach (var step in outcome.steps.OrderBy(value => value.startedAt))
            {
                var value = JObject.FromObject(new { type = "scenario.step", step.stepID, step.attempt, step.outcome, step.startedAt, step.completedAt, step.evidence });
                var hash = Hash(previousHash + value.ToString(Formatting.None));
                value["previousHash"] = previousHash;
                value["hash"] = hash;
                events.Add(value);
                previousHash = hash;
            }
            foreach (var intervention in outcome.instructorInterventions.OrderBy(value => value.timestamp))
            {
                var value = JObject.FromObject(new
                {
                    type = "instructor.intervention", intervention.requestID, intervention.instructorID, intervention.command,
                    intervention.stepID, intervention.attempt, intervention.timestamp, intervention.evidenceID,
                    intervention.reason, intervention.valueHash,
                });
                var hash = Hash(previousHash + value.ToString(Formatting.None));
                value["previousHash"] = previousHash;
                value["hash"] = hash;
                events.Add(value);
                previousHash = hash;
            }
            var bundle = new JObject
            {
                ["format"] = "embodied-agent-audit-v1", ["outcome"] = JObject.FromObject(outcome),
                ["events"] = events, ["rootHash"] = previousHash,
            };
            return File.WriteAllTextAsync(Path.Combine(directory, outcome.runID + ".audit.json"), bundle.ToString(Formatting.Indented), cancellation);
        }
        static string Hash(string value)
        {
            using var algorithm = SHA256.Create();
            return string.Concat(algorithm.ComputeHash(Encoding.UTF8.GetBytes(value)).Select(valueByte => valueByte.ToString("x2")));
        }
    }

    public sealed class XApiTrainingResultSink : ITrainingResultSink, IDisposable
    {
        readonly HttpClient client;
        readonly Uri endpoint;
        readonly string actorAccount;

        public XApiTrainingResultSink(Uri endpoint, string bearerToken, string actorAccount)
        {
            if (endpoint == null || (endpoint.Scheme != Uri.UriSchemeHttps && !(endpoint.Scheme == Uri.UriSchemeHttp && endpoint.IsLoopback)))
                throw new ArgumentException("xAPI endpoint must use HTTPS, except for an explicit loopback LRS.", nameof(endpoint));
            this.endpoint = endpoint;
            this.actorAccount = actorAccount;
            client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            if (!string.IsNullOrWhiteSpace(bearerToken)) client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
            client.DefaultRequestHeaders.Add("X-Experience-API-Version", "1.0.3");
        }

        public async Task WriteAsync(TrainingOutcome outcome, CancellationToken cancellation = default)
        {
            var statementID = StableStatementID(outcome.runID + ":" + outcome.scenarioID + ":" + outcome.scenarioRevision);
            var statement = new JObject
            {
                ["id"] = statementID,
                ["actor"] = new JObject { ["objectType"] = "Agent", ["account"] = new JObject { ["homePage"] = "urn:embodied-agent", ["name"] = actorAccount } },
                ["verb"] = new JObject { ["id"] = outcome.status == "completed" ? "http://adlnet.gov/expapi/verbs/completed" : "http://adlnet.gov/expapi/verbs/failed", ["display"] = new JObject { ["en-US"] = outcome.status } },
                ["object"] = new JObject { ["id"] = "urn:embodied-agent:scenario:" + outcome.scenarioID, ["objectType"] = "Activity" },
                ["result"] = new JObject { ["completion"] = outcome.status == "completed", ["duration"] = XmlDuration(outcome.durationMs), ["extensions"] = new JObject { ["https://embodied-agent.dev/extensions/revision"] = outcome.scenarioRevision, ["https://embodied-agent.dev/extensions/run"] = outcome.runID } },
                ["timestamp"] = DateTimeOffset.FromUnixTimeMilliseconds(outcome.completedAt).ToString("O"),
            };
            using var content = new StringContent(statement.ToString(Formatting.None), Encoding.UTF8, "application/json");
            var builder = new UriBuilder(endpoint);
            if (!builder.Path.TrimEnd('/').EndsWith("/statements", StringComparison.OrdinalIgnoreCase)) builder.Path = builder.Path.TrimEnd('/') + "/statements";
            builder.Query = "statementId=" + Uri.EscapeDataString(statementID);
            using var request = new HttpRequestMessage(HttpMethod.Put, builder.Uri) { Content = content };
            using var response = await client.SendAsync(request, cancellation);
            response.EnsureSuccessStatusCode();
        }

        public void Dispose() => client.Dispose();
        static string StableStatementID(string value)
        {
            using var algorithm = SHA256.Create();
            var bytes = algorithm.ComputeHash(Encoding.UTF8.GetBytes(value)).Take(16).ToArray();
            bytes[6] = (byte)((bytes[6] & 0x0f) | 0x40);
            bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
            return new Guid(bytes).ToString();
        }
        static string XmlDuration(long milliseconds) => "PT" + Math.Max(0, milliseconds / 1000d).ToString("0.###", CultureInfo.InvariantCulture) + "S";
    }

    public sealed class TrainingResultExporter : MonoBehaviour
    {
        public EmbodiedScenarioRunner runner;
        public bool json = true;
        public bool csv;
        public bool audit = true;
        readonly List<ITrainingResultSink> sinks = new List<ITrainingResultSink>();

        void OnEnable()
        {
            if (runner == null) runner = GetComponent<EmbodiedScenarioRunner>();
            if (runner != null) runner.Completed += Export;
        }
        void OnDisable() { if (runner != null) runner.Completed -= Export; }
        public void AddSink(ITrainingResultSink sink) { if (sink != null) sinks.Add(sink); }

        async void Export(TrainingOutcome outcome)
        {
            var targets = new List<ITrainingResultSink>(sinks);
            if (json) targets.Add(new JsonTrainingResultSink());
            if (csv) targets.Add(new CsvTrainingResultSink());
            if (audit) targets.Add(new AuditBundleTrainingResultSink());
            foreach (var sink in targets)
                try { await sink.WriteAsync(outcome); }
                catch (Exception error) { Debug.LogError("Embodied Agent training result export failed: " + error.Message, this); }
        }
    }
}
