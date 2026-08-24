using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Reflection;
using OpenCode.Customs.AvatarBridge;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Rendering;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Animations.Rigging;
using UnityEngine.EventSystems;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.Interaction.Toolkit.Inputs;
using UnityEngine.XR.Interaction.Toolkit.UI;
using Unity.XR.CoreUtils;
using TMPro;

namespace OpenCode.Customs.QuestAlpha.Editor
{
    public static class QuestJarvisRoomBuilder
    {
        const string SceneDirectory = "Assets/OpenCodeCustoms/JarvisRoom";
        const string ScenePath = SceneDirectory + "/JarvisRoom.unity";
        const string AvatarDirectory = "Assets/OpenCodeCustoms/Avatar";
        const string AnimationDirectory = AvatarDirectory + "/Animations/Mixamo";
        const string GestureDirectory = AnimationDirectory + "/Gestures";
        const string AnimatorControllerPath = AvatarDirectory + "/GamerGirlAgent.controller";
        const string UpperBodyMaskPath = AvatarDirectory + "/GamerGirlUpperBody.mask";
        const string GamerGirlPrefabPath = "Assets/GamerGirl/Render pipeline/URP/Prefab/SK_GamerGirl_02 White Variant.prefab";
        const string TmpFallbackPath = "Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF - Fallback.asset";
        const string InteractionSimulatorPrefabPath = "Assets/Samples/XR Interaction Toolkit/3.5.0/XR Interaction Simulator/XR Interaction Simulator.prefab";
        static readonly string[] RequiredAnimations = { "Idle", "Walk", "Run", "Talking", "Thinking", "Wave", "Point", "Nod" };
        static readonly string[] RequiredBlendShapes = { "jawOpen", "eyeBlinkLeft", "eyeBlinkRight", "mouthFunnel", "mouthPucker", "mouthSmileLeft", "mouthSmileRight", "browInnerUp" };
        static readonly GestureDefinition[] OptionalGestures =
        {
            new GestureDefinition("RelievedSigh", "RelievedSigh.fbx"),
            new GestureDefinition("ThoughtfulHeadShake", "ThoughtfulHeadShake.fbx"),
            new GestureDefinition("LengthyNod", "LengthyNod.fbx"),
            new GestureDefinition("Acknowledge", "Acknowledge.fbx"),
            new GestureDefinition("HappyGesture", "HappyGesture.fbx"),
            new GestureDefinition("AngryGesture", "AngryGesture.fbx"),
            new GestureDefinition("HardNod", "HardNod.fbx"),
            new GestureDefinition("AnnoyedHeadShake", "AnnoyedHeadShake.fbx"),
            new GestureDefinition("Cocky", "Cocky.fbx"),
            new GestureDefinition("Yes", "Yes.fbx"),
            new GestureDefinition("No", "No.fbx"),
            new GestureDefinition("SarcasticNod", "SarcasticNod.fbx"),
            new GestureDefinition("WeightShift", "WeightShift.fbx"),
            new GestureDefinition("Dismiss", "Dismiss.fbx"),
            new GestureDefinition("LookAway", "LookAway.fbx"),
            new GestureDefinition("Hallin", "Hallin.fbx"),
        };

        sealed class GestureDefinition
        {
            public readonly string trigger;
            public readonly string file;
            public GestureDefinition(string trigger, string file) { this.trigger = trigger; this.file = file; }
        }

