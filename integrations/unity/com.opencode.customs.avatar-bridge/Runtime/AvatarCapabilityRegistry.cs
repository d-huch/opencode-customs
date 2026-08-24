using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class AvatarCapabilityRegistry : MonoBehaviour
    {
        readonly Dictionary<string, IAvatarCapability> capabilities = new Dictionary<string, IAvatarCapability>();
        public int Revision { get; private set; }
        public IReadOnlyCollection<IAvatarCapability> All => capabilities.Values;

        void Awake() => Refresh();

        public void Refresh()
        {
            capabilities.Clear();
            foreach (var behaviour in GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (!(behaviour is IAvatarCapability capability) || string.IsNullOrWhiteSpace(capability.Manifest.id)) continue;
                if (capabilities.ContainsKey(capability.Manifest.id))
                    throw new InvalidOperationException("Duplicate Avatar capability ID: " + capability.Manifest.id);
                capabilities.Add(capability.Manifest.id, capability);
            }
            if (capabilities.Count > AvatarProtocol.MaxCapabilities)
                throw new InvalidOperationException("Avatar capability limit exceeded.");
            Revision++;
        }

        public bool TryGet(string id, out IAvatarCapability capability) => capabilities.TryGetValue(id, out capability);
        public AvatarCapabilityManifest[] Manifests() => capabilities.Values.Select(value =>
        {
            var manifest = value.Manifest;
            if (string.IsNullOrWhiteSpace(manifest.permissionCategory)) manifest.permissionCategory = manifest.id;
            return manifest;
        }).ToArray();
    }
}
