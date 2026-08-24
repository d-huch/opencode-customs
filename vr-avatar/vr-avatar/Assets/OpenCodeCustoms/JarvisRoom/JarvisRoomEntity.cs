using Newtonsoft.Json.Linq;
using OpenCode.Customs.AvatarBridge;
using UnityEngine;

namespace OpenCode.Customs.QuestAlpha
{
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
}
