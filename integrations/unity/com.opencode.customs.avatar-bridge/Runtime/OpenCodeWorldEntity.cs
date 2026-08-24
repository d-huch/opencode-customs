using System;
using System.Collections.Generic;
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
}
