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
        public void BridgeReceivesAgentVoiceByDefault()
        {
            var root = new GameObject("companion");
            try { Assert.IsTrue(root.AddComponent<OpenCodeAvatarBridgeV2>().receiveVoice); }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void WebSocketAbortIsTreatedAsTransportDisconnect()
        {
            var classify = typeof(OpenCodeAvatarBridgeV2)
                .GetMethod("IsTransportDisconnect", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            Assert.IsTrue((bool)classify.Invoke(null, new object[]
            {
                new System.Net.WebSockets.WebSocketException("This operation was aborted"),
            }));
            Assert.IsTrue((bool)classify.Invoke(null, new object[]
            {
                new System.IO.IOException("send failed", new System.Net.WebSockets.WebSocketException("closed")),
            }));
            Assert.IsFalse((bool)classify.Invoke(null, new object[] { new System.InvalidOperationException("model failed") }));
        }

        [Test]
        public void TransportAbortCollapsesIntoRetryingStatusWithoutErrorEvent()
        {
            var root = new GameObject("companion");
            try
            {
                var bridge = root.AddComponent<OpenCodeAvatarBridgeV2>();
                var errors = 0;
                bridge.onError.AddListener(_ => errors++);
                var retry = typeof(OpenCodeAvatarBridgeV2)
                    .GetMethod("SetRetrying", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                retry.Invoke(bridge, new object[] { "Connection interrupted.", false });
                retry.Invoke(bridge, new object[] { "Connection interrupted.", false });
                typeof(OpenCodeAvatarBridgeV2)
                    .GetMethod("Update", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .Invoke(bridge, null);

                Assert.AreEqual("Retrying", bridge.ConnectionState);
                Assert.IsNull(bridge.LastError);
                Assert.AreEqual(0, errors);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void VrKeyboardTogglesAWorldSpaceCanvas()
        {
            var root = new GameObject("player");
            var viewer = new GameObject("viewer");
            try
            {
                var keyboard = root.AddComponent<AvatarVRKeyboard>();
                keyboard.bridge = root.AddComponent<OpenCodeAvatarBridgeV2>();
                keyboard.viewer = viewer.transform;
                typeof(AvatarVRKeyboard).GetMethod("Start", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(keyboard, null);
                Assert.IsFalse(keyboard.IsVisible);
                Assert.IsFalse(keyboard.hideAfterSend);
                keyboard.Toggle();
                Assert.IsTrue(keyboard.IsVisible);
                Assert.AreEqual(RenderMode.WorldSpace, root.GetComponentInChildren<Canvas>(true).renderMode);
                keyboard.Hide();
                Assert.IsFalse(keyboard.IsVisible);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(viewer);
            }
        }

        [Test]
        public void SpeechBubbleCreatesComicWorldSpaceCanvasAboveAgent()
        {
            var root = new GameObject("agent");
            var head = new GameObject("head");
            var viewer = new GameObject("viewer");
            try
            {
                head.transform.SetParent(root.transform, false);
                var bubble = root.AddComponent<AvatarSpeechBubble>();
                bubble.bridge = root.AddComponent<OpenCodeAvatarBridgeV2>();
                bubble.head = head.transform;
                bubble.viewer = viewer.transform;
                typeof(AvatarSpeechBubble).GetMethod("Start", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(bubble, null);
                bubble.Show("Привіт із Jarvis Room");
                var canvas = root.GetComponentsInChildren<Canvas>(true)[0];
                Assert.AreEqual("Comic Speech Bubble", canvas.name);
                Assert.AreEqual(RenderMode.WorldSpace, canvas.renderMode);
                Assert.IsTrue(canvas.gameObject.activeSelf);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(viewer);
            }
        }

        [Test]
        public void ChatPanelKeepsBoundedDeduplicatedWorldSpaceHistory()
        {
            var root = new GameObject("player");
            var viewer = new GameObject("viewer");
            try
            {
                var bridge = root.AddComponent<OpenCodeAvatarBridgeV2>();
                var keyboard = root.AddComponent<AvatarVRKeyboard>();
                var chat = root.AddComponent<AvatarChatPanel>();
                keyboard.bridge = bridge;
                keyboard.chatPanel = chat;
                chat.bridge = bridge;
                chat.keyboard = keyboard;
                chat.viewer = viewer.transform;
                chat.maximumMessages = 20;
                typeof(AvatarChatPanel).GetMethod("Start", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(chat, null);
                Assert.AreEqual("Привіт, Джарвісе!", AvatarChatPanel.FirstTestPrompt);
                Assert.AreEqual("Що ти бачиш у цій кімнаті?", AvatarChatPanel.SecondTestPrompt);
                chat.Show();
                Assert.IsTrue(chat.IsVisible);
                Assert.AreEqual(RenderMode.WorldSpace, root.GetComponentsInChildren<Canvas>(true)[0].renderMode);
                for (var index = 0; index < 22; index++) bridge.onUserText.Invoke("Репліка " + index);
                Assert.AreEqual(20, chat.MessageCount);
                StringAssert.DoesNotContain("Репліка 0\n", chat.RenderedHistory);
                StringAssert.Contains("Репліка 21", chat.RenderedHistory);
                chat.ClearHistory();
                bridge.onAssistantText.Invoke("Одна відповідь");
                bridge.onAssistantText.Invoke("Одна відповідь");
                Assert.AreEqual(1, chat.MessageCount);
                chat.ClearHistory();
                bridge.onUserText.Invoke("Питання");
                bridge.onAssistantDelta.Invoke("Вітаю ");
                bridge.onAssistantDelta.Invoke("з Unity");
                bridge.onAssistantText.Invoke("Вітаю з Unity");
                Assert.AreEqual(2, chat.MessageCount);
                Assert.AreEqual(1, chat.RenderedHistory.Split(new[] { "Вітаю з Unity" }, System.StringSplitOptions.None).Length - 1);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(viewer);
            }
        }

        [Test]
        public void PresentationSubtitleDoesNotBecomeAssistantChatMessage()
        {
            var root = new GameObject("companion");
            try
            {
                var bridge = root.AddComponent<OpenCodeAvatarBridgeV2>();
                typeof(OpenCodeAvatarBridgeV2)
                    .GetField("profile", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .SetValue(bridge, new AvatarConnectionProfile());
                var messages = 0;
                bridge.onAssistantText.AddListener(_ => messages++);
                var handle = typeof(OpenCodeAvatarBridgeV2)
                    .GetMethod("HandleMessage", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                var update = typeof(OpenCodeAvatarBridgeV2)
                    .GetMethod("Update", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                handle.Invoke(bridge, new object[] { JObject.Parse("{\"type\":\"avatar.presentation\",\"state\":\"thinking\",\"subtitle\":\"user prompt\",\"intensity\":0.4}") });
                update.Invoke(bridge, null);
                Assert.AreEqual(0, messages);
                handle.Invoke(bridge, new object[] { JObject.Parse("{\"type\":\"assistant.text\",\"text\":\"assistant answer\"}") });
                update.Invoke(bridge, null);
                Assert.AreEqual(1, messages);
                Assert.AreEqual("assistant answer", bridge.LastAssistantText);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void DeveloperPanelNoLongerUsesImmediateModeGui()
        {
            Assert.IsNull(typeof(AvatarDeveloperOverlay).GetMethod("OnGUI", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic));
        }

        [Test]
        public void SpeakingAndThinkingDoNotHoldLoopingAnimatorStates()
        {
            var root = new GameObject("companion");
            try
            {
                var reactions = root.AddComponent<AvatarMicroReactions>();
                reactions.SetState("speaking");
                Assert.AreEqual(0, reactions.CurrentAnimatorStateID);
                reactions.SetState("thinking");
                Assert.AreEqual(0, reactions.CurrentAnimatorStateID);
                reactions.SetState("acting");
                Assert.AreEqual(5, reactions.CurrentAnimatorStateID);
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
                StringAssert.Contains("Supported names", reason);
                Assert.IsTrue(capability.CheckPreconditions(new JObject { ["kind"] = "gesture", ["name"] = "sarcastic_nod" }, out reason));
                Assert.IsNull(reason);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void EditorInputModeSwitchesSimulatorAndControllerOverrideTogether()
        {
            var root = new GameObject("player");
            var simulator = new GameObject("simulator");
            try
            {
                simulator.transform.SetParent(root.transform);
                var visuals = root.AddComponent<AvatarXRInputVisuals>();
                var input = root.AddComponent<AvatarEditorInputMode>();
                input.simulator = simulator;
                input.visuals = visuals;
                input.ToggleMode();
                Assert.IsFalse(simulator.activeSelf);
                Assert.IsTrue(visuals.forceControllers);
                Assert.AreEqual("Desktop Walk", input.CurrentMode);
                input.ToggleMode();
                Assert.IsTrue(simulator.activeSelf);
                Assert.IsFalse(visuals.forceControllers);
                Assert.AreEqual("XRI Simulator", input.CurrentMode);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void EditorSimulatorRestoresEyeHeightAfterZeroPose()
        {
            var root = new GameObject("player");
            var head = new GameObject("head");
            var left = new GameObject("left");
            var right = new GameObject("right");
            try
            {
                head.transform.SetParent(root.transform, false);
                left.transform.SetParent(root.transform, false);
                right.transform.SetParent(root.transform, false);
                var input = root.AddComponent<AvatarEditorInputMode>();
                input.xrOrigin = root.transform;
                input.head = head.transform;
                input.leftController = left.transform;
                input.rightController = right.transform;
                input.standingHeadHeight = 1.7f;
                typeof(AvatarEditorInputMode)
                    .GetMethod("LateUpdate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .Invoke(input, null);
                Assert.AreEqual(1.7f, head.transform.position.y - root.transform.position.y, 0.001f);
                Assert.Greater(left.transform.position.y, 1f);
                Assert.Greater(right.transform.position.y, 1f);
                Assert.Less(left.transform.position.x, 0f);
                Assert.Greater(right.transform.position.x, 0f);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void EditorSimulatorAppliesStandingHeightToCameraFloorOffset()
        {
            var root = new GameObject("player");
            var offset = new GameObject("camera offset");
            var head = new GameObject("head");
            try
            {
                offset.transform.SetParent(root.transform, false);
                head.transform.SetParent(offset.transform, false);
                var input = root.AddComponent<AvatarEditorInputMode>();
                input.xrOrigin = root.transform;
                input.cameraFloorOffset = offset.transform;
                input.head = head.transform;
                input.standingHeadHeight = 1.7f;
                typeof(AvatarEditorInputMode)
                    .GetMethod("LateUpdate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .Invoke(input, null);
                Assert.AreEqual(1.7f, offset.transform.localPosition.y, 0.001f);
                Assert.AreEqual(1.7f, head.transform.position.y - root.transform.position.y, 0.001f);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void EditorSimulatorRestoresPositionAndRotationAfterFocusReset()
        {
            var root = new GameObject("player");
            var offset = new GameObject("camera offset");
            var head = new GameObject("head");
            try
            {
                offset.transform.SetParent(root.transform, false);
                head.transform.SetParent(offset.transform, false);
                var input = root.AddComponent<AvatarEditorInputMode>();
                input.xrOrigin = root.transform;
                input.cameraFloorOffset = offset.transform;
                input.head = head.transform;
                input.standingHeadHeight = 1.7f;
                var lateUpdate = typeof(AvatarEditorInputMode)
                    .GetMethod("LateUpdate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);

                lateUpdate.Invoke(input, null);
                root.transform.SetPositionAndRotation(new Vector3(2f, 0f, 3f), Quaternion.Euler(0f, 25f, 0f));
                head.transform.localPosition = new Vector3(0.7f, 0.2f, -0.5f);
                head.transform.localRotation = Quaternion.Euler(15f, 40f, 0f);
                lateUpdate.Invoke(input, null);
                var expectedOriginPosition = root.transform.position;
                var expectedOriginRotation = root.transform.rotation;
                var expectedHeadPosition = head.transform.position;
                var expectedHeadRotation = head.transform.rotation;

                root.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                head.transform.localPosition = Vector3.zero;
                head.transform.localRotation = Quaternion.identity;
                lateUpdate.Invoke(input, null);

                Assert.Less(Vector3.Distance(expectedOriginPosition, root.transform.position), 0.001f);
                Assert.Less(Quaternion.Angle(expectedOriginRotation, root.transform.rotation), 0.01f);
                Assert.Less(Vector3.Distance(expectedHeadPosition, head.transform.position), 0.001f);
                Assert.Less(Quaternion.Angle(expectedHeadRotation, head.transform.rotation), 0.01f);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void EditorSimulatorFreezesPoseWhileGameViewIsUnfocused()
        {
            var root = new GameObject("player");
            var offset = new GameObject("camera offset");
            var head = new GameObject("head");
            try
            {
                offset.transform.SetParent(root.transform, false);
                head.transform.SetParent(offset.transform, false);
                var input = root.AddComponent<AvatarEditorInputMode>();
                input.xrOrigin = root.transform;
                input.cameraFloorOffset = offset.transform;
                input.head = head.transform;
                input.standingHeadHeight = 1.7f;
                var lateUpdate = typeof(AvatarEditorInputMode)
                    .GetMethod("LateUpdate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                lateUpdate.Invoke(input, null);
                root.transform.SetPositionAndRotation(new Vector3(4f, 0f, -2f), Quaternion.Euler(0f, 55f, 0f));
                head.transform.localRotation = Quaternion.Euler(8f, 0f, 0f);
                lateUpdate.Invoke(input, null);
                var position = root.transform.position;
                var rotation = root.transform.rotation;

                input.SetGameViewFocused(false, "Focused ConsoleWindow");
                root.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                head.transform.localPosition = Vector3.zero;
                head.transform.localRotation = Quaternion.identity;
                lateUpdate.Invoke(input, null);

                Assert.Less(Vector3.Distance(position, root.transform.position), 0.001f);
                Assert.Less(Quaternion.Angle(rotation, root.transform.rotation), 0.01f);
                Assert.AreEqual("Game View paused", input.FocusState);
                StringAssert.Contains("Console", input.FocusRestoreReason);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void EditorSimulatorMovesCollapsedControllersBelowEyeLevel()
        {
            var root = new GameObject("player");
            var offset = new GameObject("camera offset");
            var head = new GameObject("head");
            var left = new GameObject("left");
            var right = new GameObject("right");
            try
            {
                offset.transform.SetParent(root.transform, false);
                head.transform.SetParent(offset.transform, false);
                left.transform.SetParent(offset.transform, false);
                right.transform.SetParent(offset.transform, false);
                left.transform.localPosition = new Vector3(-0.2f, 0f, 0f);
                right.transform.localPosition = new Vector3(0.2f, 0f, 0f);
                var input = root.AddComponent<AvatarEditorInputMode>();
                input.xrOrigin = root.transform;
                input.cameraFloorOffset = offset.transform;
                input.head = head.transform;
                input.leftController = left.transform;
                input.rightController = right.transform;
                input.standingHeadHeight = 1.7f;
                typeof(AvatarEditorInputMode)
                    .GetMethod("LateUpdate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .Invoke(input, null);
                Assert.Less(left.transform.position.y, head.transform.position.y - 0.35f);
                Assert.Less(right.transform.position.y, head.transform.position.y - 0.35f);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void RigTargetsDelegateLookAtToHumanoidGaze()
        {
            var root = new GameObject("companion");
            try
            {
                var gaze = root.AddComponent<AvatarHumanoidGaze>();
                var targets = root.AddComponent<AvatarRigTargets>();
                targets.gaze = gaze;
                targets.LookAt(new Vector3(1f, 1.5f, 2f));
                Assert.AreEqual("(1.00, 1.50, 2.00)", targets.CurrentGazeTarget);
                targets.ResetOverrides();
                Assert.AreEqual("player", gaze.CurrentTarget);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void InputVisualsShowControllersWhenTrackingIsUnavailable()
        {
            var root = new GameObject("player");
            var left = new GameObject("left controller");
            var right = new GameObject("right controller");
            try
            {
                left.transform.SetParent(root.transform);
                right.transform.SetParent(root.transform);
                left.SetActive(false);
                right.SetActive(false);
                var visuals = root.AddComponent<AvatarXRInputVisuals>();
                visuals.leftController = left;
                visuals.rightController = right;
                visuals.showControllersWhenUntracked = true;
                visuals.Refresh();
                Assert.IsTrue(left.activeSelf);
                Assert.IsTrue(right.activeSelf);
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}
