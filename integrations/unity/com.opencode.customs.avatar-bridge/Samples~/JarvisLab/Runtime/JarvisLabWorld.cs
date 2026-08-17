using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge.JarvisLab
{
    [Serializable]
    public sealed class JarvisLabSave
    {
        public List<string> inventory = new List<string>();
        public string questStage = "find_key";
        public float npcTrust;
        public bool doorOpen;
        public bool targetDisabled;
    }

    public sealed class JarvisLabWorld : MonoBehaviour, IAvatarWorldStateProvider
    {
        public string saveSlotID = "slot-1";
        public AvatarWorldSensor sensor;
        public JarvisLabSave state = new JarvisLabSave();

        string SaveKey => "OpenCode.Customs.JarvisLab." + saveSlotID;

        void Awake()
        {
            if (sensor == null) sensor = GetComponent<AvatarWorldSensor>();
            Load();
        }

        public Dictionary<string, object> InventoryState() => new Dictionary<string, object>
        {
            ["items"] = state.inventory.ToArray(),
        };

        public Dictionary<string, object> QuestState() => new Dictionary<string, object>
        {
            ["lab_delivery"] = new Dictionary<string, object>
            {
                ["stage"] = state.questStage,
                ["complete"] = state.questStage == "complete",
            },
        };

        public Dictionary<string, object> RelationshipState() => new Dictionary<string, object>
        {
            ["technician"] = new Dictionary<string, object> { ["trust"] = state.npcTrust },
        };

        public bool Has(string itemID) => state.inventory.Contains(itemID);

        public bool PickUp(string itemID)
        {
            if (Has(itemID)) return false;
            state.inventory.Add(itemID);
            if (itemID == "lab_key" && state.questStage == "find_key") state.questStage = "open_door";
            Changed("inventory.pick_up", itemID, 0.7f, "Picked up " + itemID);
            return true;
        }

        public bool Drop(string itemID)
        {
            if (!state.inventory.Remove(itemID)) return false;
            Changed("inventory.drop", itemID, 0.4f, "Dropped " + itemID);
            return true;
        }

        public bool Craft(string first, string second, string result)
        {
            if (!Has(first) || !Has(second)) return false;
            state.inventory.Remove(first); state.inventory.Remove(second); state.inventory.Add(result);
            Changed("inventory.craft", result, 0.7f, "Crafted " + result);
            return true;
        }

        public bool Use(string itemID)
        {
            if (!Has(itemID)) return false;
            Changed("inventory.use", itemID, 0.55f, "Used " + itemID);
            return true;
        }

        public void OpenDoor()
        {
            state.doorOpen = true;
            if (state.questStage == "open_door") state.questStage = "deliver_cell";
            Changed("world.door", "lab_door", 0.8f, "Opened the lab door");
        }

        public bool GiveToTechnician(string itemID)
        {
            if (!state.inventory.Remove(itemID)) return false;
            state.npcTrust = Mathf.Clamp01(state.npcTrust + 0.35f);
            if (itemID == "power_cell" && state.questStage == "deliver_cell") state.questStage = "complete";
            Changed("quest.relationship", "technician", 0.95f, "Delivered " + itemID + " to the technician");
            return true;
        }

        public void DisableTarget()
        {
            state.targetDisabled = true;
            Changed("world.training", "training_target", 0.8f, "Disabled the training target");
        }

        public void Save()
        {
            PlayerPrefs.SetString(SaveKey, JsonConvert.SerializeObject(state));
            PlayerPrefs.Save();
        }

        public void Load()
        {
            if (!PlayerPrefs.HasKey(SaveKey)) return;
            state = JsonConvert.DeserializeObject<JarvisLabSave>(PlayerPrefs.GetString(SaveKey)) ?? new JarvisLabSave();
        }

        public void ResetSlot()
        {
            PlayerPrefs.DeleteKey(SaveKey);
            state = new JarvisLabSave();
        }

        void Changed(string kind, string entityID, float importance, string summary)
        {
            Save();
            foreach (var entity in FindObjectsByType<JarvisLabEntity>(FindObjectsInactive.Include, FindObjectsSortMode.None)) entity.Refresh();
            sensor?.RaiseEvent(kind, entityID, true, new Dictionary<string, object>
            {
                ["summary"] = summary,
                ["importance"] = importance,
                ["confidence"] = 1f,
                ["topic"] = kind + ":" + entityID,
            });
            sensor?.ForceSnapshot();
        }
    }

    public sealed class JarvisLabEntity : MonoBehaviour
    {
        public string entityID;
        public string itemID;
        public JarvisLabWorld world;
        public OpenCodeWorldEntity semantic;

        public void Refresh()
        {
            if (semantic == null) semantic = GetComponent<OpenCodeWorldEntity>();
            if (world == null) world = FindFirstObjectByType<JarvisLabWorld>();
            if (semantic == null || world == null) return;
            semantic.stateJson = JsonConvert.SerializeObject(new
            {
                inInventory = !string.IsNullOrWhiteSpace(itemID) && world.Has(itemID),
                open = entityID == "lab_door" && world.state.doorOpen,
                disabled = entityID == "training_target" && world.state.targetDisabled,
            });
        }
    }
}
