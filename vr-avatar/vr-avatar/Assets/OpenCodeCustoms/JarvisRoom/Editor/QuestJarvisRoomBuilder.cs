using System;
using System.Linq;
using System.IO;
using OpenCode.Customs.AvatarBridge;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Rendering;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Animations.Rigging;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace OpenCode.Customs.QuestAlpha.Editor
{
    public static class QuestJarvisRoomBuilder
    {
        const string SceneDirectory = "Assets/OpenCodeCustoms/JarvisRoom";
        const string ScenePath = SceneDirectory + "/JarvisRoom.unity";
        const string AvatarDirectory = "Assets/OpenCodeCustoms/Avatar";
        const string AnimationDirectory = AvatarDirectory + "/Animations/Mixamo";
        const string AnimatorControllerPath = AvatarDirectory + "/GamerGirlAgent.controller";
        const string UpperBodyMaskPath = AvatarDirectory + "/GamerGirlUpperBody.mask";
        const string GamerGirlPrefabPath = "Assets/GamerGirl/Render pipeline/URP/Prefab/SK_GamerGirl_02 White Variant.prefab";
        static readonly string[] RequiredAnimations = { "Idle", "Walk", "Run", "Talking", "Thinking", "Wave", "Point", "Nod" };
        static readonly string[] RequiredBlendShapes = { "jawOpen", "eyeBlinkLeft", "eyeBlinkRight", "mouthFunnel", "mouthPucker", "mouthSmileLeft", "mouthSmileRight", "browInnerUp" };

        [MenuItem("OpenCode Customs/Create Quest Jarvis Room")]
        public static void Create()
        {
            Directory.CreateDirectory(SceneDirectory);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var environment = new GameObject("Jarvis Room Environment");
            var surface = environment.AddComponent<NavMeshSurface>();
            Cube("Floor", new Vector3(0, -0.1f, 0), new Vector3(12, 0.2f, 12), environment.transform);
            Cube("North Wall", new Vector3(0, 1.5f, 6), new Vector3(12, 3, 0.2f), environment.transform);
            Cube("South Wall", new Vector3(0, 1.5f, -6), new Vector3(12, 3, 0.2f), environment.transform);
            Cube("West Wall", new Vector3(-6, 1.5f, 0), new Vector3(0.2f, 3, 12), environment.transform);
            Cube("East Wall A", new Vector3(6, 1.5f, -3.7f), new Vector3(0.2f, 3, 4.6f), environment.transform);
            Cube("East Wall B", new Vector3(6, 1.5f, 3.7f), new Vector3(0.2f, 3, 4.6f), environment.transform);
            Cube("Workbench", new Vector3(-1.8f, 0.5f, 1.5f), new Vector3(3, 1, 1.2f), environment.transform);

            var player = CreateXROrigin();
            AttachInputVisuals(player);
            var camera = player.GetComponentInChildren<Camera>();
            if (camera == null) camera = CameraFallback(player);

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
            audio.spatialBlend = 1f; audio.maxDistance = 18f;
            var sensor = companion.AddComponent<AvatarWorldSensor>();
            sensor.observer = companion.transform; sensor.viewCamera = camera; sensor.updatesPerSecond = 4;
            var registry = companion.AddComponent<AvatarCapabilityRegistry>();
            var bridge = companion.AddComponent<OpenCodeAvatarBridgeV2>();
            bridge.capabilityRegistry = registry; bridge.worldSensor = sensor; bridge.audioSource = audio;
            bridge.enableMicrophoneStreaming = true; bridge.handsFree = true;
            var overlay = companion.AddComponent<AvatarDeveloperOverlay>();
            overlay.bridge = bridge;
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
            overlay.locomotion = locomotion; overlay.reactions = reactions; overlay.rigTargets = rigTargets; overlay.presentation = presentation;
            var world = companion.AddComponent<JarvisRoomWorld>();
            world.sensor = sensor;

            companion.AddComponent<MoveToCapability>().agent = agent;
            var follow = companion.AddComponent<FollowCapability>(); follow.agent = agent; follow.player = player.transform;
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
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Selection.activeGameObject = companion;
            Debug.Log("Quest Jarvis Room created with SK_GamerGirl_Agent. Paste pairing JSON into OpenCodeAvatarBridgeV2.");
        }

        [MenuItem("OpenCode Customs/Build Quest Development APK")]
        public static void BuildQuestDevelopment()
        {
            EnsureAnimatorController(true);
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

        [MenuItem("OpenCode Customs/Validate Quest Jarvis Room")]
        public static void Validate()
        {
            RepairUrpGlobalSettings();
            EnsureAnimatorController(true);
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var visuals = UnityEngine.Object.FindAnyObjectByType<AvatarXRInputVisuals>(FindObjectsInactive.Include);
            if (visuals == null || visuals.leftController == null || visuals.rightController == null ||
                visuals.leftHand == null || visuals.rightHand == null)
                throw new BuildFailedException("Jarvis Room must contain left/right Quest controller and hand visuals.");
            var missing = 0;
            foreach (var root in scene.GetRootGameObjects())
                foreach (var value in root.GetComponentsInChildren<Transform>(true))
                    missing += GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(value.gameObject);
            if (missing > 0) throw new BuildFailedException("Jarvis Room contains " + missing + " missing script references.");
            ValidateGamerGirl(scene, true);
            Debug.Log("Quest Jarvis Room validation passed: GamerGirl body, facial presentation, Mixamo animation, New Input System, controller visuals and hand visuals are configured.");
        }

        [MenuItem("OpenCode Customs/Validate GamerGirl Agent Body")]
        public static void ValidateGamerGirlBody()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            ValidateGamerGirl(scene, false);
            Debug.Log("SK_GamerGirl_Agent validation passed: Humanoid body, URP materials, face bindings, NavMesh locomotion, gaze and hand rigs are configured.");
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
            EditorGraphicsSettings.PopulateRenderPipelineGraphicsSettings(settings);
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
            var existing = AssetDatabase.LoadAssetAtPath<AnimatorController>(AnimatorControllerPath);
            if (existing != null) return existing;

            var clips = paths.ToDictionary(value => value.Key, value => LoadAnimationClip(value.Value));
            var invalid = clips.Where(value => value.Value == null).Select(value => value.Key).ToArray();
            if (invalid.Length > 0) throw new BuildFailedException("Mixamo files contain no usable AnimationClip: " + string.Join(", ", invalid));

            var controller = AnimatorController.CreateAnimatorControllerAtPath(AnimatorControllerPath);
            controller.AddParameter("Speed", AnimatorControllerParameterType.Float);
            controller.AddParameter("AngularSpeed", AnimatorControllerParameterType.Float);
            controller.AddParameter("AgentState", AnimatorControllerParameterType.Int);
            controller.AddParameter("Emotion", AnimatorControllerParameterType.Int);
            controller.AddParameter("EmotionIntensity", AnimatorControllerParameterType.Float);
            foreach (var trigger in new[] { "Wave", "Point", "Nod", "Thinking" }) controller.AddParameter(trigger, AnimatorControllerParameterType.Trigger);

            var baseLayer = controller.layers[0];
            baseLayer.name = "Locomotion";
            var locomotion = baseLayer.stateMachine.AddState("Locomotion");
            var blend = new BlendTree { name = "Idle Walk Run", blendParameter = "Speed", useAutomaticThresholds = false };
            AssetDatabase.AddObjectToAsset(blend, controller);
            blend.AddChild(clips["Idle"], 0f);
            blend.AddChild(clips["Walk"], 0.65f);
            blend.AddChild(clips["Run"], 3.5f);
            locomotion.motion = blend;
            baseLayer.stateMachine.defaultState = locomotion;

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
            var head = RequireBone(animator, HumanBodyBones.Head);
            var leftUpperArm = RequireBone(animator, HumanBodyBones.LeftUpperArm);
            var leftLowerArm = RequireBone(animator, HumanBodyBones.LeftLowerArm);
            var leftHand = RequireBone(animator, HumanBodyBones.LeftHand);
            var rightUpperArm = RequireBone(animator, HumanBodyBones.RightUpperArm);
            var rightLowerArm = RequireBone(animator, HumanBodyBones.RightLowerArm);
            var rightHand = RequireBone(animator, HumanBodyBones.RightHand);

            var targets = new GameObject("Rig Targets");
            targets.transform.SetParent(companion.transform, false);
            var headTarget = Target("Head Look Target", targets.transform, player.position);
            var leftTarget = Target("Left Hand Target", targets.transform, leftHand.position);
            var rightTarget = Target("Right Hand Target", targets.transform, rightHand.position);
            var leftHint = Target("Left Elbow Hint", targets.transform, leftLowerArm.position - companion.transform.right * 0.25f - companion.transform.forward * 0.15f);
            var rightHint = Target("Right Elbow Hint", targets.transform, rightLowerArm.position + companion.transform.right * 0.25f - companion.transform.forward * 0.15f);

            var builder = animator.gameObject.GetComponent<RigBuilder>() ?? animator.gameObject.AddComponent<RigBuilder>();
            var headRig = CreateHeadRig(animator.transform, head, headTarget);
            var leftRig = CreateHandRig(animator.transform, "Left Hand Rig", leftUpperArm, leftLowerArm, leftHand, leftTarget, leftHint);
            var rightRig = CreateHandRig(animator.transform, "Right Hand Rig", rightUpperArm, rightLowerArm, rightHand, rightTarget, rightHint);
            builder.layers.Add(new RigLayer(headRig));
            builder.layers.Add(new RigLayer(leftRig));
            builder.layers.Add(new RigLayer(rightRig));

            var value = companion.AddComponent<AvatarRigTargets>();
            value.defaultLookTarget = player;
            value.headLookTarget = headTarget;
            value.leftHandTarget = leftTarget;
            value.rightHandTarget = rightTarget;
            value.headRig = headRig;
            value.leftHandRig = leftRig;
            value.rightHandRig = rightRig;
            return value;
        }

        static Rig CreateHeadRig(Transform parent, Transform head, Transform target)
        {
            var root = new GameObject("Head Look Rig");
            root.transform.SetParent(parent, false);
            var rig = root.AddComponent<Rig>();
            rig.weight = 1f;
            var constraint = root.AddComponent<MultiAimConstraint>();
            var data = constraint.data;
            data.constrainedObject = head;
            data.aimAxis = MultiAimConstraintData.Axis.Z;
            data.upAxis = MultiAimConstraintData.Axis.Y;
            data.maintainOffset = true;
            var sources = new WeightedTransformArray();
            sources.Add(new WeightedTransform(target, 1f));
            data.sourceObjects = sources;
            constraint.data = data;
            return rig;
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
            var presentation = scene.GetRootGameObjects().SelectMany(value => value.GetComponentsInChildren<AvatarVRMPresentation>(true)).FirstOrDefault();
            if (presentation == null || presentation.face == null) throw new BuildFailedException("GamerGirl facial presentation is not configured.");
            var missing = RequiredBlendShapes.Where(value => !HasBlendShape(presentation.face, value)).ToArray();
            if (missing.Length > 0) throw new BuildFailedException("GamerGirl face is missing required blend shapes: " + string.Join(", ", missing));
            if (body.GetComponentInParent<AvatarLocomotionController>() == null) throw new BuildFailedException("GamerGirl locomotion controller is missing.");
            if (body.GetComponentInParent<AvatarRigTargets>() == null || body.GetComponentInChildren<RigBuilder>(true) == null)
                throw new BuildFailedException("GamerGirl gaze and hand rigs are missing.");
            var invalidMaterials = body.GetComponentsInChildren<Renderer>(true).SelectMany(value => value.sharedMaterials).Any(value => value == null || value.shader == null);
            if (invalidMaterials) throw new BuildFailedException("GamerGirl contains a missing material or shader.");
        }

        static GameObject CreateXROrigin()
        {
            var preferred = new[]
            {
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Hands Interaction Demo/Prefabs/XR Origin Hands (XR Rig).prefab",
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Starter Assets/Prefabs/XR Origin (XR Rig).prefab",
            };
            foreach (var path in preferred)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;
                var value = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
                if (value == null) continue;
                value.name = "XR Origin (Quest 3)";
                return value;
            }
            return new GameObject("XR Origin (fallback)");
        }

        static void AttachInputVisuals(GameObject player)
        {
            var transforms = player.GetComponentsInChildren<Transform>(true);
            var parent = System.Array.Find(transforms, value => value.name == "Camera Offset") ?? player.transform;
            var leftController = InstantiatePrefab(
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Starter Assets/Prefabs/Controllers/XR Controller Left.prefab",
                parent,
                "Left Quest Controller Visual");
            var rightController = InstantiatePrefab(
                "Assets/Samples/XR Interaction Toolkit/3.5.1/Starter Assets/Prefabs/Controllers/XR Controller Right.prefab",
                parent,
                "Right Quest Controller Visual");
            var visuals = player.AddComponent<AvatarXRInputVisuals>();
            visuals.leftController = leftController;
            visuals.rightController = rightController;
            visuals.leftHand = System.Array.Find(transforms, value => value.name == "Left Hand")?.gameObject;
            visuals.rightHand = System.Array.Find(transforms, value => value.name == "Right Hand")?.gameObject;
        }

        static GameObject InstantiatePrefab(string path, Transform parent, string name)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) return null;
            var value = PrefabUtility.InstantiatePrefab(prefab, parent) as GameObject;
            if (value != null) value.name = name;
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
