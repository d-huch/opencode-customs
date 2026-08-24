using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.AI;

namespace OpenCode.Customs.AvatarBridge
{
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
}
