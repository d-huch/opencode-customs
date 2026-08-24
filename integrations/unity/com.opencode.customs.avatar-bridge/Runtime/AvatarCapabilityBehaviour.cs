using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
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
}
