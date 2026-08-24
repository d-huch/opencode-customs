using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.AI;

namespace OpenCode.Customs.AvatarBridge
{
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
            reason = "Patrol requires an active NavMeshAgent and one to eight points.";
            return false;
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
}
