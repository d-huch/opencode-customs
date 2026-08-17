using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge.JarvisLab
{
    public abstract class JarvisLabCapability : AvatarCapabilityBehaviour
    {
        public JarvisLabWorld world;

        protected JarvisLabWorld World => world != null ? world : world = FindFirstObjectByType<JarvisLabWorld>();
        protected JarvisLabEntity FindEntity(string entityID)
        {
            foreach (var entity in FindObjectsByType<JarvisLabEntity>(FindObjectsSortMode.None))
                if (entity.entityID == entityID) return entity;
            return null;
        }

        protected static JObject EntitySchema(params KeyValuePair<string, JObject>[] extra)
        {
            var properties = new Dictionary<string, JObject> { ["entityID"] = StringSchema("Stable entity ID from game_observe") };
            foreach (var property in extra) properties[property.Key] = property.Value;
            return ObjectSchema(properties, "entityID");
        }
    }

    public sealed class InspectLabEntityCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "item.inspect", title = "Inspect lab entity", description = "Inspect one known lab entity without changing it.",
            risk = "ambient", permissionCategory = "world.inspect", parameters = EntitySchema(),
            postconditions = new[] { "entity remains unchanged" }, sideEffects = new string[0],
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var entity = FindEntity(arguments.Value<string>("entityID"));
            if (entity == null) return Task.FromResult(AvatarActionResult.Failure("Entity was not found.", "not_found"));
            entity.Refresh();
            return Task.FromResult(AvatarActionResult.Success("Inspected " + entity.entityID, entity.entityID));
        }
    }

    public sealed class PickUpLabItemCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "item.pick_up", title = "Pick up item", description = "Put a portable lab item into inventory.",
            risk = "interaction", permissionCategory = "inventory.pick_up", parameters = EntitySchema(),
            preconditions = new[] { "entity exists", "entity is portable", "item is not already held" },
            postconditions = new[] { "item is present in inventory" }, sideEffects = new[] { "item leaves the world surface" },
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var entity = FindEntity(arguments.Value<string>("entityID"));
            if (entity == null || string.IsNullOrWhiteSpace(entity.itemID)) return Task.FromResult(AvatarActionResult.Failure("Portable item was not found.", "not_found"));
            if (!World.PickUp(entity.itemID)) return Task.FromResult(AvatarActionResult.Failure("Item is already held.", "already_applied"));
            entity.gameObject.SetActive(false);
            return Task.FromResult(AvatarActionResult.Success("Picked up " + entity.itemID, entity.entityID));
        }
    }

    public sealed class DropLabItemCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "item.drop", title = "Drop item", description = "Remove an item from inventory and place it near the companion.",
            risk = "interaction", permissionCategory = "inventory.drop",
            parameters = ObjectSchema(new Dictionary<string, JObject> { ["itemID"] = StringSchema("Exact inventory item ID") }, "itemID"),
            preconditions = new[] { "item is in inventory" }, postconditions = new[] { "item is absent from inventory" },
            sideEffects = new[] { "item returns to the scene" },
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            var itemID = arguments.Value<string>("itemID");
            if (!World.Drop(itemID)) return Task.FromResult(AvatarActionResult.Failure("Item is not in inventory.", "precondition_failed"));
            foreach (var entity in FindObjectsByType<JarvisLabEntity>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                if (entity.itemID == itemID) { entity.gameObject.SetActive(true); entity.transform.position = transform.position + transform.forward; entity.Refresh(); return Task.FromResult(AvatarActionResult.Success("Dropped " + itemID, entity.entityID)); }
            return Task.FromResult(AvatarActionResult.Success("Removed " + itemID + " from inventory"));
        }
    }

    public sealed class CraftLabItemCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "item.craft", title = "Craft power cell", description = "Combine the lab casing and energy core into a power cell.",
            risk = "interaction", permissionCategory = "inventory.craft",
            parameters = ObjectSchema(new Dictionary<string, JObject>()),
            preconditions = new[] { "inventory contains casing", "inventory contains energy_core" },
            postconditions = new[] { "inventory contains power_cell" }, sideEffects = new[] { "ingredients are consumed" },
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation) => Task.FromResult(
            World.Craft("casing", "energy_core", "power_cell")
                ? AvatarActionResult.Success("Crafted power cell")
                : AvatarActionResult.Failure("Required ingredients are missing.", "precondition_failed"));
    }

    public sealed class UseLabItemCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "item.use", title = "Use inventory item", description = "Use one held lab item without inventing a target interaction.",
            risk = "interaction", permissionCategory = "inventory.use",
            parameters = ObjectSchema(new Dictionary<string, JObject> { ["itemID"] = StringSchema("Exact inventory item ID") }, "itemID"),
            preconditions = new[] { "item is in inventory" }, postconditions = new[] { "item use is recorded" },
            sideEffects = new[] { "item-specific state may change" },
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation) => Task.FromResult(
            World.Use(arguments.Value<string>("itemID"))
                ? AvatarActionResult.Success("Used " + arguments.Value<string>("itemID"))
                : AvatarActionResult.Failure("Item is not in inventory.", "precondition_failed"));
    }

    public sealed class OpenLabDoorCapability : JarvisLabCapability
    {
        public Transform door;
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "door.open", title = "Open lab door", description = "Unlock and open the lab door with the lab key.",
            risk = "interaction", permissionCategory = "world.door", parameters = ObjectSchema(new Dictionary<string, JObject>()),
            preconditions = new[] { "inventory contains lab_key" }, postconditions = new[] { "door is open" },
            sideEffects = new[] { "navigation path through the doorway becomes available" },
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            if (!World.Has("lab_key")) return Task.FromResult(AvatarActionResult.Failure("The lab key is required.", "precondition_failed"));
            World.OpenDoor();
            if (door != null) door.localRotation = Quaternion.Euler(0f, 90f, 0f);
            return Task.FromResult(AvatarActionResult.Success("Opened the lab door", "lab_door"));
        }
    }

    public sealed class GiveTechnicianItemCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "npc.give_item", title = "Give item to technician", description = "Give one inventory item to the technician NPC.",
            risk = "interaction", permissionCategory = "relationship.give_item",
            parameters = ObjectSchema(new Dictionary<string, JObject> { ["itemID"] = StringSchema("Exact inventory item ID") }, "itemID"),
            preconditions = new[] { "item is in inventory" }, postconditions = new[] { "technician received the item" },
            sideEffects = new[] { "inventory and relationship may change", "quest may advance" },
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation) => Task.FromResult(
            World.GiveToTechnician(arguments.Value<string>("itemID"))
                ? AvatarActionResult.Success("Technician received the item", "technician")
                : AvatarActionResult.Failure("Item is not in inventory.", "precondition_failed"));
    }

    public sealed class AttackTrainingTargetCapability : JarvisLabCapability
    {
        public override AvatarCapabilityManifest Manifest => new AvatarCapabilityManifest
        {
            id = "training.attack", title = "Disable training target", description = "Perform the irreversible training attack for this save slot.",
            risk = "critical", permissionCategory = "combat.training", parameters = ObjectSchema(new Dictionary<string, JObject>()),
            preconditions = new[] { "training target is active" }, postconditions = new[] { "training target is disabled" },
            sideEffects = new[] { "persistent training state changes" }, cancellable = false,
        };
        public override Task<AvatarActionResult> ExecuteAsync(JObject arguments, CancellationToken cancellation)
        {
            if (World.state.targetDisabled) return Task.FromResult(AvatarActionResult.Failure("Target is already disabled.", "already_applied"));
            World.DisableTarget();
            return Task.FromResult(AvatarActionResult.Success("Training target disabled", "training_target"));
        }
    }
}