        [MenuItem("OpenCode Customs/Rebuild Quest Jarvis Room")]
        public static void Create()
        {
            RepairXrSettings();
            EditorSettings.serializationMode = SerializationMode.ForceText;
            Directory.CreateDirectory(SceneDirectory);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var environment = new GameObject("Jarvis Room Environment");
            environment.AddComponent<JarvisRoomGeneration>().version = JarvisRoomGeneration.CurrentVersion;
            var surface = environment.AddComponent<NavMeshSurface>();
            Cube("Floor", new Vector3(0, -0.1f, 0), new Vector3(12, 0.2f, 12), environment.transform);
            Cube("North Wall", new Vector3(0, 1.5f, 6), new Vector3(12, 3, 0.2f), environment.transform);
            Cube("South Wall", new Vector3(0, 1.5f, -6), new Vector3(12, 3, 0.2f), environment.transform);
            Cube("West Wall", new Vector3(-6, 1.5f, 0), new Vector3(0.2f, 3, 12), environment.transform);
            Cube("East Wall A", new Vector3(6, 1.5f, -3.7f), new Vector3(0.2f, 3, 4.6f), environment.transform);
            Cube("East Wall B", new Vector3(6, 1.5f, 3.7f), new Vector3(0.2f, 3, 4.6f), environment.transform);
            Cube("Workbench", new Vector3(-1.8f, 0.5f, 1.5f), new Vector3(3, 1, 1.2f), environment.transform);

            var player = CreateXROrigin();
            RemoveMissingSceneScripts(player);
            player.AddComponent<AvatarQuestXrLifecycle>();
            var visuals = AttachInputVisuals(player);
            var camera = player.GetComponentInChildren<Camera>();
            if (camera == null) camera = CameraFallback(player);
            var simulator = player.GetComponentsInChildren<Transform>(true).FirstOrDefault(value => value.name == "XR Interaction Simulator (Editor Only)");
            var inputMode = player.AddComponent<AvatarEditorInputMode>();
            inputMode.xrOrigin = player.transform;
            inputMode.cameraFloorOffset = player.GetComponentInChildren<XROrigin>(true)?.CameraFloorOffsetObject?.transform;
            inputMode.head = camera.transform;
            inputMode.leftController = visuals.leftController.transform;
            inputMode.rightController = visuals.rightController.transform;
            inputMode.simulator = simulator != null ? simulator.gameObject : null;
            inputMode.visuals = visuals;
            inputMode.poseDrivers = player.GetComponentsInChildren<UnityEngine.InputSystem.XR.TrackedPoseDriver>(true);
            inputMode.standingHeadHeight = 1.7f;

            var companion = new GameObject("Jarvis Agent");
            companion.transform.position = new Vector3(0, 0, -1);
            var body = CreateGamerGirlBody(companion.transform);
            var animator = body.GetComponentInChildren<Animator>(true);
            if (animator == null || animator.avatar == null || !animator.avatar.isHuman || !animator.avatar.isValid)
                throw new BuildFailedException("SK_GamerGirl_Agent must contain a valid Humanoid Animator Avatar.");
            animator.applyRootMotion = false;
            animator.runtimeAnimatorController = EnsureAnimatorController(false);
            var agent = companion.AddComponent<NavMeshAgent>();
            ConfigureNavMeshAgent(agent, body);
            var audio = companion.AddComponent<AudioSource>();
            audio.playOnAwake = false;
            audio.loop = false;
            audio.volume = 1f;
            audio.spatialBlend = 0.65f;
            audio.minDistance = 1.5f;
            audio.maxDistance = 18f;
            var sensor = companion.AddComponent<AvatarWorldSensor>();
            sensor.observer = companion.transform; sensor.viewCamera = camera; sensor.updatesPerSecond = 4;
            var registry = companion.AddComponent<AvatarCapabilityRegistry>();
            var bridge = companion.AddComponent<OpenCodeAvatarBridgeV2>();
            bridge.capabilityRegistry = registry; bridge.worldSensor = sensor; bridge.audioSource = audio;
            bridge.connectionMode = AvatarConnectionMode.Auto;
            bridge.clientID = "jarvis-lab-pcvr";
            bridge.characterID = "jarvis";
            bridge.gameID = "jarvis-lab";
            bridge.saveSlotID = "slot-1";
            bridge.receiveVoice = true;
            bridge.enableMicrophoneStreaming = true; bridge.handsFree = true;
            companion.AddComponent<AvatarQuestPairingPanel>().bridge = bridge;
            var keyboard = player.AddComponent<AvatarVRKeyboard>();
            keyboard.bridge = bridge; keyboard.viewer = camera.transform;
            var chatPanel = player.AddComponent<AvatarChatPanel>();
            chatPanel.bridge = bridge; chatPanel.keyboard = keyboard; chatPanel.viewer = camera.transform;
            keyboard.chatPanel = chatPanel;
            var overlay = companion.AddComponent<AvatarDeveloperOverlay>();
            overlay.bridge = bridge; overlay.keyboard = keyboard; overlay.chatPanel = chatPanel; overlay.viewer = camera.transform;
            var speechBubble = companion.AddComponent<AvatarSpeechBubble>();
            speechBubble.bridge = bridge; speechBubble.head = animator.GetBoneTransform(HumanBodyBones.Head); speechBubble.viewer = camera.transform;
            companion.AddComponent<AvatarScenarioRecorder>().sensor = sensor;
            var reactions = companion.AddComponent<AvatarMicroReactions>();
            reactions.animator = animator;
            var presentation = companion.AddComponent<AvatarVRMPresentation>();
            presentation.bridge = bridge; presentation.reactions = reactions;
            presentation.face = FindFaceRenderer(body);
            if (presentation.face == null)
                throw new BuildFailedException("SK_GamerGirl_Agent has no face renderer with jawOpen and eyeBlinkLeft blend shapes.");
            presentation.visemes = VisemeBindings();
            presentation.emotions = EmotionBindings();
            presentation.RebuildBindings();
            var rigTargets = ConfigureRig(companion, animator, camera.transform);
            var locomotion = companion.AddComponent<AvatarLocomotionController>();
            locomotion.agent = agent; locomotion.animator = animator;
            overlay.locomotion = locomotion; overlay.reactions = reactions; overlay.rigTargets = rigTargets; overlay.presentation = presentation; overlay.inputMode = inputMode;
            var world = companion.AddComponent<JarvisRoomWorld>();
            world.sensor = sensor;

            companion.AddComponent<MoveToCapability>().agent = agent;
            var follow = companion.AddComponent<FollowCapability>(); follow.agent = agent; follow.player = camera.transform;
            companion.AddComponent<StayCapability>().agent = agent;
            var expression = companion.AddComponent<CharacterExpressionCapability>();
            expression.animator = animator; expression.reactions = reactions; expression.presentation = presentation;
            expression.rigTargets = rigTargets; expression.lookRoot = animator.GetBoneTransform(HumanBodyBones.Head);

            var door = Entity("Lab Door", "lab_door", "door", null, new Vector3(5.8f, 1.2f, 0), world);
            door.transform.localScale = new Vector3(0.25f, 2.4f, 2.2f);
            Entity("Lab Key", "lab_key", "item", "lab_key", new Vector3(-2.4f, 1.1f, 1.5f), world);
            Entity("Energy Core", "energy_core", "item", "energy_core", new Vector3(-1.4f, 1.1f, 1.5f), world);
            Entity("Technician", "technician", "npc", null, new Vector3(3.5f, 1, 2), world);
            Entity("Training Target", "training_target", "hazard", null, new Vector3(3.5f, 1, -2), world);
            foreach (JarvisRoomAction action in System.Enum.GetValues(typeof(JarvisRoomAction)))
            {
                var capability = companion.AddComponent<JarvisRoomCapability>();
                capability.action = action; capability.world = world; capability.door = door.transform;
            }

            surface.BuildNavMesh();
            registry.Refresh();
            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.ForceReserializeAssets(new[] { ScenePath }, ForceReserializeAssetsOptions.ReserializeAssetsAndMetadata);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Selection.activeGameObject = companion;
            Debug.Log("Quest Jarvis Room created with SK_GamerGirl_Agent. Unity will connect to OpenCode Customs automatically in Play Mode.");
        }

        [MenuItem("OpenCode Customs/Build Quest Development APK")]
        public static void BuildQuestDevelopment()
        {
            RepairXrSettings();
            Create();
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "ai.opencode.customs.jarvisroom");
            PlayerSettings.productName = "OpenCode Customs Jarvis Room";
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
            EditorUserBuildSettings.androidBuildSystem = AndroidBuildSystem.Gradle;
            RepairUrpGlobalSettings();
            AssetDatabase.SaveAssets();
            Directory.CreateDirectory("Builds/Quest");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = "Builds/Quest/OpenCode-Customs-Jarvis-Room.apk",
                target = BuildTarget.Android,
                options = BuildOptions.Development,
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException("Quest APK build failed: " + report.summary.result);
            Debug.Log("Quest development APK: " + report.summary.outputPath);
        }

        [MenuItem("OpenCode Customs/Repair XR Settings")]
        public static void RepairXrSettings()
        {
            RepairOpenXrPackageSettings();
            ConfigureLoaders(BuildTargetGroup.Standalone, null);
            ConfigureLoaders(BuildTargetGroup.Android, "Assets/XR/Loaders/OpenXRLoader.asset");
            AssetDatabase.SaveAssets();
            Debug.Log("XR settings repaired: Editor uses the XRI Interaction Simulator without an XR loader; Android uses OpenXR.");
        }

