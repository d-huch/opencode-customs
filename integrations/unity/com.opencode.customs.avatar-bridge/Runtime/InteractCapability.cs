using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class InteractCapability : AvatarCapabilityBehaviour
    {
        public float maximumDistance = 2.5f;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "interact", title = "Interact with world object", description = "Inspect, pick up, drop, use, open, close, or sit through a registered interactable.",
            risk = "interaction", timeoutMs = 15000, cancellable = true,
            permissionCategory = "world.interact", postconditions = new[] { "target reports the interaction result" },
            sideEffects = new[] { "target state or inventory may change" },
            parameters = ObjectSchema(new Dictionary<string, JObject>
            {
                ["entityID"] = StringSchema("Stable entity ID from game_observe"),
                ["affordance"] = StringSchema("Exact interaction exposed by the entity"),
            }, "entityID", "affordance"),
            preconditions = new[] { "entity is visible or known", "affordance is exposed", "entity is within interaction distance" },
        };

        public override bool CheckPreconditions(JObject arguments, out string reason)
        {
            var target = Find(arguments.Value<string>("entityID"));
            if (target == null) { reason = "Interactable entity was not found."; return false; }
            if (Vector3.Distance(transform.position, target.transform.position) > maximumDistance) { reason = "Interactable is out of range."; return false; }
            var affordance = arguments.Value<string>("affordance");
            if (!target.Affordances.Contains(affordance)) { reason = "Entity does not expose that affordance."; return false; }
            reason = null;
            return true;
        }

        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var target = Find(arguments.Value<string>("entityID"));
            return target.InteractAsync(arguments.Value<string>("affordance"), arguments, cancellation);
        }

        static OpenCodeInteractable Find(string id)
        {
            foreach (var candidate in FindObjectsByType<OpenCodeInteractable>())
                if (candidate.StableID == id) return candidate;
            return null;
        }
    }
}
