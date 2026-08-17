using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class OpenCodeWorldEntity : MonoBehaviour
    {
        [SerializeField] string stableID;
        public string kind = "object";
        public string label;
        public string[] tags = Array.Empty<string>();
        public string[] affordances = Array.Empty<string>();
        [TextArea] public string stateJson = "{}";

        public string StableID => AvatarIDs.Normalize(stableID, gameObject.scene.name + ":" + gameObject.name);

        public Dictionary<string, object> State()
        {
            try { return AvatarJson.Parse(stateJson).ToObject<Dictionary<string, object>>(); }
            catch { return new Dictionary<string, object> { ["invalidState"] = true }; }
        }
    }

    public interface IAvatarWorldStateProvider
    {
        Dictionary<string, object> InventoryState();
        Dictionary<string, object> QuestState();
        Dictionary<string, object> RelationshipState();
    }

    public sealed class AvatarWorldDelta
    {
        public string type = "world.delta";
        public string gameID;
        public string saveSlotID;
        public string characterID;
        public long revision;
        public long timestamp;
        public List<WorldEntityState> upsert = new List<WorldEntityState>();
        public List<string> remove = new List<string>();
        public Dictionary<string, object> inventory;
        public Dictionary<string, object> quests;
        public Dictionary<string, object> relationships;
    }

    public sealed class AvatarWorldEventMessage
    {
        public string type = "world.event";
        public string gameID;
        public string saveSlotID;
        public string characterID;
        public object @event;
    }

    public sealed class AvatarWorldSensor : MonoBehaviour
    {
        public Transform observer;
        public Camera viewCamera;
        public LayerMask sensedLayers = ~0;
        public LayerMask occlusionLayers = ~0;
        [Range(1f, 50f)] public float radius = 15f;
        [Range(10f, 180f)] public float fieldOfView = 110f;
        [Range(1f, 10f)] public float updatesPerSecond = 4f;

        readonly Collider[] overlaps = new Collider[512];
        readonly Dictionary<string, string> hashes = new Dictionary<string, string>();
        float nextUpdate;
        long revision;
        bool sentSnapshot;

        public event Action<WorldSnapshot> SnapshotReady;
        public event Action<AvatarWorldDelta> DeltaReady;

        public string GameID { get; set; }
        public string SaveSlotID { get; set; }
        public string CharacterID { get; set; }
        public WorldSnapshot Latest { get; private set; }

        void Awake()
        {
            if (observer == null) observer = transform;
            if (viewCamera == null) viewCamera = Camera.main;
        }

        void Update()
        {
            if (Time.unscaledTime < nextUpdate) return;
            nextUpdate = Time.unscaledTime + 1f / Mathf.Max(1f, updatesPerSecond);
            Sample();
        }

        public void ForceSnapshot()
        {
            sentSnapshot = false;
            Sample();
        }

        public void RaiseEvent(string kind, string entityID, bool attention, Dictionary<string, object> data)
        {
            EventReady?.Invoke(new AvatarWorldEventMessage
            {
                gameID = GameID, saveSlotID = SaveSlotID, characterID = CharacterID,
                @event = new
                {
                    id = Guid.NewGuid().ToString("N"), kind = AvatarIDs.Normalize(kind, "event"), attention,
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), entityID, data = data ?? new Dictionary<string, object>(),
                },
            });
        }

        public event Action<AvatarWorldEventMessage> EventReady;

        void Sample()
        {
            var count = Physics.OverlapSphereNonAlloc(observer.position, radius, overlaps, sensedLayers, QueryTriggerInteraction.Collide);
            var entities = new Dictionary<string, WorldEntityState>();
            for (var index = 0; index < count && entities.Count < AvatarProtocol.MaxEntities; index++)
            {
                var source = overlaps[index].GetComponentInParent<OpenCodeWorldEntity>();
                if (source == null || entities.ContainsKey(source.StableID)) continue;
                var direction = source.transform.position - observer.position;
                var inField = Vector3.Angle(observer.forward, direction) <= fieldOfView * 0.5f;
                var ray = new Ray(observer.position, direction.normalized);
                var lineOfSight = inField && (!Physics.Raycast(ray, out var hit, direction.magnitude, occlusionLayers, QueryTriggerInteraction.Ignore) || hit.transform.IsChildOf(source.transform));
                entities[source.StableID] = new WorldEntityState
                {
                    id = source.StableID, kind = source.kind, label = string.IsNullOrWhiteSpace(source.label) ? source.name : source.label,
                    tags = source.tags, position = source.transform.position, distance = direction.magnitude, visible = lineOfSight,
                    state = source.State(), affordances = source.affordances,
                };
            }

            var provider = GetComponents<MonoBehaviour>().OfType<IAvatarWorldStateProvider>().FirstOrDefault();
            var snapshot = new WorldSnapshot
            {
                gameID = GameID, saveSlotID = SaveSlotID, characterID = CharacterID,
                revision = ++revision, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), entities = entities.Values.ToList(),
                inventory = provider?.InventoryState() ?? new Dictionary<string, object>(),
                quests = provider?.QuestState() ?? new Dictionary<string, object>(),
                relationships = provider?.RelationshipState() ?? new Dictionary<string, object>(),
            };
            Latest = snapshot;
            if (!sentSnapshot)
            {
                sentSnapshot = true;
                hashes.Clear();
                foreach (var entity in snapshot.entities) hashes[entity.id] = AvatarJson.Serialize(entity);
                SnapshotReady?.Invoke(snapshot);
                return;
            }

            var delta = new AvatarWorldDelta
            {
                gameID = GameID, saveSlotID = SaveSlotID, characterID = CharacterID,
                revision = snapshot.revision, timestamp = snapshot.timestamp,
                inventory = snapshot.inventory, quests = snapshot.quests, relationships = snapshot.relationships,
            };
            foreach (var entity in snapshot.entities)
            {
                var hash = AvatarJson.Serialize(entity);
                if (!hashes.TryGetValue(entity.id, out var previous) || previous != hash) delta.upsert.Add(entity);
                hashes[entity.id] = hash;
            }
            foreach (var removed in hashes.Keys.Except(entities.Keys).ToArray()) { delta.remove.Add(removed); hashes.Remove(removed); }
            // Empty deltas preserve the strictly increasing revision stream while keeping
            // sensing bounded to updatesPerSecond rather than coupling it to the VR frame loop.
            DeltaReady?.Invoke(delta);
        }
    }
}
