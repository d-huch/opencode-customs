using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Networking;

namespace EmbodiedAgent.Unity.Editor
{
    public sealed class EmbodiedAgentSetupWizard : EditorWindow
    {
        const string RuntimeHealthUrl = "http://127.0.0.1:57110/v1/health";
        const string RuntimeControlUrl = "http://127.0.0.1:57110";
        static readonly string[] RequiredPackages =
        {
            "com.unity.inputsystem", "com.unity.nuget.newtonsoft-json", "com.unity.xr.management",
        };
        Vector2 scroll;
        string runtimeStatus = "Not checked";
        string runtimeModel = "Unknown";
        string runtimeVoice = "Unknown";
        MessageType runtimeStatusType = MessageType.Info;
        bool checking;
        EmbodiedScenario selectedScenario;
        string replayPath;
        string testTurn = "Start the simulated equipment isolation briefing.";

        void OnEnable() => PilotOnboarding.Mark("wizard-opened");

        [MenuItem("Embodied Agent/Setup Wizard")]
        public static void Open() => GetWindow<EmbodiedAgentSetupWizard>("Embodied Agent Setup");

        void OnGUI()
        {
            EditorGUILayout.LabelField("Embodied Agent SDK Self-Service Alpha", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Complete these checks in order. Repair only changes components owned by the Embodied Agent SDK.", MessageType.Info);
            EditorGUILayout.LabelField("Local onboarding time", PilotOnboarding.ElapsedLabel);
            scroll = EditorGUILayout.BeginScrollView(scroll);
            DrawDependencies();
            DrawRuntime();
            DrawScene();
            DrawScenario();
            DrawFirstRun();
            DrawQuest();
            EditorGUILayout.EndScrollView();
        }

        void DrawDependencies()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("1. Unity and package dependencies", EditorStyles.boldLabel);
            var packages = UnityEditor.PackageManager.PackageInfo.GetAllRegisteredPackages().Select(value => value.name).ToHashSet(StringComparer.Ordinal);
            EditorGUILayout.HelpBox(Application.unityVersion.StartsWith("6000.") ? "Unity 6 detected." : "Unity 6 is required. Current: " + Application.unityVersion,
                Application.unityVersion.StartsWith("6000.") ? MessageType.Info : MessageType.Error);
            foreach (var dependency in RequiredPackages)
                EditorGUILayout.LabelField((packages.Contains(dependency) ? "[Ready] " : "[Missing] ") + dependency);
        }