        static void RepairOpenXrPackageSettings()
        {
            const string legacyPath = "Assets/XR/Settings/OpenXRPackageSettings.asset";
            const string path = "Assets/XR/Settings/OpenXR Package Settings.asset";
            var assets = AssetDatabase.LoadAllAssetsAtPath(path);
            var broken = assets.Any(value => value == null) || assets.Any(value => value != null && SerializationUtility.HasManagedReferencesWithMissingTypes(value));
            if (broken)
            {
                var validation = typeof(OpenXRSettings).Assembly.GetType("UnityEditor.XR.OpenXR.OpenXRProjectValidation");
                var regenerate = validation?.GetMethod("RegenerateXRPackageSettingsAsset", BindingFlags.Static | BindingFlags.NonPublic);
                if (regenerate == null) throw new BuildFailedException("Installed OpenXR package does not expose its settings regeneration API.");
                regenerate.Invoke(null, null);
            }

            FeatureHelpers.RefreshFeatures(BuildTargetGroup.Standalone);
            FeatureHelpers.RefreshFeatures(BuildTargetGroup.Android);
            var android = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Android);
            if (android == null) throw new BuildFailedException("Could not create Android OpenXR settings.");
            var required = new[]
            {
                "MetaQuestFeature", "OculusTouchControllerProfile", "MetaQuestTouchPlusControllerProfile",
                "HandTrackingDataSourceFeature", "HandInteractionProfile", "MetaHandTrackingAim", "MetaOpenXRHandMeshData",
            };
            foreach (var feature in android.GetFeatures())
                if (feature != null && required.Contains(feature.GetType().Name)) feature.enabled = true;
            EditorUtility.SetDirty(android);
            if (AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(path) != null && AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(legacyPath) != null)
                AssetDatabase.DeleteAsset(legacyPath);
            AssetDatabase.SaveAssets();
            if (AssetDatabase.LoadAllAssetsAtPath(path).Any(value => value == null))
                throw new BuildFailedException("OpenXR package settings still contain unresolved serialized sub-assets after regeneration.");
        }

        [MenuItem("OpenCode Customs/Validate Quest Jarvis Room")]
        public static void Validate()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var generation = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<JarvisRoomGeneration>(true)).FirstOrDefault();
            if (generation == null || generation.version != JarvisRoomGeneration.CurrentVersion)
                throw new BuildFailedException("Jarvis Room is stale. Run OpenCode Customs > Rebuild Quest Jarvis Room.");
            var visuals = UnityEngine.Object.FindAnyObjectByType<AvatarXRInputVisuals>(FindObjectsInactive.Include);
            if (visuals == null || visuals.leftController == null || visuals.rightController == null ||
                visuals.leftHand == null || visuals.rightHand == null)
                throw new BuildFailedException("Jarvis Room must contain left/right Quest controller and hand visuals.");
            var playerRig = scene.GetRootGameObjects().FirstOrDefault(value => value.name == "XriPlayerRig");
            if (playerRig == null) throw new BuildFailedException("Jarvis Room must contain the XriPlayerRig imported from vr-constructor.");
            var simulator = playerRig.GetComponentsInChildren<Transform>(true).FirstOrDefault(value => value.name == "XR Interaction Simulator (Editor Only)");
            if (simulator == null || !simulator.CompareTag("EditorOnly"))
                throw new BuildFailedException("XriPlayerRig must contain the Editor-only XR Interaction Simulator.");
            if (playerRig.GetComponentInChildren<EventSystem>(true) == null || playerRig.GetComponentInChildren<XRUIInputModule>(true) == null)
                throw new BuildFailedException("XriPlayerRig must contain EventSystem and XRUIInputModule components.");
            var inputMode = playerRig.GetComponent<AvatarEditorInputMode>();
            if (inputMode == null || inputMode.simulator == null || inputMode.visuals != visuals || inputMode.cameraFloorOffset == null)
                throw new BuildFailedException("XriPlayerRig must contain the XRI/Desktop input mode controller.");
            var keyboard = playerRig.GetComponent<AvatarVRKeyboard>();
            if (keyboard == null || keyboard.viewer == null)
                throw new BuildFailedException("XriPlayerRig must contain the interactive Ukrainian/English VR keyboard.");
            var chatPanel = playerRig.GetComponent<AvatarChatPanel>();
            if (chatPanel == null || chatPanel.viewer == null || chatPanel.keyboard != keyboard || keyboard.chatPanel != chatPanel)
                throw new BuildFailedException("XriPlayerRig must contain the world-space Jarvis text chat wired to the VR keyboard.");
            var bridges = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<OpenCodeAvatarBridgeV2>(true)).ToArray();
            if (bridges.Length != 1 || !bridges[0].receiveVoice || bridges[0].audioSource == null)
                throw new BuildFailedException("Jarvis Room must contain exactly one Avatar Bridge with Unity voice playback enabled.");
            var speechBubble = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<AvatarSpeechBubble>(true)).FirstOrDefault();
            var overlay = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<AvatarDeveloperOverlay>(true)).FirstOrDefault();
            if (speechBubble == null || speechBubble.head == null || speechBubble.viewer == null)
                throw new BuildFailedException("GamerGirl must contain a viewer-facing comic speech bubble attached above the head.");
            if (overlay == null || overlay.keyboard != keyboard || overlay.chatPanel != chatPanel || overlay.viewer == null)
                throw new BuildFailedException("Jarvis Room must contain the world-space developer panel wired to the VR keyboard and text chat.");
            var origins = playerRig.GetComponentsInChildren<XROrigin>(true);
            if (origins.Length == 0 || origins.Any(origin => Mathf.Abs(origin.CameraYOffset) > 0.001f ||
                (origin.CameraFloorOffsetObject != null && origin.CameraFloorOffsetObject.transform.localPosition.sqrMagnitude > 0.000001f)))
                throw new BuildFailedException("XriPlayerRig simulation requires zero Camera Y Offset and a zero Camera Floor Offset transform.");
            var xrLifecycles = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<AvatarQuestXrLifecycle>(true)).ToArray();
            if (xrLifecycles.Length != 1)
                throw new BuildFailedException("Jarvis Room must contain exactly one Quest-only manual OpenXR lifecycle component.");
            var missing = AuditMissingScripts(scene);
            if (missing.Length > 0) throw new BuildFailedException("Missing script references:\n" + string.Join("\n", missing));
            ValidateLoaders(BuildTargetGroup.Standalone, null);
            ValidateLoaders(BuildTargetGroup.Android, "OpenXRLoader");
            ValidateTmpFallback();
            ValidateGamerGirl(scene, true);
            Debug.Log("Quest Jarvis Room validation passed: GamerGirl, comic speech bubble, text chat, VR keyboard, world-space diagnostics, New Input System, XR simulator, controllers and hands are configured.");
        }

        [MenuItem("OpenCode Customs/Validate GamerGirl Agent Body")]
        public static void ValidateGamerGirlBody()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            ValidateGamerGirl(scene, false);
            Debug.Log("SK_GamerGirl_Agent validation passed: Humanoid body, URP materials, face bindings, NavMesh locomotion, gaze and hand rigs are configured.");
        }

        static void ConfigureLoaders(BuildTargetGroup target, string loaderPath)
        {
            var settings = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(target);
            if (settings == null || settings.AssignedSettings == null)
                throw new BuildFailedException("XR Plug-in Management settings are missing for " + target + ".");
            var loader = string.IsNullOrEmpty(loaderPath) ? null : AssetDatabase.LoadAssetAtPath<XRLoader>(loaderPath);
            if (!string.IsNullOrEmpty(loaderPath) && loader == null) throw new BuildFailedException("XR loader is missing: " + loaderPath);
            var loaders = loader == null ? new List<XRLoader>() : new List<XRLoader> { loader };
            if (!settings.AssignedSettings.TrySetLoaders(loaders))
                throw new BuildFailedException("Could not configure XR loaders for " + target + ".");
            settings.AssignedSettings.automaticLoading = false;
            settings.AssignedSettings.automaticRunning = false;
            settings.InitManagerOnStart = false;
            EditorUtility.SetDirty(settings);
            EditorUtility.SetDirty(settings.AssignedSettings);
        }

        static void ValidateLoaders(BuildTargetGroup target, string expected)
        {
            var settings = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(target);
            var loaders = settings?.AssignedSettings?.activeLoaders?.ToArray();
            if (settings?.AssignedSettings == null || settings.InitManagerOnStart ||
                settings.AssignedSettings.automaticLoading || settings.AssignedSettings.automaticRunning)
                throw new BuildFailedException(target + " must use the controlled OpenCode Customs XR lifecycle instead of automatic XR startup.");
            if (string.IsNullOrEmpty(expected))
            {
                if (loaders != null && loaders.Length > 0)
                    throw new BuildFailedException(target + " must not start an XR loader; XRI Interaction Simulator owns Editor devices.");
                return;
            }
            if (loaders == null || loaders.Length != 1 || loaders[0] == null || loaders[0].name != expected)
                throw new BuildFailedException(target + " must use only " + expected + ".");
        }

        static void ValidateTmpFallback()
        {
            var font = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(TmpFallbackPath);
            if (font == null)
                throw new BuildFailedException("TextMesh Pro fallback font is missing: " + TmpFallbackPath);
            if (SerializationUtility.HasManagedReferencesWithMissingTypes(font) ||
                AssetDatabase.LoadAllAssetsAtPath(TmpFallbackPath).Any(value => value == null))
                throw new BuildFailedException("TextMesh Pro fallback font contains unresolved serialized references: " + TmpFallbackPath);
            if (font.sourceFontFile == null || font.material == null || font.atlasTextures == null ||
                font.atlasTextures.Length == 0 || font.atlasTextures.Any(value => value == null))
                throw new BuildFailedException("TextMesh Pro fallback font is incomplete. Restore its source font, material and atlas: " + TmpFallbackPath);
        }

        static string[] AuditMissingScripts(Scene scene)
        {
            var paths = new List<string>();
            foreach (var root in scene.GetRootGameObjects()) CollectMissingScripts(root, "Scene", paths);
            foreach (var dependency in AssetDatabase.GetDependencies(ScenePath, true))
            {
                if (dependency.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                {
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(dependency);
                    if (prefab != null) CollectMissingScripts(prefab, dependency, paths);
                }
                CollectMissingObjectReferences(dependency, paths);
                CollectMissingAnimatorBehaviours(dependency, paths);
            }
            CollectMissingManagedReferences("Assets/XR/XRGeneralSettingsPerBuildTarget.asset", paths);
            CollectMissingManagedReferences("Assets/XR/Settings/OpenXR Package Settings.asset", paths);
            CollectMissingManagedReferences("Assets/Settings/Project Configuration/UniversalRenderPipelineGlobalSettings.asset", paths);
            CollectMissingObjectReferences("Assets/XR/XRGeneralSettingsPerBuildTarget.asset", paths);
            CollectMissingObjectReferences("Assets/XR/Settings/OpenXR Package Settings.asset", paths);
            return paths.Distinct().OrderBy(value => value).ToArray();
        }

        static void CollectMissingObjectReferences(string assetPath, List<string> paths)
        {
            foreach (var value in AssetDatabase.LoadAllAssetsAtPath(assetPath))
            {
                if (value == null)
                {
                    paths.Add(assetPath + ": unresolved serialized sub-asset");
                    continue;
                }
                var serialized = new SerializedObject(value);
                var property = serialized.GetIterator();
                if (!property.Next(true)) continue;
                do
                {
                    if (property.propertyType != SerializedPropertyType.ObjectReference ||
                        property.name != "m_Script" || property.objectReferenceValue != null) continue;
                    paths.Add(assetPath + ": " + value.name + "." + property.propertyPath + " references a missing script");
                }
                while (property.Next(true));
            }
        }

        static void CollectMissingAnimatorBehaviours(string assetPath, List<string> paths)
        {
            var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(assetPath);
            if (controller == null) return;
            foreach (var layer in controller.layers)
                CollectMissingAnimatorBehaviours(assetPath, layer.stateMachine, paths);
        }

        static void CollectMissingAnimatorBehaviours(string assetPath, AnimatorStateMachine stateMachine, List<string> paths)
        {
            foreach (var state in stateMachine.states.Select(value => value.state))
                if (state.behaviours.Any(value => value == null))
                    paths.Add(assetPath + ": animator state " + state.name + " has a missing StateMachineBehaviour");
            foreach (var child in stateMachine.stateMachines)
                CollectMissingAnimatorBehaviours(assetPath, child.stateMachine, paths);
        }

        static void CollectMissingScripts(GameObject root, string source, List<string> paths)
        {
            foreach (var value in root.GetComponentsInChildren<Transform>(true))
            {
                var count = GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(value.gameObject);
                if (count == 0) continue;
                paths.Add(source + ": " + AnimationUtility.CalculateTransformPath(value, root.transform) + " (" + count + ")");
            }
        }

        static void CollectMissingManagedReferences(string assetPath, List<string> paths)
        {
            foreach (var value in AssetDatabase.LoadAllAssetsAtPath(assetPath))
            {
                if (value == null || !SerializationUtility.HasManagedReferencesWithMissingTypes(value)) continue;
                foreach (var missing in SerializationUtility.GetManagedReferencesWithMissingTypes(value))
                    paths.Add(assetPath + ": " + value.name + " -> " + missing.namespaceName + "." + missing.className);
            }
        }

        [MenuItem("OpenCode Customs/Repair URP Global Settings")]
        public static void RepairUrpGlobalSettings()
        {
            var settings = GraphicsSettings.GetSettingsForRenderPipeline<UniversalRenderPipeline>();
            if (settings == null)
                throw new BuildFailedException("URP Global Settings are not assigned in Project Settings > Graphics.");
            if (!SerializationUtility.HasManagedReferencesWithMissingTypes(settings)) return;

            foreach (var missing in SerializationUtility.GetManagedReferencesWithMissingTypes(settings))
                SerializationUtility.ClearManagedReferenceWithMissingType(settings, missing.referenceId);
            settings.Initialize();
            EditorUtility.SetDirty(settings);
            AssetDatabase.SaveAssetIfDirty(settings);

            if (!SerializationUtility.HasManagedReferencesWithMissingTypes(settings))
            {
                Debug.Log("URP Global Settings repaired for the installed render pipeline package.");
                return;
            }
            var names = System.Array.ConvertAll(
                SerializationUtility.GetManagedReferencesWithMissingTypes(settings),
                value => value.namespaceName + "." + value.className);
            throw new BuildFailedException("URP Global Settings still contain missing managed-reference types: " + string.Join(", ", names));
        }

        [InitializeOnLoadMethod]
        static void RepairUrpGlobalSettingsAfterReload()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                var settings = GraphicsSettings.GetSettingsForRenderPipeline<UniversalRenderPipeline>();
                if (settings == null || !SerializationUtility.HasManagedReferencesWithMissingTypes(settings)) return;
                RepairUrpGlobalSettings();
            };
        }

        static GameObject CreateGamerGirlBody(Transform parent)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GamerGirlPrefabPath);
            if (prefab == null) throw new BuildFailedException("GamerGirl prefab is missing: " + GamerGirlPrefabPath);
            var body = PrefabUtility.InstantiatePrefab(prefab, parent) as GameObject;
            if (body == null) throw new BuildFailedException("Could not instantiate the GamerGirl prefab.");
            body.name = "SK_GamerGirl_Agent";
            body.transform.localPosition = Vector3.zero;
            body.transform.localRotation = Quaternion.identity;
            body.transform.localScale = Vector3.one;
            return body;
        }

        static void ConfigureNavMeshAgent(NavMeshAgent agent, GameObject body)
        {
            var renderers = body.GetComponentsInChildren<Renderer>(true);
            var bounds = renderers.Length == 0
                ? new Bounds(body.transform.position + Vector3.up, new Vector3(0.7f, 2f, 0.7f))
                : renderers.Select(value => value.bounds).Aggregate((left, right) => { left.Encapsulate(right); return left; });
            agent.height = Mathf.Clamp(bounds.size.y, 1.5f, 2.2f);
            agent.radius = Mathf.Clamp(Mathf.Min(bounds.size.x, bounds.size.z) * 0.35f, 0.25f, 0.42f);
            agent.baseOffset = Mathf.Max(0f, bounds.min.y - body.transform.position.y);
            agent.speed = 3.5f;
            agent.angularSpeed = 360f;
            agent.acceleration = 10f;
            agent.autoBraking = true;
        }

        static RuntimeAnimatorController EnsureAnimatorController(bool strict)
        {
            var paths = RequiredAnimations.ToDictionary(value => value, AnimationAssetPath);
            var missing = paths.Where(value => value.Value == null).Select(value => value.Key).ToArray();
            if (missing.Length > 0)
            {
                var message = "Missing Mixamo Humanoid animations in " + AnimationDirectory + ": " + string.Join(", ", missing) +
                    ". Add each as <Name>.fbx or <Name>.anim; use In Place for Walk and Run.";
                if (strict) throw new BuildFailedException(message);
                Debug.LogWarning(message + " The scene will use the Humanoid bind pose until they are added.");
                return null;
            }

            Directory.CreateDirectory(AvatarDirectory);
            AssetDatabase.Refresh();
            foreach (var value in paths) ConfigureAnimationImporter(value.Value, value.Key == "Idle" || value.Key == "Walk" || value.Key == "Run" || value.Key == "Talking" || value.Key == "Thinking");
            var optionalPaths = OptionalGestures
                .Select(value => new { definition = value, path = GestureDirectory + "/" + value.file })
                .Where(value => File.Exists(value.path))
                .ToArray();
            foreach (var value in optionalPaths) ConfigureAnimationImporter(value.path, false);
            var optionalClips = new Dictionary<string, AnimationClip>();
            foreach (var value in optionalPaths)
            {
                var clip = LoadAnimationClip(value.path);
                if (clip != null) optionalClips[value.definition.trigger] = clip;
                else Debug.LogWarning("Optional gesture contains no usable AnimationClip: " + value.path);
            }
            var existing = AssetDatabase.LoadAssetAtPath<AnimatorController>(AnimatorControllerPath);
            if (existing != null)
            {
                foreach (var parameter in new[]
                {
                    new AnimatorControllerParameter { name = "Speed", type = AnimatorControllerParameterType.Float },
                    new AnimatorControllerParameter { name = "AngularSpeed", type = AnimatorControllerParameterType.Float },
                    new AnimatorControllerParameter { name = "AgentState", type = AnimatorControllerParameterType.Int },
                    new AnimatorControllerParameter { name = "Emotion", type = AnimatorControllerParameterType.Int },
                    new AnimatorControllerParameter { name = "EmotionIntensity", type = AnimatorControllerParameterType.Float },
                })
                    if (!existing.parameters.Any(value => value.name == parameter.name)) existing.AddParameter(parameter);
                var layers = existing.layers;
                if (layers.Length == 0) throw new BuildFailedException("Generated GamerGirl controller has no locomotion layer.");
                layers[0].iKPass = true;
                existing.layers = layers;
                EnsureOptionalGestures(existing, optionalClips);
                EditorUtility.SetDirty(existing);
                AssetDatabase.SaveAssetIfDirty(existing);
                return existing;
            }

            var clips = paths.ToDictionary(value => value.Key, value => LoadAnimationClip(value.Value));
            var invalid = clips.Where(value => value.Value == null).Select(value => value.Key).ToArray();
            if (invalid.Length > 0) throw new BuildFailedException("Mixamo files contain no usable AnimationClip: " + string.Join(", ", invalid));

            var controller = AnimatorController.CreateAnimatorControllerAtPath(AnimatorControllerPath);
            controller.AddParameter("Speed", AnimatorControllerParameterType.Float);
            controller.AddParameter("AngularSpeed", AnimatorControllerParameterType.Float);
            controller.AddParameter("AgentState", AnimatorControllerParameterType.Int);
            controller.AddParameter("Emotion", AnimatorControllerParameterType.Int);
            controller.AddParameter("EmotionIntensity", AnimatorControllerParameterType.Float);
            foreach (var trigger in new[] { "Wave", "Point", "Nod", "Thinking" }.Concat(optionalClips.Keys))
                controller.AddParameter(trigger, AnimatorControllerParameterType.Trigger);

            var baseLayer = controller.layers[0];
            baseLayer.name = "Locomotion";
            baseLayer.iKPass = true;
            var locomotion = baseLayer.stateMachine.AddState("Locomotion");
            var blend = new BlendTree { name = "Idle Walk Run", blendParameter = "Speed", useAutomaticThresholds = false };
            AssetDatabase.AddObjectToAsset(blend, controller);
            blend.AddChild(clips["Idle"], 0f);
            blend.AddChild(clips["Walk"], 0.65f);
            blend.AddChild(clips["Run"], 3.5f);
            locomotion.motion = blend;
            baseLayer.stateMachine.defaultState = locomotion;
            var controllerLayers = controller.layers;
            controllerLayers[0] = baseLayer;
            controller.layers = controllerLayers;

            var upperStateMachine = new AnimatorStateMachine { name = "Upper Body" };
            AssetDatabase.AddObjectToAsset(upperStateMachine, controller);
            var empty = upperStateMachine.AddState("Empty");
            upperStateMachine.defaultState = empty;
            var talking = AddState(upperStateMachine, "Talking", clips["Talking"]);
            var thinking = AddState(upperStateMachine, "Thinking", clips["Thinking"]);
            AddStateCondition(upperStateMachine, talking, "AgentState", 3);
            AddStateCondition(upperStateMachine, thinking, "AgentState", 2);
            AddExitCondition(talking, empty, "AgentState", 3);
            AddExitCondition(thinking, empty, "AgentState", 2);
            AddGesture(upperStateMachine, empty, "Wave", clips["Wave"]);
            AddGesture(upperStateMachine, empty, "Point", clips["Point"]);
            AddGesture(upperStateMachine, empty, "Nod", clips["Nod"]);
            AddGesture(upperStateMachine, empty, "Thinking", clips["Thinking"]);
            foreach (var gesture in optionalClips) AddGesture(upperStateMachine, empty, gesture.Key, gesture.Value);
            controller.AddLayer(new AnimatorControllerLayer
            {
                name = "Upper Body",
                avatarMask = EnsureUpperBodyMask(),
                blendingMode = AnimatorLayerBlendingMode.Override,
                defaultWeight = 1f,
                stateMachine = upperStateMachine,
            });
            EditorUtility.SetDirty(controller);
            AssetDatabase.SaveAssets();
            return controller;
        }

        static void EnsureOptionalGestures(AnimatorController controller, Dictionary<string, AnimationClip> clips)
        {
            var upperLayer = controller.layers.FirstOrDefault(value => value.name == "Upper Body");
            if (upperLayer == null || upperLayer.stateMachine == null) throw new BuildFailedException("Generated GamerGirl controller has no Upper Body layer.");
            var empty = upperLayer.stateMachine.states.Select(value => value.state).FirstOrDefault(value => value.name == "Empty");
            if (empty == null) throw new BuildFailedException("Generated GamerGirl controller has no Empty upper-body state.");
            foreach (var gesture in clips)
            {
                if (!controller.parameters.Any(value => value.name == gesture.Key)) controller.AddParameter(gesture.Key, AnimatorControllerParameterType.Trigger);
                var state = upperLayer.stateMachine.states.Select(value => value.state).FirstOrDefault(value => value.name == gesture.Key + " Gesture");
                if (state != null)
                {
                    state.motion = gesture.Value;
                    EditorUtility.SetDirty(state);
                    continue;
                }
                AddGesture(upperLayer.stateMachine, empty, gesture.Key, gesture.Value);
            }
            EditorUtility.SetDirty(controller);
            AssetDatabase.SaveAssets();
        }

        static string AnimationAssetPath(string name)
        {
            var fbx = AnimationDirectory + "/" + name + ".fbx";
            if (File.Exists(fbx)) return fbx;
            var clip = AnimationDirectory + "/" + name + ".anim";
            return File.Exists(clip) ? clip : null;
        }

        static void ConfigureAnimationImporter(string path, bool loop)
        {
            if (!(AssetImporter.GetAtPath(path) is ModelImporter importer)) return;
            var changed = !importer.importAnimation || importer.animationType != ModelImporterAnimationType.Human || importer.avatarSetup != ModelImporterAvatarSetup.CreateFromThisModel;
            importer.importAnimation = true;
            importer.animationType = ModelImporterAnimationType.Human;
            importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            var clips = importer.defaultClipAnimations;
            foreach (var clip in clips)
            {
                if (clip.loopTime == loop && clip.loopPose == loop) continue;
                clip.loopTime = loop;
                clip.loopPose = loop;
                changed = true;
            }
            if (clips.Length > 0) importer.clipAnimations = clips;
            if (changed) importer.SaveAndReimport();
        }

        static AnimationClip LoadAnimationClip(string path) => AssetDatabase.LoadAllAssetsAtPath(path)
            .OfType<AnimationClip>()
            .FirstOrDefault(value => !value.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase));

        static AvatarMask EnsureUpperBodyMask()
        {
            var existing = AssetDatabase.LoadAssetAtPath<AvatarMask>(UpperBodyMaskPath);
            if (existing != null) return existing;
            var mask = new AvatarMask { name = "GamerGirl Upper Body" };
            for (var index = 0; index < (int)AvatarMaskBodyPart.LastBodyPart; index++) mask.SetHumanoidBodyPartActive((AvatarMaskBodyPart)index, false);
            foreach (var part in new[] { AvatarMaskBodyPart.Body, AvatarMaskBodyPart.Head, AvatarMaskBodyPart.LeftArm, AvatarMaskBodyPart.RightArm, AvatarMaskBodyPart.LeftFingers, AvatarMaskBodyPart.RightFingers })
                mask.SetHumanoidBodyPartActive(part, true);
            AssetDatabase.CreateAsset(mask, UpperBodyMaskPath);
            return mask;
        }

        static AnimatorState AddState(AnimatorStateMachine stateMachine, string name, Motion motion)
        {
            var state = stateMachine.AddState(name);
            state.motion = motion;
            return state;
        }

        static void AddStateCondition(AnimatorStateMachine stateMachine, AnimatorState state, string parameter, float value)
        {
            var transition = stateMachine.AddAnyStateTransition(state);
            transition.duration = 0.12f;
            transition.canTransitionToSelf = false;
            transition.AddCondition(AnimatorConditionMode.Equals, value, parameter);
        }

        static void AddExitCondition(AnimatorState state, AnimatorState destination, string parameter, float value)
        {
            var transition = state.AddTransition(destination);
            transition.duration = 0.12f;
            transition.AddCondition(AnimatorConditionMode.NotEqual, value, parameter);
        }

        static void AddGesture(AnimatorStateMachine stateMachine, AnimatorState destination, string trigger, Motion motion)
        {
            var state = AddState(stateMachine, trigger + " Gesture", motion);
            var enter = stateMachine.AddAnyStateTransition(state);
            enter.duration = 0.08f;
            enter.canTransitionToSelf = false;
            enter.AddCondition(AnimatorConditionMode.If, 0f, trigger);
            var exit = state.AddTransition(destination);
            exit.hasExitTime = true;
            exit.exitTime = 0.92f;
            exit.duration = 0.1f;
        }

        static AvatarRigTargets ConfigureRig(GameObject companion, Animator animator, Transform player)
        {
            RequireBone(animator, HumanBodyBones.Head);
            var leftUpperArm = RequireBone(animator, HumanBodyBones.LeftUpperArm);
            var leftLowerArm = RequireBone(animator, HumanBodyBones.LeftLowerArm);
            var leftHand = RequireBone(animator, HumanBodyBones.LeftHand);
            var rightUpperArm = RequireBone(animator, HumanBodyBones.RightUpperArm);
            var rightLowerArm = RequireBone(animator, HumanBodyBones.RightLowerArm);
            var rightHand = RequireBone(animator, HumanBodyBones.RightHand);

            var targets = new GameObject("Rig Targets");
            targets.transform.SetParent(companion.transform, false);
            var leftTarget = Target("Left Hand Target", targets.transform, leftHand.position);
            var rightTarget = Target("Right Hand Target", targets.transform, rightHand.position);
            var leftHint = Target("Left Elbow Hint", targets.transform, leftLowerArm.position - companion.transform.right * 0.25f - companion.transform.forward * 0.15f);
            var rightHint = Target("Right Elbow Hint", targets.transform, rightLowerArm.position + companion.transform.right * 0.25f - companion.transform.forward * 0.15f);

            var builder = animator.gameObject.GetComponent<RigBuilder>() ?? animator.gameObject.AddComponent<RigBuilder>();
            var leftRig = CreateHandRig(animator.transform, "Left Hand Rig", leftUpperArm, leftLowerArm, leftHand, leftTarget, leftHint);
            var rightRig = CreateHandRig(animator.transform, "Right Hand Rig", rightUpperArm, rightLowerArm, rightHand, rightTarget, rightHint);
            builder.layers.Clear();
            builder.layers.Add(new RigLayer(leftRig));
            builder.layers.Add(new RigLayer(rightRig));

            // OnAnimatorIK is dispatched to behaviours on the Animator GameObject.
            var gaze = animator.gameObject.AddComponent<AvatarHumanoidGaze>();
            gaze.animator = animator;
            gaze.defaultTarget = player;

            var value = companion.AddComponent<AvatarRigTargets>();
            value.defaultLookTarget = player;
            value.gaze = gaze;
            value.leftHandTarget = leftTarget;
            value.rightHandTarget = rightTarget;
            value.leftHandRig = leftRig;
            value.rightHandRig = rightRig;
            return value;
        }

        static Rig CreateHandRig(Transform parent, string name, Transform upperArm, Transform lowerArm, Transform hand, Transform target, Transform hint)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            var rig = root.AddComponent<Rig>();
            rig.weight = 0f;
            var constraint = root.AddComponent<TwoBoneIKConstraint>();
            var data = constraint.data;
            data.root = upperArm;
            data.mid = lowerArm;
            data.tip = hand;
            data.target = target;
            data.hint = hint;
            data.targetPositionWeight = 1f;
            data.targetRotationWeight = 0f;
            data.hintWeight = 1f;
            constraint.data = data;
            return rig;
        }

        static Transform Target(string name, Transform parent, Vector3 position)
        {
            var value = new GameObject(name).transform;
            value.SetParent(parent);
            value.position = position;
            return value;
        }

        static Transform RequireBone(Animator animator, HumanBodyBones bone)
        {
            var value = animator.GetBoneTransform(bone);
            if (value == null) throw new BuildFailedException("SK_GamerGirl_Agent Humanoid Avatar is missing bone: " + bone);
            return value;
        }

        static SkinnedMeshRenderer FindFaceRenderer(GameObject body) => body.GetComponentsInChildren<SkinnedMeshRenderer>(true)
            .FirstOrDefault(value => HasBlendShape(value, "jawOpen") && HasBlendShape(value, "eyeBlinkLeft"));

        static bool HasBlendShape(SkinnedMeshRenderer renderer, string name) => renderer != null && renderer.sharedMesh != null && renderer.sharedMesh.GetBlendShapeIndex(name) >= 0;

        static AvatarBlendShapeBinding Binding(string key, string shape, float weight) => new AvatarBlendShapeBinding { key = key, blendShape = shape, weight = weight };

        static AvatarBlendShapeBinding[] VisemeBindings() => new[]
        {
            Binding("AA", "jawOpen", 100f), Binding("AA", "mouthLowerDownLeft", 22f), Binding("AA", "mouthLowerDownRight", 22f),
            Binding("E", "mouthStretchLeft", 62f), Binding("E", "mouthStretchRight", 62f), Binding("E", "mouthSmileLeft", 24f), Binding("E", "mouthSmileRight", 24f),
            Binding("I", "jawOpen", 18f), Binding("I", "mouthStretchLeft", 42f), Binding("I", "mouthStretchRight", 42f),
            Binding("O", "mouthFunnel", 82f), Binding("O", "jawOpen", 42f),
            Binding("U", "mouthPucker", 88f), Binding("U", "jawOpen", 16f),
        };

        static AvatarBlendShapeBinding[] EmotionBindings() => new[]
        {
            Binding("positive", "mouthSmileLeft", 78f), Binding("positive", "mouthSmileRight", 78f), Binding("positive", "cheekSquintLeft", 22f), Binding("positive", "cheekSquintRight", 22f),
            Binding("concerned", "browInnerUp", 68f), Binding("concerned", "mouthFrownLeft", 38f), Binding("concerned", "mouthFrownRight", 38f),
            Binding("thoughtful", "browInnerUp", 35f), Binding("thoughtful", "mouthPressLeft", 28f), Binding("thoughtful", "mouthPressRight", 28f),
        };

        static void ValidateGamerGirl(Scene scene, bool requireAnimatorController)
        {
            var body = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<Transform>(true)).FirstOrDefault(value => value.name == "SK_GamerGirl_Agent");
            if (body == null) throw new BuildFailedException("Jarvis Room must contain SK_GamerGirl_Agent.");
            var animator = body.GetComponentInChildren<Animator>(true);
            if (animator == null || animator.avatar == null || !animator.avatar.isHuman || !animator.avatar.isValid)
                throw new BuildFailedException("SK_GamerGirl_Agent Humanoid Avatar is invalid.");
            if (requireAnimatorController && animator.runtimeAnimatorController == null) throw new BuildFailedException("SK_GamerGirl_Agent Animator Controller is missing.");
            if (animator.runtimeAnimatorController is AnimatorController controller)
            {
                if (controller.layers.Length == 0 || !controller.layers[0].iKPass)
                    throw new BuildFailedException("GamerGirl locomotion layer must enable humanoid IK for gaze.");
                var configured = OptionalGestures.Where(value => File.Exists(GestureDirectory + "/" + value.file)).Select(value => value.trigger).ToArray();
                var missingParameters = configured.Where(value => !controller.parameters.Any(parameter => parameter.name == value)).ToArray();
                var upperLayer = controller.layers.FirstOrDefault(value => value.name == "Upper Body");
                var stateNames = upperLayer?.stateMachine?.states.Select(value => value.state.name).ToArray() ?? Array.Empty<string>();
                var missingStates = configured.Where(value => !stateNames.Contains(value + " Gesture")).ToArray();
                if (missingParameters.Length > 0 || missingStates.Length > 0)
                    throw new BuildFailedException("GamerGirl optional gestures are incomplete. Missing parameters: " + string.Join(", ", missingParameters) + "; missing states: " + string.Join(", ", missingStates));
            }
            var presentation = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<AvatarVRMPresentation>(true)).FirstOrDefault();
            if (presentation == null || presentation.face == null) throw new BuildFailedException("GamerGirl facial presentation is not configured.");
            var missing = RequiredBlendShapes.Where(value => !HasBlendShape(presentation.face, value)).ToArray();
            if (missing.Length > 0) throw new BuildFailedException("GamerGirl face is missing required blend shapes: " + string.Join(", ", missing));
            if (body.GetComponentInParent<AvatarLocomotionController>() == null) throw new BuildFailedException("GamerGirl locomotion controller is missing.");
            var rigTargets = body.GetComponentInParent<AvatarRigTargets>();
            if (rigTargets == null || rigTargets.gaze == null || body.GetComponentInChildren<AvatarHumanoidGaze>(true) == null || body.GetComponentInChildren<RigBuilder>(true) == null)
                throw new BuildFailedException("GamerGirl gaze and hand rigs are missing.");
            if (body.GetComponentInChildren<MultiAimConstraint>(true) != null)
                throw new BuildFailedException("GamerGirl still contains the obsolete model-axis head MultiAim constraint.");
            var invalidMaterials = body.GetComponentsInChildren<Renderer>(true).SelectMany(value => value.sharedMaterials).Any(value => value == null || value.shader == null);
            if (invalidMaterials) throw new BuildFailedException("GamerGirl contains a missing material or shader.");
        }

        static GameObject CreateXROrigin()
        {
            var player = new GameObject("XriPlayerRig");
            var preferred = new[]
            {
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Hands Interaction Demo/Prefabs/XR Origin Hands (XR Rig).prefab",
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Starter Assets/Prefabs/XR Origin (XR Rig).prefab",
            };
            GameObject origin = null;
            foreach (var path in preferred)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;
                origin = PrefabUtility.InstantiatePrefab(prefab, player.transform) as GameObject;
                if (origin == null) continue;
                origin.name = "XR Origin (Quest 3)";
                PrefabUtility.UnpackPrefabInstance(origin, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                break;
            }
            if (origin == null) new GameObject("XR Origin (fallback)").transform.SetParent(player.transform, false);

            foreach (var xrOrigin in player.GetComponentsInChildren<XROrigin>(true))
            {
                xrOrigin.CameraYOffset = 0f;
                if (xrOrigin.CameraFloorOffsetObject != null)
                    xrOrigin.CameraFloorOffsetObject.transform.localPosition = Vector3.zero;
            }

            var simulator = InstantiatePrefab(InteractionSimulatorPrefabPath, player.transform, "XR Interaction Simulator (Editor Only)");
            if (simulator == null)
                throw new BuildFailedException("XR Interaction Simulator is missing. Copy it from vr-constructor to " + InteractionSimulatorPrefabPath + ".");
            simulator.tag = "EditorOnly";

            var eventSystem = new GameObject("XriEventSystem");
            eventSystem.transform.SetParent(player.transform, false);
            eventSystem.AddComponent<EventSystem>();
            eventSystem.AddComponent<XRUIInputModule>();
            return player;
        }

        static void RemoveMissingSceneScripts(GameObject root)
        {
            foreach (var value in root.GetComponentsInChildren<Transform>(true))
            {
                var count = GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(value.gameObject);
                if (count == 0) continue;
                Debug.LogWarning("Removed " + count + " stale generated component reference(s) from " +
                    AnimationUtility.CalculateTransformPath(value, root.transform) + ".");
                GameObjectUtility.RemoveMonoBehavioursWithMissingScript(value.gameObject);
            }
        }

        static AvatarXRInputVisuals AttachInputVisuals(GameObject player)
        {
            var transforms = player.GetComponentsInChildren<Transform>(true);
            var parent = System.Array.Find(transforms, value => value.name == "Camera Offset") ?? player.transform;
            var leftController = System.Array.Find(transforms, value => value.name == "Left Controller")?.gameObject ?? InstantiatePrefab(
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Starter Assets/Prefabs/Controllers/XR Controller Left.prefab",
                parent,
                "Left Controller");
            var rightController = System.Array.Find(transforms, value => value.name == "Right Controller")?.gameObject ?? InstantiatePrefab(
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Starter Assets/Prefabs/Controllers/XR Controller Right.prefab",
                parent,
                "Right Controller");
            if (leftController == null || rightController == null)
                throw new BuildFailedException("Tracked left/right XRI controller roots are missing.");
            var visuals = player.GetComponent<AvatarXRInputVisuals>() ?? player.AddComponent<AvatarXRInputVisuals>();
            visuals.leftController = leftController;
            visuals.rightController = rightController;
            visuals.leftHand = System.Array.Find(transforms, value => value.name == "Left Hand")?.gameObject;
            visuals.rightHand = System.Array.Find(transforms, value => value.name == "Right Hand")?.gameObject;
            visuals.modalityManager = player.GetComponentInChildren<XRInputModalityManager>(true);
            if (visuals.modalityManager != null) visuals.modalityManager.enabled = false;
            return visuals;
        }

        static GameObject InstantiatePrefab(string path, Transform parent, string name)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) return null;
            var value = PrefabUtility.InstantiatePrefab(prefab, parent) as GameObject;
            if (value != null)
            {
                value.name = name;
                PrefabUtility.UnpackPrefabInstance(value, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            }
            return value;
        }

        static Camera CameraFallback(GameObject parent)
        {
            var value = new GameObject("Main Camera");
            value.transform.SetParent(parent.transform); value.transform.localPosition = new Vector3(0, 1.7f, 0);
            var camera = value.AddComponent<Camera>(); camera.tag = "MainCamera"; value.AddComponent<AudioListener>();
            return camera;
        }

        static GameObject Entity(string name, string id, string kind, string itemID, Vector3 position, JarvisRoomWorld world)
        {
            var value = GameObject.CreatePrimitive(kind == "npc" ? PrimitiveType.Capsule : PrimitiveType.Cube);
            value.name = name; value.transform.position = position;
            var semantic = value.AddComponent<OpenCodeWorldEntity>();
            semantic.kind = kind; semantic.label = name;
            semantic.tags = new[] { kind, kind == "item" ? "portable" : "quest" };
            semantic.affordances = kind == "item" ? new[] { "inspect", "pick_up" } : new[] { "inspect", "use" };
            var serialized = new SerializedObject(semantic);
            serialized.FindProperty("stableID").stringValue = id;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            var entity = value.AddComponent<JarvisRoomEntity>();
            entity.entityID = id; entity.itemID = itemID; entity.world = world; entity.semantic = semantic;
            return value;
        }

        static GameObject Cube(string name, Vector3 position, Vector3 scale, Transform parent)
        {
            var value = GameObject.CreatePrimitive(PrimitiveType.Cube);
            value.name = name; value.transform.SetParent(parent); value.transform.position = position; value.transform.localScale = scale;
            return value;
        }
    }
}
