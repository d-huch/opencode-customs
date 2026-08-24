using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class CharacterExpressionCapability : AvatarCapabilityBehaviour
    {
        public Animator animator;
        public AvatarMicroReactions reactions;
        public AvatarVRMPresentation presentation;
        public Transform lookRoot;
        public AvatarRigTargets rigTargets;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "express", title = "Look, gesture, or emote", description = "Perform a local character expression.", risk = "ambient",
            permissionCategory = "expression.local", postconditions = new[] { "requested rig target or animation trigger is applied" },
            parameters = ObjectSchema(new Dictionary<string, JObject>
            {
                ["kind"] = new JObject { ["type"] = "string", ["enum"] = new JArray("look_at", "point_at", "gesture", "emotion") },
                ["name"] = new JObject
                {
                    ["type"] = "string",
                    ["description"] = "A supported gesture name or neutral, positive, concerned, or thoughtful for emotions.",
                    ["examples"] = JArray.FromObject(AvatarMicroReactions.SupportedGestures),
                },
                ["target"] = VectorSchema("Optional world-space target"),
                ["intensity"] = NumberSchema("Expression intensity from 0 to 1"),
                ["leftHand"] = BooleanSchema("Use the left hand for pointing"),
            }, "kind"),
        };

        public override bool CheckPreconditions(JObject arguments, out string reason)
        {
            var kind = arguments.Value<string>("kind");
            if ((kind == "look_at" || kind == "point_at") && !(arguments["target"] is JObject))
            {
                reason = kind + " requires a world-space target.";
                return false;
            }
            if ((kind == "look_at" || kind == "point_at") && rigTargets == null && lookRoot == null)
            {
                reason = "Character rig targets are unavailable.";
                return false;
            }
            if (kind == "gesture" && !AvatarMicroReactions.SupportsGesture(arguments.Value<string>("name")))
            {
                reason = "Unsupported gesture. Supported names: " + string.Join(", ", AvatarMicroReactions.SupportedGestures) + ".";
                return false;
            }
            if (kind == "emotion" && !AllowedEmotion(arguments.Value<string>("name")))
            {
                reason = "Unsupported emotion. Use neutral, positive, concerned, or thoughtful.";
                return false;
            }
            if (kind == "look_at" || kind == "point_at" || kind == "gesture" || kind == "emotion")
            {
                reason = null;
                return true;
            }
            reason = "Unsupported expression kind.";
            return false;
        }

        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var kind = arguments.Value<string>("kind");
            var target = arguments["target"] as JObject;
            if ((kind == "look_at" || kind == "point_at") && target != null)
            {
                var position = new Vector3(target.Value<float>("x"), target.Value<float>("y"), target.Value<float>("z"));
                if (kind == "point_at") rigTargets?.PointAt(position, arguments.Value<bool?>("leftHand") ?? false);
                else if (rigTargets != null) rigTargets.LookAt(position);
                else if (lookRoot != null) lookRoot.LookAt(position);
            }
            var name = arguments.Value<string>("name");
            if (kind == "point_at") reactions?.TriggerGesture("point");
            if (kind == "gesture")
            {
                if (reactions != null) reactions.TriggerGesture(name);
                else if (animator != null) animator.SetTrigger(char.ToUpperInvariant(name[0]) + name.Substring(1).ToLowerInvariant());
            }
            if (kind == "emotion") presentation?.SetEmotion(name, Mathf.Clamp01(arguments.Value<float?>("intensity") ?? 0.6f));
            return Task.FromResult(AvatarActionResult.Success("Expression applied."));
        }

        public override void Cancel()
        {
            rigTargets?.ResetOverrides();
            reactions?.ClearGesture();
        }

        static bool AllowedEmotion(string value) =>
            string.Equals(value, "neutral", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "positive", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "concerned", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "thoughtful", StringComparison.OrdinalIgnoreCase);
    }
}
