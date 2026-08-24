using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using OpenCode.Customs.AvatarBridge;
using UnityEngine;

namespace OpenCode.Customs.QuestAlpha
{
    public sealed class JarvisRoomCapability : AvatarCapabilityBehaviour
    {
        public JarvisRoomAction action;
        public JarvisRoomWorld world;
        public Transform door;
        JarvisRoomWorld World => world != null ? world : world = FindAnyObjectByType<JarvisRoomWorld>();

        public override AvatarCapabilityManifest Manifest
        {
            get
            {
                var id = action switch
                {
                    JarvisRoomAction.Inspect => "item.inspect",
                    JarvisRoomAction.PickUp => "item.pick_up",
                    JarvisRoomAction.Drop => "item.drop",
                    JarvisRoomAction.Use => "item.use",
                    JarvisRoomAction.OpenDoor => "door.open",
                    JarvisRoomAction.GiveCore => "npc.give_item",
                    _ => "training.attack",
                };
                var critical = action == JarvisRoomAction.DisableTarget;
                var entityArgument = action == JarvisRoomAction.Inspect || action == JarvisRoomAction.PickUp;
                return new AvatarCapabilityManifest
                {
                    id = id,
                    title = action.ToString(),
                    description = "Typed Jarvis Room action: " + action,
                    risk = critical ? "critical" : action == JarvisRoomAction.Inspect ? "ambient" : "interaction",
                    permissionCategory = critical ? "combat.training" : id,
                    parameters = ObjectSchema(entityArgument
                        ? new Dictionary<string, JObject> { ["entityID"] = StringSchema("Stable entity ID from game_observe") }
                        : new Dictionary<string, JObject> { ["itemID"] = StringSchema("Inventory item ID when applicable") }),
                    cancellable = !critical,
                    postconditions = new[] { "world snapshot reflects the completed action" },
                    sideEffects = critical ? new[] { "persistent training state changes" } : new[] { "inventory or world state may change" },
                };
            }
        }

        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var entityID = arguments.Value<string>("entityID");
            var itemID = arguments.Value<string>("itemID");
            var entity = Array.Find(FindObjectsByType<JarvisRoomEntity>(FindObjectsInactive.Include), value => value.entityID == entityID);
            var result = action switch
            {
                JarvisRoomAction.Inspect => entity != null,
                JarvisRoomAction.PickUp => entity != null && !string.IsNullOrWhiteSpace(entity.itemID) && World.PickUp(entity.itemID),
                JarvisRoomAction.Drop => World.Drop(itemID),
                JarvisRoomAction.Use => World.Has(itemID),
                JarvisRoomAction.OpenDoor => World.OpenDoor(),
                JarvisRoomAction.GiveCore => World.GiveCore(),
                _ => World.DisableTarget(),
            };
            if (result && action == JarvisRoomAction.OpenDoor && door != null) door.localRotation = Quaternion.Euler(0f, 90f, 0f);
            return Task.FromResult(result
                ? AvatarActionResult.Success(action + " completed", entityID)
                : AvatarActionResult.Failure(action + " preconditions were not met", "precondition_failed"));
        }
    }
}
