using System;
using System.Linq;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace EmbodiedAgent.Unity.Editor
{
    public sealed class ScenarioValidationWindow : EditorWindow
    {
        const string RuntimeUrl = "http://127.0.0.1:57110";
        const string PendingScenario = "EmbodiedAgent.Validation.Scenario";
        const string StartedPlay = "EmbodiedAgent.Validation.StartedPlay";
        const string Submitted = "EmbodiedAgent.Validation.Submitted";
        EmbodiedScenario scenario;
        string status = "Validate the open training with Guided, Blind, adversarial and Replay gates.";
        MessageType statusType = MessageType.Info;
        JObject report;
        Vector2 scroll;
        bool requestBusy;
        double nextPoll;

        public static void Open(EmbodiedScenario value, System.Collections.Generic.List<ScenarioIssue> issues)
        {
            var window = GetWindow<ScenarioValidationWindow>("Validate Training");
            window.scenario = value;
            window.report = null;
            window.Show();
            window.StartValidation(false);
        }

        [MenuItem("Embodied Agent/Validate Training")]
        public static void Open() => GetWindow<ScenarioValidationWindow>("Validate Training");

        void OnEnable()
        {
            EditorApplication.update += Poll;
            var path = SessionState.GetString(PendingScenario, string.Empty);
            if (scenario == null && !string.IsNullOrWhiteSpace(path)) scenario = AssetDatabase.LoadAssetAtPath<EmbodiedScenario>(path);
        }

        void OnDisable() => EditorApplication.update -= Poll;

        void OnGUI()
        {
            EditorGUILayout.LabelField("Validate Training", EditorStyles.boldLabel);
            scenario = (EmbodiedScenario)EditorGUILayout.ObjectField("Scenario", scenario, typeof(EmbodiedScenario), false);
            EditorGUILayout.HelpBox("Runs deterministic checks, model qualification, live Guided and Blind passes, safe fault fixtures and Replay assertions. Unity assets are never changed.", MessageType.Info);
            EditorGUILayout.HelpBox(status, statusType);
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(requestBusy || scenario == null || HasPending()))
                    if (GUILayout.Button("Validate Training", GUILayout.Height(34f))) StartValidation(false);
                using (new EditorGUI.DisabledScope(requestBusy || scenario == null || HasPending()))
                    if (GUILayout.Button("Run Quest device gate", GUILayout.Height(34f))) StartValidation(true);
            }
            using (new EditorGUI.DisabledScope(!HasPending()))
                if (GUILayout.Button("Cancel")) CancelValidation();
            if (report == null) return;
            EditorGUILayout.Space();
            var readiness = report.Value<string>("readiness") ?? "unknown";
            EditorGUILayout.LabelField("Result: " + readiness.Replace('_', ' ').ToUpperInvariant(), EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(report.Value<string>("summary") ?? string.Empty,
                readiness == "ready" ? MessageType.Info : readiness == "needs_work" ? MessageType.Warning : MessageType.Error);
            var qualification = report["qualification"] as JObject;
            if (qualification != null)
                EditorGUILayout.LabelField("Model", $"JSON {qualification.Value<float>("validJSONRate") * 100f:0}% · correct {qualification.Value<float>("correctDecisionRate") * 100f:0}% · p95 {qualification.Value<int>("p95DecisionLatencyMs")} ms");
            DrawRun("Guided", report["guided"] as JObject);
            DrawRun("Blind", report["blind"] as JObject);
            foreach (var token in report["platforms"] as JArray ?? new JArray())
            {
                if (!(token is JObject platform)) continue;
                EditorGUILayout.LabelField((platform.Value<string>("platform") ?? "platform").ToUpperInvariant(),
                    (platform.Value<string>("status") ?? "unknown") + (string.IsNullOrWhiteSpace(platform.Value<string>("detail")) ? string.Empty : " · " + platform.Value<string>("detail")));
            }
            scroll = EditorGUILayout.BeginScrollView(scroll);
            foreach (var token in report["findings"] as JArray ?? new JArray())
            {
                if (!(token is JObject finding)) continue;
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    EditorGUILayout.LabelField(finding.Value<string>("title") ?? finding.Value<string>("code"), EditorStyles.boldLabel);
                    EditorGUILayout.LabelField(finding.Value<string>("detail") ?? string.Empty, EditorStyles.wordWrappedLabel);
                    EditorGUILayout.LabelField("Fix: " + (finding.Value<string>("recommendation") ?? string.Empty), EditorStyles.wordWrappedLabel);
                    if (!string.IsNullOrWhiteSpace(finding.Value<string>("stepID")) && GUILayout.Button("Open scenario step"))
                    {
                        Selection.activeObject = scenario;
                        EmbodiedScenarioStudio.Open(scenario);
                    }
                }
            }
            foreach (var token in report["replayAssertions"] as JArray ?? new JArray())
            {
                if (!(token is JObject replay)) continue;
                EditorGUILayout.LabelField("Replay · " + (replay.Value<string>("fixtureID") ?? "fixture"),
                    replay.Value<bool>("passed") ? "Passed" : "Failed: " + (replay.Value<string>("firstFailure") ?? "unknown"));
            }
            EditorGUILayout.EndScrollView();
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Export JSON")) SaveExport("json");
                if (GUILayout.Button("Export HTML")) SaveExport("html");
                if (GUILayout.Button("Export JUnit")) SaveExport("junit.xml");
            }
        }

        static void DrawRun(string label, JObject run)
        {
            if (run == null) return;
            var summary = (run.Value<string>("status") ?? "unknown") + $" · {run.Value<int>("successfulActions")}/{run.Value<int>("attempts")} successful";
            var divergence = run["firstDivergence"] as JObject;
            if (divergence != null) summary += $" · first divergence {divergence.Value<int>("sequence")}: expected {divergence.Value<string>("expected")}, got {divergence.Value<string>("actual")}";
            EditorGUILayout.LabelField(label, summary);
        }

        void StartValidation(bool quest)
        {
            if (scenario == null) return;
            SessionState.SetString(PendingScenario, AssetDatabase.GetAssetPath(scenario));
            SessionState.SetBool(StartedPlay, !EditorApplication.isPlaying);
            SessionState.SetBool(Submitted, false);
            SessionState.SetBool("EmbodiedAgent.Validation.Quest", quest);
            report = null;
            status = EditorApplication.isPlaying ? "Waiting for Runtime and Unity Bridge…" : "Entering Play Mode…";
            statusType = MessageType.Info;
            if (!EditorApplication.isPlaying) EditorApplication.isPlaying = true;
        }

        async void Poll()
        {
            if (!HasPending() || requestBusy || EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 1;
            if (!EditorApplication.isPlaying) return;
            requestBusy = true;
            try
            {
                using var client = AITraineeTestWindow.AuthorizedClient();
                if (!SessionState.GetBool(Submitted, false))
                {
                    var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
                    var issues = EmbodiedScenarioValidator.Validate(scenario, registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests());
                    var payload = new JObject
                    {
                        ["scenarioID"] = scenario.scenarioID,
                        ["scenarioRevision"] = scenario.revision,
                        ["target"] = SessionState.GetBool("EmbodiedAgent.Validation.Quest", false) ? "quest" : "desktop",
                        ["qualificationMode"] = "standard",
                        ["goldenPath"] = new JArray(scenario.steps.Where(step => step != null && step.type == ScenarioStepType.RequestAction).SelectMany(step => step.allowedCapabilityIDs ?? Array.Empty<string>())),
                        ["deterministicIssues"] = new JArray(issues.Select(issue => new JObject
                        {
                            ["code"] = issue.code.Replace('.', '_'),
                            ["severity"] = issue.severity == ScenarioIssueSeverity.Error ? "error" : issue.severity == ScenarioIssueSeverity.Warning ? "warning" : "info",
                            ["message"] = issue.message,
                            ["stepID"] = string.IsNullOrWhiteSpace(issue.stepID) ? null : issue.stepID,
                        })),
                    };
                    var response = await client.PostAsync(RuntimeUrl + "/v1/validation/runs", new StringContent(payload.ToString(), Encoding.UTF8, "application/json"));
                    var body = JObject.Parse(await response.Content.ReadAsStringAsync());
                    if (!response.IsSuccessStatusCode) throw new InvalidOperationException(body.Value<string>("error") ?? "Validation could not start.");
                    SessionState.SetBool(Submitted, true);
                    status = "Validation started…";
                }
                var current = JObject.Parse(await client.GetStringAsync(RuntimeUrl + "/v1/validation/runs"));
                var active = current["active"] as JObject;
                report = current["report"] as JObject;
                if (active != null) status = "Stage: " + (active.Value<string>("stage") ?? active.Value<string>("status"));
                if (report != null)
                {
                    status = "Validation completed.";
                    statusType = report.Value<string>("readiness") == "ready" ? MessageType.Info : report.Value<string>("readiness") == "needs_work" ? MessageType.Warning : MessageType.Error;
                    FinishPending();
                }
                Repaint();
            }
            catch (Exception error)
            {
                status = "Waiting: " + error.Message;
                statusType = MessageType.Warning;
                Repaint();
            }
            finally { requestBusy = false; }
        }

        async void CancelValidation()
        {
            requestBusy = true;
            try
            {
                using var client = AITraineeTestWindow.AuthorizedClient();
                await client.PostAsync(RuntimeUrl + "/v1/validation/cancel", new StringContent("{}", Encoding.UTF8, "application/json"));
            }
            catch (Exception error) { status = error.Message; statusType = MessageType.Error; }
            requestBusy = false;
            FinishPending();
        }

        void FinishPending()
        {
            var exitPlay = SessionState.GetBool(StartedPlay, false);
            SessionState.EraseString(PendingScenario);
            SessionState.EraseBool(StartedPlay);
            SessionState.EraseBool(Submitted);
            SessionState.EraseBool("EmbodiedAgent.Validation.Quest");
            if (exitPlay && EditorApplication.isPlaying) EditorApplication.isPlaying = false;
        }

        async void SaveExport(string extension)
        {
            var id = report?.Value<string>("id");
            if (string.IsNullOrWhiteSpace(id)) return;
            var path = EditorUtility.SaveFilePanel("Export Scenario Quality Report", string.Empty, id + "." + extension, extension == "junit.xml" ? "xml" : extension);
            if (string.IsNullOrWhiteSpace(path)) return;
            try
            {
                using var client = AITraineeTestWindow.AuthorizedClient();
                var bytes = await client.GetByteArrayAsync(RuntimeUrl + "/v1/validation/reports/" + Uri.EscapeDataString(id) + "." + extension);
                System.IO.File.WriteAllBytes(path, bytes);
                status = "Report exported to " + path;
                statusType = MessageType.Info;
            }
            catch (Exception error) { status = error.Message; statusType = MessageType.Error; }
            Repaint();
        }

        static bool HasPending() => !string.IsNullOrWhiteSpace(SessionState.GetString(PendingScenario, string.Empty));
    }
}
