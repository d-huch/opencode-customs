using NUnit.Framework;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge.Tests
{
    public sealed class AvatarCapabilityTests
    {
        [Test]
        public void StandardCapabilityPublishesTypedSchemaAndRisk()
        {
            var root = new GameObject("companion");
            try
            {
                var capability = root.AddComponent<MoveToCapability>();
                Assert.AreEqual("move_to", capability.Manifest.id);
                Assert.AreEqual("ambient", capability.Manifest.risk);
                Assert.AreEqual("object", capability.Manifest.parameters.Value<string>("type"));
                Assert.IsNotNull(capability.Manifest.parameters["properties"]?["position"]);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void RegistryRejectsDuplicateCapabilityIDs()
        {
            var root = new GameObject("companion");
            try
            {
                root.AddComponent<MoveToCapability>();
                root.AddComponent<MoveToCapability>();
                var registry = root.AddComponent<AvatarCapabilityRegistry>();
                Assert.Throws<System.InvalidOperationException>(() => registry.Refresh());
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void ExpressionCapabilityRejectsUnknownAnimatorTriggers()
        {
            var root = new GameObject("companion");
            try
            {
                var capability = root.AddComponent<CharacterExpressionCapability>();
                Assert.IsFalse(capability.CheckPreconditions(new JObject { ["kind"] = "gesture", ["name"] = "arbitrary-trigger" }, out var reason));
                StringAssert.Contains("wave, point, nod, or thinking", reason);
                Assert.IsTrue(capability.CheckPreconditions(new JObject { ["kind"] = "gesture", ["name"] = "wave" }, out reason));
                Assert.IsNull(reason);
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}
