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
    }
}
