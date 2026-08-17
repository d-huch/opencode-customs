using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public interface IAvatarCapability
    {
        AvatarCapabilityManifest Manifest { get; }
        bool CheckPreconditions(JObject arguments, out string reason);
        Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation);
        void Cancel();
    }

    public abstract class AvatarCapabilityBehaviour : MonoBehaviour, IAvatarCapability
    {
        public abstract AvatarCapabilityManifest Manifest { get; }
        public virtual bool CheckPreconditions(JObject arguments, out string reason) { reason = null; return isActiveAndEnabled; }
        public abstract Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation);
        public virtual void Cancel() { }

        protected static JObject ObjectSchema(Dictionary<string, JObject> properties, params string[] required)
        {
            var schemaProperties = new JObject();
            foreach (var property in properties) schemaProperties[property.Key] = property.Value;
            return new JObject
            {
                ["type"] = "object",
                ["properties"] = schemaProperties,
                ["required"] = new JArray(required),
                ["additionalProperties"] = false,
            };
        }

        protected static JObject StringSchema(string description) => new JObject { ["type"] = "string", ["description"] = description };
        protected static JObject NumberSchema(string description) => new JObject { ["type"] = "number", ["description"] = description };
        protected static JObject BooleanSchema(string description) => new JObject { ["type"] = "boolean", ["description"] = description };
        protected static JObject VectorSchema(string description) => new JObject
        {
            ["type"] = "object",
            ["description"] = description,
            ["properties"] = new JObject
            {
                ["x"] = new JObject { ["type"] = "number" },
                ["y"] = new JObject { ["type"] = "number" },
                ["z"] = new JObject { ["type"] = "number" },
            },
            ["required"] = new JArray("x", "y", "z"),
        };
    }

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

    public abstract class OpenCodeInteractable : MonoBehaviour
    {
        [SerializeField] string stableID;
        [SerializeField] string[] affordances = { "inspect", "use" };
        public string StableID => AvatarIDs.Normalize(stableID, gameObject.scene.name + ":" + gameObject.name);
        public IReadOnlyList<string> Affordances => affordances;
        public abstract Task<AvatarActionResult> InteractAsync(string affordance, JObject arguments, CancellationToken cancellation);
    }
}
