using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace EmbodiedAgent.Unity
{
    public sealed class AvatarCapabilityRegistry : MonoBehaviour
    {
        readonly Dictionary<string, IAvatarCapability> capabilities = new Dictionary<string, IAvatarCapability>();
        public int Revision { get; private set; }
        public IReadOnlyCollection<IAvatarCapability> All => capabilities.Values;
        public event Action<string, AvatarActionResult> ActionCompleted;
        public event Action<GameActionRequest, AvatarActionResult> ActionExecuted;

        void Awake() => Refresh();

        public void Refresh()
        {
            capabilities.Clear();
            foreach (var behaviour in GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (!(behaviour is IAvatarCapability capability) || string.IsNullOrWhiteSpace(capability.Manifest.id)) continue;
                if (capabilities.ContainsKey(capability.Manifest.id))
                    throw new InvalidOperationException("Duplicate Embodied Agent capability ID: " + capability.Manifest.id);
                capabilities.Add(capability.Manifest.id, capability);
            }
            if (capabilities.Count > AvatarProtocol.MaxCapabilities)
                throw new InvalidOperationException("Embodied Agent capability limit exceeded.");
            Revision++;
        }

        public bool TryGet(string id, out IAvatarCapability capability) => capabilities.TryGetValue(id, out capability);
        public void ReportResult(string id, AvatarActionResult result) => ActionCompleted?.Invoke(id, result);
        public void ReportResult(GameActionRequest request, AvatarActionResult result)
        {
            ActionCompleted?.Invoke(request.actionID, result);
            ActionExecuted?.Invoke(request, result);
        }
        public AvatarCapabilityManifest[] Manifests() => capabilities.Values.Select(value => value.Manifest).ToArray();
    }
}
