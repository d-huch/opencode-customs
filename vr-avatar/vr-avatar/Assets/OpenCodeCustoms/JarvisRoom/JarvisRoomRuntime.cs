using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using OpenCode.Customs.AvatarBridge;
using UnityEngine;

namespace OpenCode.Customs.QuestAlpha
{
    [Serializable]
    public sealed class JarvisRoomSave
    {
        public List<string> inventory = new List<string>();
        public string quest = "find_key";
        public float technicianTrust;
        public bool doorOpen;
        public bool targetDisabled;
    }

    public sealed class JarvisRoomWorld : MonoBehaviour, IAvatarWorldStateProvider
    {
        public string saveSlotID = "quest-alpha";
        public AvatarWorldSensor sensor;
        public JarvisRoomSave state = new JarvisRoomSave();
        string SaveKey => "OpenCode.Customs.QuestAlpha." + saveSlotID;

        void Awake()
        {
            if (sensor == null) sensor = GetComponent<AvatarWorldSensor>();
            if (PlayerPrefs.HasKey(SaveKey))
                state = JsonUtility.FromJson<JarvisRoomSave>(PlayerPrefs.GetString(SaveKey)) ?? new JarvisRoomSave();
            Refresh();
        }

        public Dictionary<string, object> InventoryState() => new Dictionary<string, object> { ["items"] = state.inventory.ToArray() };
        public Dictionary<string, object> QuestState() => new Dictionary<string, object> { ["jarvis_room"] = state.quest };
        public Dictionary<string, object> RelationshipState() => new Dictionary<string, object> { ["technician"] = state.technicianTrust };
        public bool Has(string item) => state.inventory.Contains(item);

        public bool PickUp(string item)
        {
            if (Has(item)) return false;
            state.inventory.Add(item);
            if (item == "lab_key" && state.quest == "find_key") state.quest = "open_door";
            Changed("inventory.pick_up", item, 0.7f);
            return true;
        }

        public bool Drop(string item)
        {
            if (!state.inventory.Remove(item)) return false;
            Changed("inventory.drop", item, 0.4f);
            return true;
        }

        public bool OpenDoor()
        {
            if (!Has("lab_key")) return false;
            state.doorOpen = true;
            if (state.quest == "open_door") state.quest = "deliver_core";
            Changed("world.door", "lab_door", 0.85f);
            return true;
        }

        public bool GiveCore()
        {
            if (!state.inventory.Remove("energy_core")) return false;
            state.technicianTrust = Mathf.Clamp01(state.technicianTrust + 0.4f);
            state.quest = "complete";
            Changed("quest.complete", "technician", 1f);
            return true;
        }

        public bool DisableTarget()
        {
            if (state.targetDisabled) return false;
            state.targetDisabled = true;
            Changed("training.target", "training_target", 0.8f);
            return true;
        }

        void Changed(string kind, string entityID, float importance)
        {
            PlayerPrefs.SetString(SaveKey, JsonUtility.ToJson(state));
            PlayerPrefs.Save();
            Refresh();
            sensor?.RaiseEvent(kind, entityID, true, new Dictionary<string, object>
            {
                ["importance"] = importance,
                ["confidence"] = 1f,
                ["topic"] = kind + ":" + entityID,
            });
            sensor?.ForceSnapshot();
        }

        void Refresh()
        {
            foreach (var entity in FindObjectsByType<JarvisRoomEntity>(FindObjectsInactive.Include))
            {
                entity.gameObject.SetActive(string.IsNullOrWhiteSpace(entity.itemID) || !Has(entity.itemID));
                entity.Refresh();
            }
        }
    }

    public sealed class JarvisRoomEntity : MonoBehaviour
    {
        public string entityID;
        public string itemID;
        public OpenCodeWorldEntity semantic;
        public JarvisRoomWorld world;

        public void Refresh()
        {
            if (semantic == null) semantic = GetComponent<OpenCodeWorldEntity>();
            if (world == null) world = FindAnyObjectByType<JarvisRoomWorld>();
            if (semantic == null || world == null) return;
            semantic.stateJson = new JObject
            {
                ["inInventory"] = !string.IsNullOrWhiteSpace(itemID) && world.Has(itemID),
                ["open"] = entityID == "lab_door" && world.state.doorOpen,
                ["disabled"] = entityID == "training_target" && world.state.targetDisabled,
            }.ToString(Newtonsoft.Json.Formatting.None);
        }
    }

    public enum JarvisRoomAction { Inspect, PickUp, Drop, Use, OpenDoor, GiveCore, DisableTarget }

    public sealed class JarvisRoomCapability : AvatarCapabilityBehaviour
    {
        public JarvisRoomAction action;
        public JarvisRoomWorld world;
        public Transform door;
        JarvisRoomWorld World => world != null ? world : world = FindAnyObjectByType<JarvisRoomWorld>();

        public override AvatarCapabilityManifest Manifest
        {
            get
            {
                var id = action switch
                {
                    JarvisRoomAction.Inspect => "item.inspect",
                    JarvisRoomAction.PickUp => "item.pick_up",
                    JarvisRoomAction.Drop => "item.drop",
                    JarvisRoomAction.Use => "item.use",
                    JarvisRoomAction.OpenDoor => "door.open",
                    JarvisRoomAction.GiveCore => "npc.give_item",
                    _ => "training.attack",
                };
                var critical = action == JarvisRoomAction.DisableTarget;
                var entityArgument = action == JarvisRoomAction.Inspect || action == JarvisRoomAction.PickUp;
                return new AvatarCapabilityManifest
                {
                    id = id,
                    title = action.ToString(),
                    description = "Typed Jarvis Room action: " + action,
                    risk = critical ? "critical" : action == JarvisRoomAction.Inspect ? "ambient" : "interaction",
                    permissionCategory = critical ? "combat.training" : id,
                    parameters = ObjectSchema(entityArgument
                        ? new Dictionary<string, JObject> { ["entityID"] = StringSchema("Stable entity ID from game_observe") }
                        : new Dictionary<string, JObject> { ["itemID"] = StringSchema("Inventory item ID when applicable") }),
                    cancellable = !critical,
                    postconditions = new[] { "world snapshot reflects the completed action" },
                    sideEffects = critical ? new[] { "persistent training state changes" } : new[] { "inventory or world state may change" },
                };
            }
        }

        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var entityID = arguments.Value<string>("entityID");
            var itemID = arguments.Value<string>("itemID");
            var entity = Array.Find(FindObjectsByType<JarvisRoomEntity>(FindObjectsInactive.Include), value => value.entityID == entityID);
            var result = action switch
            {
                JarvisRoomAction.Inspect => entity != null,
                JarvisRoomAction.PickUp => entity != null && !string.IsNullOrWhiteSpace(entity.itemID) && World.PickUp(entity.itemID),
                JarvisRoomAction.Drop => World.Drop(itemID),
                JarvisRoomAction.Use => World.Has(itemID),
                JarvisRoomAction.OpenDoor => World.OpenDoor(),
                JarvisRoomAction.GiveCore => World.GiveCore(),
                _ => World.DisableTarget(),
            };
            if (result && action == JarvisRoomAction.OpenDoor && door != null) door.localRotation = Quaternion.Euler(0f, 90f, 0f);
            return Task.FromResult(result
                ? AvatarActionResult.Success(action + " completed", entityID)
                : AvatarActionResult.Failure(action + " preconditions were not met", "precondition_failed"));
        }
    }
}
