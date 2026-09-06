using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace EmbodiedAgent.Unity.Editor
{
    public sealed class DemonstrationReviewWizard : EditorWindow
    {
        const string RuntimeUrl = "http://127.0.0.1:57110";
        readonly List<ReviewStep> steps = new List<ReviewStep>();
        Vector2 scroll;
        string demonstrationID;
        string trainingTitle = "Recorded Equipment Isolation";
        string status = "Load a completed instructor recording from the local Runtime.";
        MessageType statusType = MessageType.Info;
        bool loading;

        sealed class ReviewStep
        {
            public bool included = true;
            public string id;
            public string title;
            public string instruction;
            public string entityID;
            public string capabilityID;
            public string risk;
            public string permissionCategory;
            public string[] postconditions = Array.Empty<string>();
            public string[] sourceEventIDs = Array.Empty<string>();
            public bool instructionOnly;
        }

        [MenuItem("Embodied Agent/Review Recorded Instruction")]
        public static void Open() => GetWindow<DemonstrationReviewWizard>("Review Demonstration");

        public static void Open(string id)
        {
            var window = GetWindow<DemonstrationReviewWizard>("Review Demonstration");
            window.demonstrationID = id;
            window.Load(id);
        }

        void OnGUI()
        {
            EditorGUILayout.LabelField("Teach-by-Demo Review", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Typed Unity interactions are authoritative. Edit wording and grouping here; entity and capability IDs remain locked to the recording.", MessageType.Info);
            using (new EditorGUILayout.HorizontalScope())
            {
                demonstrationID = EditorGUILayout.TextField("Recording ID", demonstrationID);
                using (new EditorGUI.DisabledScope(loading)) if (GUILayout.Button(loading ? "Loading…" : "Load latest", GUILayout.Width(110))) Load(string.IsNullOrWhiteSpace(demonstrationID) ? null : demonstrationID.Trim());
            }
            EditorGUILayout.HelpBox(status, statusType);
            trainingTitle = EditorGUILayout.TextField("Training title", trainingTitle);
            scroll = EditorGUILayout.BeginScrollView(scroll);
            for (var index = 0; index < steps.Count; index++) DrawStep(index);
            EditorGUILayout.EndScrollView();
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(!steps.Any(value => value.included)))
                {
                    if (GUILayout.Button("Save Scenario v1")) Save(false);
                    if (GUILayout.Button("Test this training")) Save(true);
                }
                if (GUILayout.Button("Cancel")) Close();
            }
        }

        void DrawStep(int index)
        {
            var step = steps[index];
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    step.included = EditorGUILayout.ToggleLeft("Include", step.included, GUILayout.Width(72));
                    EditorGUILayout.LabelField((index + 1) + ". " + (step.instructionOnly ? "Instruction" : step.entityID + " → " + step.capabilityID), EditorStyles.boldLabel);
                    using (new EditorGUI.DisabledScope(index == 0)) if (GUILayout.Button("↑", GUILayout.Width(28))) Move(index, index - 1);
                    using (new EditorGUI.DisabledScope(index == steps.Count - 1)) if (GUILayout.Button("↓", GUILayout.Width(28))) Move(index, index + 1);
                }
                step.title = EditorGUILayout.TextField("Step name", step.title);
                step.instruction = EditorGUILayout.TextArea(step.instruction, GUILayout.MinHeight(44));
                EditorGUILayout.LabelField("Risk", step.risk + (string.IsNullOrWhiteSpace(step.permissionCategory) ? string.Empty : " · " + step.permissionCategory));
                using (new EditorGUILayout.HorizontalScope())
                {
                    if (GUILayout.Button("Split copy")) Split(index);
                    using (new EditorGUI.DisabledScope(index == 0)) if (GUILayout.Button("Merge with previous")) Merge(index);
                    if (GUILayout.Button("Exclude")) step.included = false;
                }
            }
        }

        async void Load(string id)
        {
            loading = true;
            status = "Loading sanitized recording from Runtime…";
            statusType = MessageType.Info;
            Repaint();
            try
            {
                using var client = AuthorizedClient();
                var selectedID = id;
                if (string.IsNullOrWhiteSpace(selectedID))
                {
                    var runs = JArray.Parse(await client.GetStringAsync(RuntimeUrl + "/v1/demonstrations"));
                    selectedID = runs.FirstOrDefault(value => value.Value<string>("status") == "completed")?.Value<string>("demonstrationID");
                }
                if (string.IsNullOrWhiteSpace(selectedID)) throw new InvalidOperationException("No completed recording is available. Run Instructor Recording in Play Mode first.");
                var draft = JObject.Parse(await client.GetStringAsync(RuntimeUrl + "/v1/demonstrations/" + Uri.EscapeDataString(selectedID) + "/draft"));
                demonstrationID = selectedID;
                trainingTitle = draft.Value<string>("title") ?? trainingTitle;
                steps.Clear();
                foreach (var value in draft["steps"] as JArray ?? new JArray())
                    steps.Add(new ReviewStep
                    {
                        id = value.Value<string>("id"), title = value.Value<string>("title"), instruction = value.Value<string>("instruction"),
                        entityID = value.Value<string>("entityID"), capabilityID = value.Value<string>("capabilityID"), risk = value.Value<string>("risk"),
                        permissionCategory = value.Value<string>("permissionCategory"),
                        postconditions = value["postconditions"]?.Values<string>().ToArray() ?? Array.Empty<string>(),
                        sourceEventIDs = value["sourceEventIDs"]?.Values<string>().ToArray() ?? Array.Empty<string>(),
                    });
                var negatives = (draft["negativeExamples"] as JArray)?.Count ?? 0;
                status = steps.Count + " successful semantic actions loaded. " + negatives + " failed attempts retained as assessment examples.";
                statusType = MessageType.Info;
            }
            catch (Exception error)
            {
                status = error.Message;
                statusType = MessageType.Error;
            }
            loading = false;
            Repaint();
        }

        static HttpClient AuthorizedClient()
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Embodied Agent Runtime", "control.json");
            if (Application.platform == RuntimePlatform.OSXEditor)
                path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Personal), "Library", "Application Support", "Embodied Agent Runtime", "control.json");
            if (!File.Exists(path)) throw new FileNotFoundException("Runtime control file was not found. Start Embodied Agent Runtime first.", path);
            var control = JObject.Parse(File.ReadAllText(path));
            var token = control.Value<string>("token");
            if (string.IsNullOrWhiteSpace(token)) throw new InvalidDataException("Runtime control token is unavailable.");
            var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        void Move(int from, int to)
        {
            var value = steps[from];
            steps.RemoveAt(from);
            steps.Insert(to, value);
        }

        void Split(int index)
        {
            var source = steps[index];
            steps.Insert(index, new ReviewStep
            {
                id = source.id + "-instruction", title = source.title + " instruction", instruction = source.instruction,
                entityID = source.entityID, risk = source.risk, sourceEventIDs = source.sourceEventIDs.ToArray(), instructionOnly = true,
            });
            source.instruction = "Perform the recorded action on " + source.entityID + ".";
            status = "The narration is now a separate instruction. The physical action remains exactly once.";
            statusType = MessageType.Info;
        }

        void Merge(int index)
        {
            var previous = steps[index - 1];
            var current = steps[index];
            var compatible = previous.instructionOnly || current.instructionOnly ||
                previous.entityID == current.entityID && previous.capabilityID == current.capabilityID;
            if (!compatible)
            {
                status = "Scenario v1 cannot merge different physical actions into one step. Split narration into an instruction or keep both actions.";
                statusType = MessageType.Warning;
                return;
            }
            previous.instruction = (previous.instruction.TrimEnd() + " " + current.instruction.TrimStart()).Trim();
            previous.sourceEventIDs = previous.sourceEventIDs.Concat(current.sourceEventIDs).Distinct().ToArray();
            if (previous.instructionOnly && !current.instructionOnly)
            {
                previous.entityID = current.entityID;
                previous.capabilityID = current.capabilityID;
                previous.risk = current.risk;
                previous.permissionCategory = current.permissionCategory;
                previous.postconditions = current.postconditions;
                previous.instructionOnly = false;
            }
            current.included = false;
        }

        void Save(bool test)
        {
            var selected = steps.Where(value => value.included).ToArray();
            var path = FindExistingAsset() ?? EditorUtility.SaveFilePanelInProject("Save recorded training", "RecordedEquipmentIsolation", "asset", "Choose where to save the generated Scenario v1.");
            if (string.IsNullOrWhiteSpace(path)) return;
            var scenario = AssetDatabase.LoadAssetAtPath<EmbodiedScenario>(path);
            if (scenario == null)
            {
                scenario = CreateInstance<EmbodiedScenario>();
                AssetDatabase.CreateAsset(scenario, path);
            }
            scenario.schemaVersion = EmbodiedScenario.CurrentSchemaVersion;
            scenario.scenarioID = "recorded." + AvatarIDs.Normalize(demonstrationID, Guid.NewGuid().ToString("N"));
            scenario.title = trainingTitle.Trim();
            scenario.description = "Generated from demonstration " + demonstrationID + ". Review-approved typed actions only.";
            scenario.revision = Mathf.Max(1, scenario.revision + (AssetDatabase.Contains(scenario) && scenario.steps.Count > 0 ? 1 : 0));
            scenario.entryStepID = selected[0].id;
            scenario.steps = selected.Select((value, index) => new ScenarioStep
            {
                id = value.id, type = value.instructionOnly ? ScenarioStepType.Instruction : ScenarioStepType.RequestAction,
                title = value.title, instruction = value.instruction, timeoutSeconds = 120,
                allowedCapabilityIDs = value.instructionOnly ? Array.Empty<string>() : new[] { value.capabilityID },
                evidence = value.instructionOnly ? new List<EvidenceRule>() : value.sourceEventIDs.Select(eventID => new EvidenceRule { id = "demonstration." + eventID, label = value.entityID + " postcondition", source = "game", required = true }).ToList(),
                transitions = new List<ScenarioTransition> { new ScenarioTransition { outcome = "success", targetStepID = index + 1 < selected.Length ? selected[index + 1].id : "complete" } },
            }).Concat(new[] { new ScenarioStep { id = "complete", type = ScenarioStepType.Complete, title = "Training complete", instruction = "Review your assessment." } }).ToList();
            EditorUtility.SetDirty(scenario);
            AssetDatabase.SaveAssets();
            var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
            var issues = EmbodiedScenarioValidator.Validate(scenario, registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests());
            var error = issues.FirstOrDefault(value => value.severity == ScenarioIssueSeverity.Error);
            if (error != null)
            {
                status = error.code + ": " + error.message;
                statusType = MessageType.Error;
                return;
            }
            Selection.activeObject = scenario;
            status = "Scenario v1 saved: " + path;
            statusType = MessageType.Info;
            if (!test) return;
            var runner = FindAnyObjectByType<EmbodiedScenarioRunner>(FindObjectsInactive.Include);
            if (runner == null) { status = "Scenario saved. Add an EmbodiedScenarioRunner to test it."; statusType = MessageType.Warning; return; }
            runner.scenario = scenario;
            runner.demonstrationRevision = demonstrationID + ":1";
            EditorUtility.SetDirty(runner);
            EditorApplication.isPlaying = true;
        }

        string FindExistingAsset() => AssetDatabase.FindAssets("t:EmbodiedScenario")
            .Select(AssetDatabase.GUIDToAssetPath)
            .FirstOrDefault(path => AssetDatabase.LoadAssetAtPath<EmbodiedScenario>(path)?.description?.Contains("demonstration " + demonstrationID + ".") == true);
    }
}
