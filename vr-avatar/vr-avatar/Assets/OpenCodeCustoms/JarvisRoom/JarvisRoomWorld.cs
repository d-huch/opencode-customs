using System.Collections.Generic;
using OpenCode.Customs.AvatarBridge;
using UnityEngine;

namespace OpenCode.Customs.QuestAlpha
{
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
}
