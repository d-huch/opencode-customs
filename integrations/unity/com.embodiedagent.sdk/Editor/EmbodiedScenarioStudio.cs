using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace EmbodiedAgent.Unity.Editor
{
    public sealed class EmbodiedScenarioStudio : EditorWindow
    {
        EmbodiedScenario scenario;
        SerializedObject serialized;
        int selectedStep;
        Vector2 stepsScroll;
        Vector2 detailsScroll;
        ScenarioStepType newStepType;
        List<ScenarioIssue> issues = new List<ScenarioIssue>();
        EmbodiedScenario baseline;
        string manifestPreview;
        Vector2 manifestScroll;

        [MenuItem("Embodied Agent/Scenario Studio")]
        public static void Open() => GetWindow<EmbodiedScenarioStudio>("Scenario Studio");

        public static void Open(EmbodiedScenario value)
        {
            var window = GetWindow<EmbodiedScenarioStudio>("Scenario Studio");
            window.Select(value);
            window.Show();
        }

        void OnGUI()
        {
            EditorGUILayout.LabelField("Embodied Agent Scenario Studio", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Create deterministic training steps and conditions. Scenario data cannot invoke arbitrary Unity methods.", MessageType.Info);
            var value = (EmbodiedScenario)EditorGUILayout.ObjectField("Scenario", scenario, typeof(EmbodiedScenario), false);
            if (value != scenario) Select(value);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("New guided checklist")) Select(EmbodiedScenarioTemplates.Create("Guided Checklist", ScenarioTemplate.GuidedChecklist));
                if (GUILayout.Button("New object inspection")) Select(EmbodiedScenarioTemplates.Create("Object Inspection", ScenarioTemplate.ObjectInspection));
                if (GUILayout.Button("New equipment isolation")) Select(EmbodiedScenarioTemplates.Create("Equipment Isolation", ScenarioTemplate.EquipmentIsolation));
            }
            if (scenario == null) return;
            if (GUILayout.Button("Validate Training", GUILayout.Height(34f))) ScenarioValidationWindow.Open(scenario, issues);
            if (GUILayout.Button("Advanced AI testing")) AITraineeTestWindow.Open();
            serialized.Update();
            EditorGUILayout.Space();
            using (new EditorGUILayout.HorizontalScope())
            {
                DrawSteps();
                DrawDetails();
            }
            serialized.ApplyModifiedProperties();
            if (GUI.changed)
            {
                EditorUtility.SetDirty(scenario);
                Validate();
            }
            DrawValidation();
        }

        void DrawSteps()
        {
            using (new EditorGUILayout.VerticalScope(GUILayout.Width(Mathf.Clamp(position.width * 0.3f, 220f, 340f))))
            {
                EditorGUILayout.LabelField("Steps", EditorStyles.boldLabel);
                stepsScroll = EditorGUILayout.BeginScrollView(stepsScroll, EditorStyles.helpBox, GUILayout.MinHeight(300));
                var steps = serialized.FindProperty("steps");
                for (var index = 0; index < steps.arraySize; index++)
                {
                    var step = steps.GetArrayElementAtIndex(index);
                    var id = step.FindPropertyRelative("id").stringValue;
                    var type = (ScenarioStepType)step.FindPropertyRelative("type").enumValueIndex;
                    var label = string.IsNullOrWhiteSpace(id) ? "(missing ID)" : id;
                    if (GUILayout.Toggle(selectedStep == index, type + " · " + label, "Button")) selectedStep = index;
                }
                EditorGUILayout.EndScrollView();
                using (new EditorGUILayout.HorizontalScope())
                {
                    newStepType = (ScenarioStepType)EditorGUILayout.EnumPopup(newStepType);
                    if (GUILayout.Button("Add", GUILayout.Width(64))) AddStep(newStepType);
                }
                using (new EditorGUI.DisabledScope(steps.arraySize < 2))
                {
                    using (new EditorGUILayout.HorizontalScope())
                    {
                        using (new EditorGUI.DisabledScope(selectedStep <= 0))
                            if (GUILayout.Button("Move up")) MoveStep(-1);
                        using (new EditorGUI.DisabledScope(selectedStep >= steps.arraySize - 1))
                            if (GUILayout.Button("Move down")) MoveStep(1);
                    }
                    if (GUILayout.Button("Remove selected")) RemoveStep();
                }
            }
        }

        void DrawDetails()
        {
            using (new EditorGUILayout.VerticalScope(GUILayout.ExpandWidth(true)))
            {
                EditorGUILayout.LabelField("Scenario", EditorStyles.boldLabel);
                EditorGUILayout.PropertyField(serialized.FindProperty("scenarioID"));
                EditorGUILayout.PropertyField(serialized.FindProperty("title"));
                EditorGUILayout.PropertyField(serialized.FindProperty("description"));
                EditorGUILayout.PropertyField(serialized.FindProperty("revision"));
                EditorGUILayout.PropertyField(serialized.FindProperty("entryStepID"));
                EditorGUILayout.Space();
                var steps = serialized.FindProperty("steps");
                if (steps.arraySize == 0) return;
                selectedStep = Mathf.Clamp(selectedStep, 0, steps.arraySize - 1);
                detailsScroll = EditorGUILayout.BeginScrollView(detailsScroll, EditorStyles.helpBox, GUILayout.MinHeight(360));
                DrawStep(steps.GetArrayElementAtIndex(selectedStep));
                EditorGUILayout.EndScrollView();
            }
        }

        void DrawStep(SerializedProperty step)
        {
            using (new EditorGUI.DisabledScope(IsLockedEquipmentIsolation()))
                EditorGUILayout.PropertyField(step.FindPropertyRelative("id"));
            EditorGUILayout.PropertyField(step.FindPropertyRelative("type"));
            EditorGUILayout.PropertyField(step.FindPropertyRelative("title"));
            EditorGUILayout.PropertyField(step.FindPropertyRelative("instruction"));
            EditorGUILayout.PropertyField(step.FindPropertyRelative("timeoutSeconds"));
            DrawCapabilities(step.FindPropertyRelative("allowedCapabilityIDs"));
            EditorGUILayout.PropertyField(step.FindPropertyRelative("entryConditions"), true);
            EditorGUILayout.PropertyField(step.FindPropertyRelative("completionConditions"), true);
            EditorGUILayout.PropertyField(step.FindPropertyRelative("evidence"), true);
            DrawTransitions(step.FindPropertyRelative("transitions"));
        }

        void DrawCapabilities(SerializedProperty values)
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Allowed capabilities", EditorStyles.boldLabel);
            var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
            var manifests = registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests().OrderBy(value => value.id, StringComparer.Ordinal).ToArray();
            if (manifests.Length == 0) EditorGUILayout.HelpBox("No capability manifest is available in the open scene.", MessageType.Warning);
            foreach (var manifest in manifests)
            {
                var index = Enumerable.Range(0, values.arraySize).Where(value => values.GetArrayElementAtIndex(value).stringValue == manifest.id).DefaultIfEmpty(-1).First();
                var selected = index >= 0;
                var next = EditorGUILayout.ToggleLeft(manifest.id + " · " + manifest.risk, selected);
                if (next == selected) continue;
                if (next)
                {
                    values.InsertArrayElementAtIndex(values.arraySize);
                    values.GetArrayElementAtIndex(values.arraySize - 1).stringValue = manifest.id;
                    continue;
                }
                values.DeleteArrayElementAtIndex(index);
            }
        }

        void DrawTransitions(SerializedProperty transitions)
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Transitions", EditorStyles.boldLabel);
            var stepIDs = scenario.steps.Where(value => value != null && !string.IsNullOrWhiteSpace(value.id)).Select(value => value.id).ToArray();
            for (var index = 0; index < transitions.arraySize; index++)
            {
                var transition = transitions.GetArrayElementAtIndex(index);
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    EditorGUILayout.PropertyField(transition.FindPropertyRelative("outcome"));
                    var target = transition.FindPropertyRelative("targetStepID");
                    var selected = Mathf.Max(0, Array.IndexOf(stepIDs, target.stringValue));
                    var next = stepIDs.Length == 0 ? -1 : EditorGUILayout.Popup("Target step", selected, stepIDs);
                    if (next >= 0) target.stringValue = stepIDs[next];
                    EditorGUILayout.PropertyField(transition.FindPropertyRelative("condition"), true);
                    if (GUILayout.Button("Remove transition")) { transitions.DeleteArrayElementAtIndex(index); break; }
                }
            }
            if (GUILayout.Button("Add transition"))
            {
                transitions.InsertArrayElementAtIndex(transitions.arraySize);
                var transition = transitions.GetArrayElementAtIndex(transitions.arraySize - 1);
                transition.FindPropertyRelative("outcome").stringValue = "success";
                transition.FindPropertyRelative("targetStepID").stringValue = stepIDs.FirstOrDefault() ?? string.Empty;
            }
        }

        void DrawValidation()
        {
            EditorGUILayout.Space();
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Validate")) Validate();
                using (new EditorGUI.DisabledScope(issues.Any(issue => issue.severity == ScenarioIssueSeverity.Error)))
                    if (GUILayout.Button("Export deterministic manifest")) ExportManifest();
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                baseline = (EmbodiedScenario)EditorGUILayout.ObjectField("Compare revision", baseline, typeof(EmbodiedScenario), false);
                using (new EditorGUI.DisabledScope(baseline == null))
                    if (GUILayout.Button("Show revision diff", GUILayout.Width(150))) manifestPreview = ScenarioRevisionDiff.Compare(baseline, scenario);
            }
            if (!string.IsNullOrWhiteSpace(manifestPreview))
            {
                EditorGUILayout.LabelField("Manifest / revision preview", EditorStyles.boldLabel);
                manifestScroll = EditorGUILayout.BeginScrollView(manifestScroll, EditorStyles.helpBox, GUILayout.Height(150));
                EditorGUILayout.SelectableLabel(manifestPreview, EditorStyles.textArea, GUILayout.ExpandHeight(true));
                EditorGUILayout.EndScrollView();
            }
            if (issues.Count == 0) EditorGUILayout.HelpBox("Scenario is valid.", MessageType.Info);
            foreach (var issue in issues)
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    EditorGUILayout.HelpBox((string.IsNullOrWhiteSpace(issue.stepID) ? "" : issue.stepID + ": ") + issue.message,
                        issue.severity == ScenarioIssueSeverity.Error ? MessageType.Error : issue.severity == ScenarioIssueSeverity.Warning ? MessageType.Warning : MessageType.Info);
                    if (!string.IsNullOrWhiteSpace(issue.stepID) && GUILayout.Button("Go", GUILayout.Width(42)))
                        selectedStep = Mathf.Max(0, scenario.steps.FindIndex(value => value != null && value.id == issue.stepID));
                }
            }
        }

        void Select(EmbodiedScenario value)
        {
            scenario = value;
            serialized = value == null ? null : new SerializedObject(value);
            selectedStep = 0;
            Validate();
        }

        void Validate()
        {
            if (scenario == null) { issues.Clear(); return; }
            var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
            issues = EmbodiedScenarioValidator.Validate(scenario, registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests());
            Repaint();
        }

        void AddStep(ScenarioStepType type)
        {
            Undo.RecordObject(scenario, "Add scenario step");
            serialized.Update();
            var steps = serialized.FindProperty("steps");
            var index = steps.arraySize;
            steps.InsertArrayElementAtIndex(index);
            var step = steps.GetArrayElementAtIndex(index);
            step.FindPropertyRelative("id").stringValue = UniqueID(type.ToString().ToLowerInvariant());
            step.FindPropertyRelative("type").enumValueIndex = (int)type;
            step.FindPropertyRelative("title").stringValue = ObjectNames.NicifyVariableName(type.ToString());
            step.FindPropertyRelative("instruction").stringValue = string.Empty;
            step.FindPropertyRelative("timeoutSeconds").intValue = 60;
            step.FindPropertyRelative("allowedCapabilityIDs").arraySize = 0;
            step.FindPropertyRelative("entryConditions").arraySize = 0;
            step.FindPropertyRelative("completionConditions").arraySize = 0;
            step.FindPropertyRelative("evidence").arraySize = 0;
            step.FindPropertyRelative("transitions").arraySize = 0;
            serialized.ApplyModifiedProperties();
            selectedStep = index;
        }

        void RemoveStep()
        {
            Undo.RecordObject(scenario, "Remove scenario step");
            serialized.Update();
            var steps = serialized.FindProperty("steps");
            steps.DeleteArrayElementAtIndex(selectedStep);
            serialized.ApplyModifiedProperties();
            selectedStep = Mathf.Clamp(selectedStep, 0, steps.arraySize - 1);
        }

        void MoveStep(int direction)
        {
            Undo.RecordObject(scenario, "Reorder scenario step");
            serialized.Update();
            var steps = serialized.FindProperty("steps");
            var target = Mathf.Clamp(selectedStep + direction, 0, steps.arraySize - 1);
            steps.MoveArrayElement(selectedStep, target);
            serialized.ApplyModifiedProperties();
            selectedStep = target;
        }

        string UniqueID(string prefix)
        {
            var ids = scenario.steps.Where(step => step != null).Select(step => step.id).ToHashSet(StringComparer.Ordinal);
            return Enumerable.Range(1, 1000).Select(index => prefix + "-" + index).First(value => !ids.Contains(value));
        }

        void ExportManifest()
        {
            var assetPath = AssetDatabase.GetAssetPath(scenario);
            var defaultName = Path.GetFileNameWithoutExtension(assetPath) + ".manifest.json";
            var path = EditorUtility.SaveFilePanel("Export scenario manifest", Path.GetDirectoryName(assetPath), defaultName, "json");
            if (string.IsNullOrWhiteSpace(path)) return;
            var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
            File.WriteAllText(path, EmbodiedScenarioCompiler.Compile(scenario, registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests()));
            manifestPreview = File.ReadAllText(path);
            AssetDatabase.Refresh();
        }

        bool IsLockedEquipmentIsolation() => scenario != null && scenario.scenarioID == "training.equipment-isolation";
    }

    static class ScenarioRevisionDiff
    {
        public static string Compare(EmbodiedScenario baseline, EmbodiedScenario candidate)
        {
            if (baseline == null || candidate == null) return "Choose both scenario revisions.";
            if (baseline.scenarioID != candidate.scenarioID) return "Scenario IDs differ; revisions cannot be compared.";
            var before = baseline.steps.Where(value => value != null).GroupBy(value => value.id, StringComparer.Ordinal).ToDictionary(value => value.Key, value => value.First(), StringComparer.Ordinal);
            var after = candidate.steps.Where(value => value != null).GroupBy(value => value.id, StringComparer.Ordinal).ToDictionary(value => value.Key, value => value.First(), StringComparer.Ordinal);
            var removedSteps = before.Keys.Except(after.Keys).OrderBy(value => value, StringComparer.Ordinal).ToArray();
            var removedEvidence = before.Values.SelectMany(step => (step.evidence ?? new List<EvidenceRule>()).Select(value => step.id + ":" + value.id))
                .Except(after.Values.SelectMany(step => (step.evidence ?? new List<EvidenceRule>()).Select(value => step.id + ":" + value.id))).OrderBy(value => value, StringComparer.Ordinal).ToArray();
            var removedPermissions = before.Values.SelectMany(step => (step.allowedCapabilityIDs ?? Array.Empty<string>()).Select(value => step.id + ":" + value))
                .Except(after.Values.SelectMany(step => (step.allowedCapabilityIDs ?? Array.Empty<string>()).Select(value => step.id + ":" + value))).OrderBy(value => value, StringComparer.Ordinal).ToArray();
            var lines = new List<string> { $"{baseline.scenarioID}: revision {baseline.revision} → {candidate.revision}" };
            if (removedSteps.Length > 0) lines.Add("Removed stable steps: " + string.Join(", ", removedSteps));
            if (removedEvidence.Length > 0) lines.Add("Removed evidence: " + string.Join(", ", removedEvidence));
            if (removedPermissions.Length > 0) lines.Add("Removed capability permissions: " + string.Join(", ", removedPermissions));
            if (lines.Count == 1) lines.Add("No backward-compatibility removals detected.");
            return string.Join("\n", lines);
        }
    }

    enum ScenarioTemplate { GuidedChecklist, ObjectInspection, EquipmentIsolation }

    static class EmbodiedScenarioTemplates
    {
        public static EmbodiedScenario Create(string title, ScenarioTemplate template)
        {
            var path = EditorUtility.SaveFilePanelInProject("Create " + title, title.Replace(" ", string.Empty) + ".asset", "asset", "Choose where to store the scenario.");
            if (string.IsNullOrWhiteSpace(path)) return null;
            var scenario = ScriptableObject.CreateInstance<EmbodiedScenario>();
            scenario.title = title;
            scenario.scenarioID = "training." + title.ToLowerInvariant().Replace(" ", "-");
            scenario.entryStepID = "start";
            scenario.steps = template == ScenarioTemplate.EquipmentIsolation ? EquipmentIsolation() : template == ScenarioTemplate.ObjectInspection ? ObjectInspection() : GuidedChecklist();
            AssetDatabase.CreateAsset(scenario, path);
            AssetDatabase.SaveAssets();
            Selection.activeObject = scenario;
            return scenario;
        }

        static List<ScenarioStep> GuidedChecklist() => new List<ScenarioStep>
        {
            Step("start", ScenarioStepType.Instruction, "Introduce the exercise", "check", "success"),
            Step("check", ScenarioStepType.WaitForUser, "Complete the checklist", "verify", "success", Evidence("checklist.confirmed", "Checklist confirmed")),
            Step("verify", ScenarioStepType.Verify, "Verify the result", "complete", "success"),
            Step("complete", ScenarioStepType.Complete, "Exercise complete", null, null),
        };

        static List<ScenarioStep> ObjectInspection() => new List<ScenarioStep>
        {
            Step("start", ScenarioStepType.Instruction, "Ask the trainee to inspect the object", "observe", "success"),
            Step("observe", ScenarioStepType.Observe, "Observe the selected object", "verify", "success", Evidence("object.visible", "Object was visible")),
            Step("verify", ScenarioStepType.Verify, "Verify the inspection evidence", "complete", "success"),
            Step("complete", ScenarioStepType.Complete, "Inspection complete", null, null),
        };

        static List<ScenarioStep> EquipmentIsolation() => new List<ScenarioStep>
        {
            Step("start", ScenarioStepType.Instruction, "Explain the equipment isolation task", "inspect-ppe", "success"),
            Action("inspect-ppe", "Inspect PPE", "safety.inspect_ppe", "identify-hazards"),
            Action("identify-hazards", "Identify hazards", "safety.identify_hazards", "stop-machine"),
            Action("stop-machine", "Stop the machine", "safety.stop_machine", "apply-lockout"),
            Action("apply-lockout", "Apply lockout", "safety.apply_lockout", "verify-energy"),
            Action("verify-energy", "Verify zero energy", "safety.verify_zero_energy", "signoff"),
            Action("signoff", "Complete instructor sign-off", "safety.complete_exercise", "complete"),
            Step("complete", ScenarioStepType.Complete, "Isolation complete", null, null),
        };

        static ScenarioStep Action(string id, string title, string capability, string next)
        {
            var step = Step(id, ScenarioStepType.RequestAction, title, next, "success", Evidence(capability + ".completed", title + " completed"));
            step.allowedCapabilityIDs = new[] { capability };
            return step;
        }

        static EvidenceRule Evidence(string id, string label) => new EvidenceRule { id = id, label = label, source = "game", required = true };
        static ScenarioStep Step(string id, ScenarioStepType type, string title, string next, string outcome, EvidenceRule evidence = null)
        {
            var step = new ScenarioStep { id = id, type = type, title = title, instruction = title, timeoutSeconds = 60 };
            if (next != null) step.transitions.Add(new ScenarioTransition { outcome = outcome, targetStepID = next });
            if (evidence != null) step.evidence.Add(evidence);
            return step;
        }
    }

    [CustomEditor(typeof(EmbodiedScenario))]
    public sealed class EmbodiedScenarioInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            DrawDefaultInspector();
            var scenario = (EmbodiedScenario)target;
            var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
            var issues = EmbodiedScenarioValidator.Validate(scenario, registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests());
            EditorGUILayout.Space();
            if (GUILayout.Button("Open Scenario Studio")) EmbodiedScenarioStudio.Open(scenario);
            if (issues.Count == 0) EditorGUILayout.HelpBox("Scenario is valid.", MessageType.Info);
            foreach (var issue in issues)
                EditorGUILayout.HelpBox(issue.code + ": " + issue.message, issue.severity == ScenarioIssueSeverity.Error ? MessageType.Error : MessageType.Warning);
        }
    }
}
