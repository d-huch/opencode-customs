using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace OpenCode.Customs.AvatarBridge.Tests
{
    public sealed class AvatarWorldSensorTests
    {
        [UnityTest]
        public IEnumerator SensorEmitsSemanticSnapshotWithoutHierarchy()
        {
            var observer = new GameObject("observer");
            var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
            target.transform.position = Vector3.forward * 2f;
            var entity = target.AddComponent<OpenCodeWorldEntity>();
            entity.kind = "item";
            entity.label = "Test item";
            var sensor = observer.AddComponent<AvatarWorldSensor>();
            sensor.GameID = "game";
            sensor.SaveSlotID = "slot";
            sensor.CharacterID = "companion";
            sensor.updatesPerSecond = 10f;
            WorldSnapshot snapshot = null;
            sensor.SnapshotReady += value => snapshot = value;
            Physics.SyncTransforms();
            yield return null;
            sensor.ForceSnapshot();
            Assert.IsNotNull(snapshot);
            Assert.AreEqual("item", snapshot.entities[0].kind);
            Assert.IsFalse(AvatarJson.Serialize(snapshot).Contains("m_Component"));
            Object.Destroy(observer);
            Object.Destroy(target);
        }

        [UnityTest]
        public IEnumerator PresentationAppliesCompositeVisemeAndResetsAfterCancellation()
        {
            var root = new GameObject("face");
            var renderer = root.AddComponent<SkinnedMeshRenderer>();
            var mesh = new Mesh { vertices = new[] { Vector3.zero, Vector3.right, Vector3.up }, triangles = new[] { 0, 1, 2 } };
            var deltas = new Vector3[3];
            mesh.AddBlendShapeFrame("jawOpen", 100f, deltas, deltas, deltas);
            mesh.AddBlendShapeFrame("mouthLowerDownLeft", 100f, deltas, deltas, deltas);
            renderer.sharedMesh = mesh;
            var presentation = root.AddComponent<AvatarVRMPresentation>();
            presentation.face = renderer;
            presentation.naturalBlinking = false;
            presentation.blendSpeed = 30f;
            presentation.visemes = new[]
            {
                new AvatarBlendShapeBinding { key = "AA", blendShape = "jawOpen", weight = 100f },
                new AvatarBlendShapeBinding { key = "AA", blendShape = "mouthLowerDownLeft", weight = 40f },
            };
            presentation.RebuildBindings();
            presentation.SetViseme("AA", 1f);
            yield return null;
            Assert.Greater(renderer.GetBlendShapeWeight(0), 0f);
            Assert.Greater(renderer.GetBlendShapeWeight(1), 0f);
            presentation.SetViseme(null, 0f);
            yield return null;
            Assert.AreEqual("—", presentation.LastViseme);
            Assert.AreEqual(0f, renderer.GetBlendShapeWeight(0), 0.5f);
            Assert.AreEqual(0f, renderer.GetBlendShapeWeight(1), 0.5f);
            Object.Destroy(root);
            Object.Destroy(mesh);
        }
    }
}
