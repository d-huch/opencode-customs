using System.Collections.Generic;
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
            reason = "NavMeshAgent is unavailable or not placed on a NavMesh.";
            return false;
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
}
