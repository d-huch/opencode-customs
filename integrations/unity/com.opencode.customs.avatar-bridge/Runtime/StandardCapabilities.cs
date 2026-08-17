using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.AI;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class MoveToCapability : AvatarCapabilityBehaviour
    {
        public NavMeshAgent agent;
        public float stoppingDistance = 0.6f;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "move_to", title = "Move to position", description = "Navigate to a reachable world position through NavMesh.",
            risk = "ambient", timeoutMs = 30000, cancellable = true,
            permissionCategory = "movement.navigate", postconditions = new[] { "character is within stopping distance of destination" },
            sideEffects = new[] { "character position changes" },
            parameters = ObjectSchema(new Dictionary<string, JObject> { ["position"] = VectorSchema("World-space destination") }, "position"),
            preconditions = new[] { "NavMeshAgent is enabled", "destination is on NavMesh" },
        };

        public override bool CheckPreconditions(JObject arguments, out string reason)
        {
            if (agent != null && agent.enabled && agent.isOnNavMesh) { reason = null; return true; }
            reason = "NavMeshAgent is unavailable or not placed on a NavMesh."; return false;
        }

        public override async Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var value = arguments["position"] as JObject;
            var target = new Vector3(value.Value<float>("x"), value.Value<float>("y"), value.Value<float>("z"));
            if (!NavMesh.SamplePosition(target, out var hit, 2f, agent.areaMask)) return AvatarActionResult.Failure("Destination is outside the NavMesh.");
            agent.stoppingDistance = stoppingDistance;
            if (!agent.SetDestination(hit.position)) return AvatarActionResult.Failure("NavMesh rejected the destination.");
            while (!cancellation.IsCancellationRequested && (agent.pathPending || agent.remainingDistance > agent.stoppingDistance)) await Task.Yield();
            cancellation.ThrowIfCancellationRequested();
            return AvatarActionResult.Success("Destination reached.");
        }

        public override void Cancel() { if (agent != null && agent.isOnNavMesh) agent.ResetPath(); }
    }

    public sealed class FollowCapability : AvatarCapabilityBehaviour
    {
        public NavMeshAgent agent;
        public Transform player;
        public float followDistance = 1.5f;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "follow", title = "Follow player", description = "Begin following the player using NavMesh.",
            risk = "ambient", cooldownMs = 500, timeoutMs = 5000, cancellable = true,
            permissionCategory = "movement.follow", postconditions = new[] { "follow navigation is active" },
            sideEffects = new[] { "character continues moving until cancelled" },
            parameters = ObjectSchema(new Dictionary<string, JObject>()),
            preconditions = new[] { "player target exists", "NavMeshAgent is enabled" },
        };

        public override bool CheckPreconditions(JObject arguments, out string reason)
        {
            if (agent != null && agent.enabled && agent.isOnNavMesh && player != null) { reason = null; return true; }
            reason = "Player or NavMeshAgent is unavailable."; return false;
        }

        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            agent.stoppingDistance = followDistance;
            agent.SetDestination(player.position);
            return Task.FromResult(AvatarActionResult.Success("Following player."));
        }

        void Update()
        {
            if (agent != null && player != null && agent.enabled && agent.isOnNavMesh && agent.hasPath) agent.SetDestination(player.position);
        }
        public override void Cancel() { if (agent != null && agent.isOnNavMesh) agent.ResetPath(); }
    }

    public sealed class PatrolCapability : AvatarCapabilityBehaviour
    {
        public NavMeshAgent agent;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "patrol", title = "Patrol route", description = "Visit a bounded list of NavMesh positions in order.",
            risk = "ambient", timeoutMs = 60000, cancellable = true,
            permissionCategory = "movement.patrol", postconditions = new[] { "all reachable patrol points were visited" },
            sideEffects = new[] { "character position changes" },
            parameters = ObjectSchema(new Dictionary<string, JObject>
            {
                ["points"] = new JObject { ["type"] = "array", ["items"] = VectorSchema("World-space patrol point"), ["maxItems"] = 8 },
            }, "points"),
            preconditions = new[] { "NavMeshAgent is enabled", "route has at most eight reachable points" },
        };

        public override bool CheckPreconditions(JObject arguments, out string reason)
        {
            var points = arguments["points"] as JArray;
            if (agent != null && agent.enabled && agent.isOnNavMesh && points != null && points.Count > 0 && points.Count <= 8)
            { reason = null; return true; }
            reason = "Patrol requires an active NavMeshAgent and one to eight points."; return false;
        }

        public override async Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            foreach (var token in (JArray)arguments["points"])
            {
                var point = (JObject)token;
                var target = new Vector3(point.Value<float>("x"), point.Value<float>("y"), point.Value<float>("z"));
                if (!NavMesh.SamplePosition(target, out var hit, 2f, agent.areaMask)) return AvatarActionResult.Failure("A patrol point is outside the NavMesh.");
                agent.SetDestination(hit.position);
                while (!cancellation.IsCancellationRequested && (agent.pathPending || agent.remainingDistance > agent.stoppingDistance)) await Task.Yield();
                cancellation.ThrowIfCancellationRequested();
            }
            return AvatarActionResult.Success("Patrol route completed.");
        }

        public override void Cancel() { if (agent != null && agent.isOnNavMesh) agent.ResetPath(); }
    }

    public sealed class StayCapability : AvatarCapabilityBehaviour
    {
        public NavMeshAgent agent;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "stay", title = "Stay", description = "Stop navigation and remain in place.", risk = "ambient",
            permissionCategory = "movement.stay", postconditions = new[] { "active navigation path is cleared" },
            parameters = ObjectSchema(new Dictionary<string, JObject>()),
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            if (agent != null && agent.isOnNavMesh) agent.ResetPath();
            return Task.FromResult(AvatarActionResult.Success("Staying in place."));
        }
    }

    public sealed class CharacterExpressionCapability : AvatarCapabilityBehaviour
    {
        public Animator animator;
        public Transform lookRoot;
        public AvatarRigTargets rigTargets;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "express", title = "Look, gesture, or emote", description = "Perform a local character expression.", risk = "ambient",
            permissionCategory = "expression.local", postconditions = new[] { "requested rig target or animation trigger is applied" },
            parameters = ObjectSchema(new Dictionary<string, JObject>
            {
                ["kind"] = StringSchema("look_at, point_at, gesture, or emotion"),
                ["name"] = StringSchema("Animator trigger or emotion name"),
                ["target"] = VectorSchema("Optional world-space target"),
                ["intensity"] = NumberSchema("Expression intensity from 0 to 1"),
                ["leftHand"] = BooleanSchema("Use the left hand for pointing"),
            }, "kind"),
        };
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
            if (!string.IsNullOrWhiteSpace(name) && animator != null) animator.SetTrigger(name);
            return Task.FromResult(AvatarActionResult.Success("Expression applied."));
        }
    }

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
            reason = null; return true;
        }

        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var target = Find(arguments.Value<string>("entityID"));
            return target.InteractAsync(arguments.Value<string>("affordance"), arguments, cancellation);
        }

        static OpenCodeInteractable Find(string id)
        {
            foreach (var candidate in FindObjectsByType<OpenCodeInteractable>(FindObjectsSortMode.None))
                if (candidate.StableID == id) return candidate;
            return null;
        }
    }
}