        void DrawRuntime()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("2–4. Runtime, model and voice", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(runtimeStatus, runtimeStatusType);
            EditorGUILayout.LabelField("Dialogue model", runtimeModel);
            EditorGUILayout.LabelField("Voice", runtimeVoice);
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(checking || EditorApplication.isPlaying))
                    if (GUILayout.Button(checking ? "Checking…" : "Check Runtime")) CheckRuntime();
                if (GUILayout.Button("Open Control Center")) OpenControlCenter();
            }
        }

        void DrawScene()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("5. Scene runtime", EditorStyles.boldLabel);
            var issues = ValidateScene();
            if (issues.Count == 0) EditorGUILayout.HelpBox("Scene runtime is ready.", MessageType.Info);
            foreach (var issue in issues) EditorGUILayout.HelpBox(issue, MessageType.Warning);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Add Agent Runtime")) AddAgentRuntime();
                if (GUILayout.Button("Repair SDK Components")) RepairAgentRuntime();
            }
        }

        void DrawScenario()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("6. Training scenario", EditorStyles.boldLabel);
            selectedScenario = (EmbodiedScenario)EditorGUILayout.ObjectField("Scenario", selectedScenario, typeof(EmbodiedScenario), false);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Open Scenario Studio")) EmbodiedScenarioStudio.Open(selectedScenario);
                if (GUILayout.Button("Review recorded instruction")) DemonstrationReviewWizard.Open();
                using (new EditorGUI.DisabledScope(selectedScenario == null))
                    if (GUILayout.Button("Attach Scenario")) AttachScenario(selectedScenario);
            }
            if (selectedScenario != null)
            {
                var registry = FindAnyObjectByType<AvatarCapabilityRegistry>(FindObjectsInactive.Include);
                var issues = EmbodiedScenarioValidator.Validate(selectedScenario, registry == null ? Array.Empty<AvatarCapabilityManifest>() : registry.Manifests());
                EditorGUILayout.HelpBox(issues.Any(issue => issue.severity == ScenarioIssueSeverity.Error)
                    ? "Scenario has blocking validation errors. Open Scenario Studio for details."
                    : "Scenario manifest is valid.", issues.Any(issue => issue.severity == ScenarioIssueSeverity.Error) ? MessageType.Error : MessageType.Info);
            }
        }

        void DrawFirstRun()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("7–8. First turn and Replay", EditorStyles.boldLabel);
            var client = FindAnyObjectByType<EmbodiedAgentClient>(FindObjectsInactive.Include);
            var recorder = FindAnyObjectByType<AvatarScenarioRecorder>(FindObjectsInactive.Include);
            var runner = FindAnyObjectByType<EmbodiedScenarioRunner>(FindObjectsInactive.Include);
            EditorGUILayout.LabelField(client == null ? "[Missing] Client" : "[Ready] Client");
            EditorGUILayout.LabelField(runner == null ? "[Missing] Scenario runner" : "[Ready] Scenario runner");
            EditorGUILayout.LabelField(recorder == null ? "[Missing] Replay recorder" : "[Ready] Replay recorder");
            using (new EditorGUI.DisabledScope(!EditorApplication.isPlaying || runner == null || runner.scenario == null || runner.Run?.status == "running"))
                if (GUILayout.Button(runner?.Run?.status == "running" ? "Scenario running" : "Start test scenario")) { runner.StartScenario(); PilotOnboarding.Mark("scenario-started"); }
            testTurn = EditorGUILayout.TextField("Test instruction", testTurn);
            using (new EditorGUI.DisabledScope(!EditorApplication.isPlaying || client == null || !client.IsConnected || string.IsNullOrWhiteSpace(testTurn)))
                if (GUILayout.Button("Send test turn")) { client.SubmitTypedText(testTurn); PilotOnboarding.Mark("first-turn-sent"); }
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(!EditorApplication.isPlaying || recorder == null || recorder.Recording))
                    if (GUILayout.Button("Start Replay recording")) recorder.StartRecording();
                using (new EditorGUI.DisabledScope(!EditorApplication.isPlaying || recorder == null || !recorder.Recording))
                    if (GUILayout.Button("Stop and export Replay")) { replayPath = recorder.StopAndSaveFixture(); PilotOnboarding.Mark("replay-exported"); }
            }
            if (!string.IsNullOrWhiteSpace(replayPath)) EditorGUILayout.HelpBox("Replay saved to " + replayPath, MessageType.Info);
            EditorGUILayout.HelpBox("Run the exported fixture in Runtime Control Center, then run the CI gate with `bun run check:embodied --unity`.", MessageType.Info);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Export sanitized support bundle")) PilotSupportBundle.Export(runtimeStatus, runtimeModel, runtimeVoice);
                if (GUILayout.Button("Reset onboarding timer")) PilotOnboarding.Reset();
            }
        }

        void DrawQuest()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("9. Quest 3 pilot build", EditorStyles.boldLabel);
            var type = Type.GetType("EmbodiedAgent.SafetyInstructor.Editor.PilotQuestBuild, EmbodiedAgent.SafetyInstructor.Editor");
            if (type == null)
            {
                EditorGUILayout.HelpBox("Import the Equipment Isolation Safety Instructor sample to enable Quest validation and build.", MessageType.Warning);
                return;
            }
            EditorGUILayout.HelpBox("Quest uses Meta OpenXR, Android Keystore pairing and the same scenario revision as Desktop simulation.", MessageType.Info);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Configure Quest 3")) type.GetMethod("Configure")?.Invoke(null, null);
                if (GUILayout.Button("Validate Quest 3")) { type.GetMethod("Validate")?.Invoke(null, null); PilotOnboarding.Mark("quest-validated"); }
                if (GUILayout.Button("Build development APK")) { type.GetMethod("Build")?.Invoke(null, null); PilotOnboarding.Mark("quest-built"); }
            }
        }

        void CheckRuntime()
        {
            checking = true;
            runtimeStatus = "Checking local Runtime…";
            runtimeStatusType = MessageType.Info;
            var request = UnityWebRequest.Get(RuntimeHealthUrl);
            var operation = request.SendWebRequest();
            operation.completed += _ =>
            {
                checking = false;
                if (request.result == UnityWebRequest.Result.Success)
                {
                    var value = JObject.Parse(request.downloadHandler.text);
                    runtimeStatus = "Runtime and localhost bootstrap are ready.";
                    runtimeStatusType = MessageType.Info;
                    runtimeModel = value["model"]?["status"]?.Value<string>() ?? "Check model in Control Center";
                    runtimeVoice = "STT " + (value["voice"]?["transcription"]?.Value<string>() ?? "unknown") + " · TTS " + (value["voice"]?["synthesis"]?.Value<string>() ?? "unknown");
                    PilotOnboarding.Mark("runtime-ready");
                }
                else
                {
                    runtimeStatus = "Runtime is unavailable. Start the packaged Embodied Agent Runtime, then retry.\n" + request.error;
                    runtimeStatusType = MessageType.Error;
                    runtimeModel = "Unavailable";
                    runtimeVoice = "Unavailable";
                }
                request.Dispose();
                Repaint();
            };
        }

        void OpenControlCenter()
        {
            var request = new UnityWebRequest(RuntimeControlUrl + "/v1/launch", "POST") { downloadHandler = new DownloadHandlerBuffer() };
            var operation = request.SendWebRequest();
            operation.completed += _ =>
            {
                if (request.result == UnityWebRequest.Result.Success)
                {
                    var value = JObject.Parse(request.downloadHandler.text);
                    var launchUrl = value["url"]?.Value<string>();
                    if (!string.IsNullOrWhiteSpace(launchUrl)) Application.OpenURL(launchUrl);
                }
                else
                {
                    runtimeStatus = "Could not open the authenticated Control Center. Start the Runtime and retry.\n" + request.error;
                    runtimeStatusType = MessageType.Error;
                }
                request.Dispose();
                Repaint();
            };
        }

        static List<string> ValidateScene()
        {
            var clients = FindObjectsByType<EmbodiedAgentClient>(FindObjectsInactive.Include);
            var issues = new List<string>();
            if (clients.Length == 0) issues.Add("No EmbodiedAgentClient is present.");
            if (clients.Length > 1) issues.Add("Multiple EmbodiedAgentClient components can duplicate turns and actions.");
            foreach (var client in clients)
            {
                if (client.worldSensor == null) issues.Add(client.name + " has no world sensor.");
                if (client.capabilityRegistry == null) issues.Add(client.name + " has no capability registry.");
                if (string.IsNullOrWhiteSpace(client.clientID)) issues.Add(client.name + " has no stable client ID.");
                if (string.IsNullOrWhiteSpace(client.gameID)) issues.Add(client.name + " has no game ID.");
                if (string.IsNullOrWhiteSpace(client.characterID)) issues.Add(client.name + " has no character ID.");
                var manifests = client.capabilityRegistry == null ? Array.Empty<AvatarCapabilityManifest>() : client.capabilityRegistry.Manifests();
                foreach (var duplicate in manifests.GroupBy(value => value.id).Where(value => value.Count() > 1)) issues.Add("Duplicate capability ID: " + duplicate.Key);
                foreach (var manifest in manifests.Where(value => value.risk == "critical" && string.IsNullOrWhiteSpace(value.permissionCategory))) issues.Add("Critical capability has no permission category: " + manifest.id);
            }
            return issues;
        }

        static void AddAgentRuntime()
        {
            if (FindObjectsByType<EmbodiedAgentClient>(FindObjectsInactive.Include).Length > 0)
            {
                EditorUtility.DisplayDialog("Embodied Agent", "This scene already has an Embodied Agent runtime. Use Repair SDK Components instead.", "OK");
                return;
            }
            var root = new GameObject("Embodied Agent Runtime");
            Undo.RegisterCreatedObjectUndo(root, "Add Embodied Agent Runtime");
            Configure(root, false);
            EditorSceneManager.MarkSceneDirty(root.scene);
            Selection.activeGameObject = root;
            PilotOnboarding.Mark("sdk-root-ready");
        }

        static void RepairAgentRuntime()
        {
            var client = FindAnyObjectByType<EmbodiedAgentClient>(FindObjectsInactive.Include);
            if (client == null) { AddAgentRuntime(); return; }
            Undo.RecordObject(client.gameObject, "Repair Embodied Agent Runtime");
            Configure(client.gameObject, true);
            EditorSceneManager.MarkSceneDirty(client.gameObject.scene);
            Selection.activeGameObject = client.gameObject;
        }

        static void Configure(GameObject root, bool preserveIdentity)
        {
            var sensor = root.GetComponent<AvatarWorldSensor>() ?? Undo.AddComponent<AvatarWorldSensor>(root);
            sensor.observer = sensor.observer == null ? Camera.main == null ? root.transform : Camera.main.transform : sensor.observer;
            sensor.viewCamera = sensor.viewCamera == null ? Camera.main : sensor.viewCamera;
            if (!preserveIdentity || string.IsNullOrWhiteSpace(sensor.GameID)) sensor.GameID = "training";
            if (!preserveIdentity || string.IsNullOrWhiteSpace(sensor.SaveSlotID)) sensor.SaveSlotID = "default";
            if (!preserveIdentity || string.IsNullOrWhiteSpace(sensor.CharacterID)) sensor.CharacterID = "instructor";
            var registry = root.GetComponent<AvatarCapabilityRegistry>() ?? Undo.AddComponent<AvatarCapabilityRegistry>(root);
            var client = root.GetComponent<EmbodiedAgentClient>() ?? Undo.AddComponent<EmbodiedAgentClient>(root);
            if (!preserveIdentity || string.IsNullOrWhiteSpace(client.clientID)) client.clientID = "embodied-unity-editor";
            client.gameID = sensor.GameID;
            client.saveSlotID = sensor.SaveSlotID;
            client.characterID = sensor.CharacterID;
            client.worldSensor = sensor;
            client.capabilityRegistry = registry;
            var recorder = root.GetComponent<AvatarScenarioRecorder>() ?? Undo.AddComponent<AvatarScenarioRecorder>(root);
            recorder.sensor = sensor;
            var runner = root.GetComponent<EmbodiedScenarioRunner>() ?? Undo.AddComponent<EmbodiedScenarioRunner>(root);
            runner.capabilityRegistry = registry;
            runner.client = client;
            recorder.scenarioRunner = runner;
            recorder.capabilityRegistry = registry;
            var exporter = root.GetComponent<TrainingResultExporter>() ?? Undo.AddComponent<TrainingResultExporter>(root);
            exporter.runner = runner;
        }

        static void AttachScenario(EmbodiedScenario scenario)
        {
            var runner = FindAnyObjectByType<EmbodiedScenarioRunner>(FindObjectsInactive.Include);
            if (runner == null) { AddAgentRuntime(); runner = FindAnyObjectByType<EmbodiedScenarioRunner>(FindObjectsInactive.Include); }
            Undo.RecordObject(runner, "Attach Embodied Agent Scenario");
            runner.scenario = scenario;
            EditorUtility.SetDirty(runner);
            EditorSceneManager.MarkSceneDirty(runner.gameObject.scene);
            Selection.activeObject = runner;
            PilotOnboarding.Mark("scenario-attached");
        }
    }
}
