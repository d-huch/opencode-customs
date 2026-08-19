using UnityEngine;
using UnityEngine.InputSystem;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class AvatarDeveloperOverlay : MonoBehaviour
    {
        public OpenCodeAvatarBridgeV2 bridge;
        public AvatarLocomotionController locomotion;
        public AvatarMicroReactions reactions;
        public AvatarRigTargets rigTargets;
        public AvatarVRMPresentation presentation;
        public bool visible = true;
        public Key toggleKey = Key.F8;
        GUIStyle style;

        void Update()
        {
            if (Keyboard.current?[toggleKey].wasPressedThisFrame == true) visible = !visible;
        }

        void OnGUI()
        {
            if (!visible || bridge == null) return;
            style ??= new GUIStyle(GUI.skin.box) { alignment = TextAnchor.UpperLeft, fontSize = 14, wordWrap = true };
            var sensor = bridge.worldSensor;
            var capabilities = bridge.capabilityRegistry;
            var approval = bridge.CurrentApproval;
            var steps = bridge.CurrentGoalState?.steps;
            var step = steps == null ? "—" : System.Array.Find(steps, value => value.status == "active")?.text ?? System.Array.Find(steps, value => value.status == "pending")?.text ?? "—";
            var text =
                $"OpenCode Customs Avatar Bridge v{AvatarProtocol.Version}.{AvatarProtocol.Minor}\n" +
                $"Connection: {(bridge.IsConnected ? "connected" : "offline")}\n" +
                $"Goal: {bridge.CurrentGoal ?? "—"}\n" +
                $"Step: {step}  Replan: {bridge.CurrentGoalState?.replanReason ?? "—"}\n" +
                $"Last action: {bridge.LastAction ?? "—"} ({bridge.LastActionLatencyMs} ms)\n" +
                $"Animation: {reactions?.CurrentState ?? "—"}  Gesture: {reactions?.CurrentGesture ?? rigTargets?.ActiveGesture ?? "—"}\n" +
                $"Gaze: {rigTargets?.CurrentGazeTarget ?? "—"}  Speed: {(locomotion?.CurrentSpeed ?? 0f):F2} m/s\n" +
                $"Emotion: {presentation?.CurrentEmotion ?? "—"}  Viseme: {presentation?.LastViseme ?? "—"}\n" +
                $"Entities: {sensor?.Latest?.entities.Count ?? 0}  Capabilities: {capabilities?.All.Count ?? 0}\n" +
                $"Approval: {(approval == null ? "—" : approval.title + " [" + approval.risk + "]")}";
            GUI.Box(new Rect(20, 20, 620, 250), text, style);
        }
    }
}
