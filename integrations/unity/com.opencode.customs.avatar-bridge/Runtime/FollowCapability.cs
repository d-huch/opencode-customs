using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.AI;

namespace OpenCode.Customs.AvatarBridge
{
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
            reason = "Player or NavMeshAgent is unavailable.";
            return false;
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
}
