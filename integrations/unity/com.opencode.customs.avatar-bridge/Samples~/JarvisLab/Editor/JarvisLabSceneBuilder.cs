using System.IO;
using OpenCode.Customs.AvatarBridge.JarvisLab;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;

namespace OpenCode.Customs.AvatarBridge.JarvisLab.Editor
{
    public static class JarvisLabSceneBuilder
    {
        const string SceneDirectory = "Assets/JarvisLab";
        const string ScenePath = SceneDirectory + "/JarvisLab.unity";

        [MenuItem("OpenCode Customs/Create Jarvis Lab Scene")]
        public static void Create()
        {
            if (!Directory.Exists(SceneDirectory)) Directory.CreateDirectory(SceneDirectory);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var environment = new GameObject("Jarvis Lab Environment");
            var surface = environment.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.All;
            Cube("Floor", new Vector3(0f, -0.1f, 0f), new Vector3(12f, 0.2f, 12f), environment.transform);
            Cube("North Wall", new Vector3(0f, 1.5f, 6f), new Vector3(12f, 3f, 0.2f), environment.transform);
            Cube("South Wall", new Vector3(0f, 1.5f, -6f), new Vector3(12f, 3f, 0.2f), environment.transform);
            Cube("West Wall", new Vector3(-6f, 1.5f, 0f), new Vector3(0.2f, 3f, 12f), environment.transform);
            Cube("East Wall A", new Vector3(6f, 1.5f, -3.8f), new Vector3(0.2f, 3f, 4.4f), environment.transform);
            Cube("East Wall B", new Vector3(6f, 1.5f, 3.8f), new Vector3(0.2f, 3f, 4.4f), environment.transform);
            Cube("Lab Table", new Vector3(-1.5f, 0.55f, 1.2f), new Vector3(3f, 1.1f, 1.2f), environment.transform);

            var player = new GameObject("VR Player Anchor");
            player.transform.position = new Vector3(0f, 1.7f, -3f);
            var camera = player.AddComponent<Camera>();
            camera.tag = "MainCamera";
            player.AddComponent<AudioListener>();

            var companion = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            companion.name = "Jarvis Companion";
            companion.transform.position = new Vector3(0f, 1f, -1f);
            var agent = companion.AddComponent<NavMeshAgent>();
            agent.height = 2f; agent.radius = 0.35f; agent.speed = 3.5f;
            var audio = companion.AddComponent<AudioSource>();
            audio.playOnAwake = false;
            var sensor = companion.AddComponent<AvatarWorldSensor>();
            sensor.observer = companion.transform; sensor.viewCamera = camera; sensor.updatesPerSecond = 4f;
            var registry = companion.AddComponent<AvatarCapabilityRegistry>();
            var bridge = companion.AddComponent<OpenCodeAvatarBridgeV2>();
            bridge.capabilityRegistry = registry; bridge.worldSensor = sensor; bridge.audioSource = audio;
            companion.AddComponent<AvatarDeveloperOverlay>().bridge = bridge;
            companion.AddComponent<AvatarScenarioRecorder>().sensor = sensor;
            var world = companion.AddComponent<JarvisLabWorld>();
            world.sensor = sensor; world.saveSlotID = "slot-1";

            companion.AddComponent<MoveToCapability>().agent = agent;
            var follow = companion.AddComponent<FollowCapability>(); follow.agent = agent; follow.player = player.transform;
            companion.AddComponent<StayCapability>().agent = agent;
            companion.AddComponent<PatrolCapability>().agent = agent;
            companion.AddComponent<CharacterExpressionCapability>();
            AddCapability<InspectLabEntityCapability>(companion, world);
            AddCapability<PickUpLabItemCapability>(companion, world);
            AddCapability<DropLabItemCapability>(companion, world);
            AddCapability<CraftLabItemCapability>(companion, world);
            AddCapability<UseLabItemCapability>(companion, world);
            var doorCapability = AddCapability<OpenLabDoorCapability>(companion, world);
            AddCapability<GiveTechnicianItemCapability>(companion, world);
            AddCapability<AttackTrainingTargetCapability>(companion, world);

            Entity("Lab Key", "lab_key", "item", "lab_key", new Vector3(-2f, 1.2f, 1.2f), new[] { "portable", "quest" }, new[] { "inspect", "pick_up" }, world);
            Entity("Energy Core", "energy_core", "item", "energy_core", new Vector3(-1.4f, 1.2f, 1.2f), new[] { "portable", "crafting" }, new[] { "inspect", "pick_up" }, world);
            Entity("Cell Casing", "casing", "item", "casing", new Vector3(-0.8f, 1.2f, 1.2f), new[] { "portable", "crafting" }, new[] { "inspect", "pick_up" }, world);
            var door = Entity("Lab Door", "lab_door", "door", null, new Vector3(5.9f, 1.2f, 0f), new[] { "door", "quest" }, new[] { "inspect", "open" }, world);
            door.transform.localScale = new Vector3(0.2f, 2.4f, 2.4f);
            doorCapability.door = door.transform;
            Entity("Technician", "technician", "npc", null, new Vector3(3.5f, 1f, 2f), new[] { "npc", "quest" }, new[] { "inspect", "talk", "give_item" }, world);
            Entity("Training Target", "training_target", "hazard", null, new Vector3(3.5f, 1f, -2f), new[] { "hazard", "training" }, new[] { "inspect", "attack" }, world);

            surface.BuildNavMesh();
            registry.Refresh();
            EditorSceneManager.SaveScene(scene, ScenePath);
            Selection.activeGameObject = companion;
            Debug.Log("Jarvis Lab created at " + ScenePath + ". Paste pairing JSON into Jarvis Companion > OpenCodeAvatarBridgeV2 before Play.");
        }

        static T AddCapability<T>(GameObject companion, JarvisLabWorld world) where T : JarvisLabCapability
        {
            var capability = companion.AddComponent<T>();
            capability.world = world;
            return capability;
        }

        static GameObject Entity(string name, string id, string kind, string itemID, Vector3 position, string[] tags, string[] affordances, JarvisLabWorld world)
        {
            var value = GameObject.CreatePrimitive(kind == "npc" ? PrimitiveType.Capsule : PrimitiveType.Cube);
            value.name = name; value.transform.position = position;
            var semantic = value.AddComponent<OpenCodeWorldEntity>();
            semantic.kind = kind; semantic.label = name; semantic.tags = tags; semantic.affordances = affordances;
            var serialized = new SerializedObject(semantic);
            serialized.FindProperty("stableID").stringValue = id;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            var lab = value.AddComponent<JarvisLabEntity>();
            lab.entityID = id; lab.itemID = itemID; lab.world = world; lab.semantic = semantic; lab.Refresh();
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
