using System;
using System.Collections.Generic;

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
}
