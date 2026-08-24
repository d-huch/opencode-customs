using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarDeveloperOverlay : MonoBehaviour
    {
        public OpenCodeAvatarBridgeV2 bridge;
        public AvatarLocomotionController locomotion;
        public AvatarMicroReactions reactions;
        public AvatarRigTargets rigTargets;
        public AvatarVRMPresentation presentation;
        public AvatarEditorInputMode inputMode;
        public AvatarVRKeyboard keyboard;
        public AvatarChatPanel chatPanel;
        public Transform viewer;
        public bool visible = true;
        public Key toggleKey = Key.F8;

        Canvas canvas;
        TextMeshProUGUI status;
        TextMeshProUGUI runtime;
        TextMeshProUGUI activity;
        TextMeshProUGUI conversation;
        TextMeshProUGUI error;
        Image statusDot;
        float nextRefresh;

        void Start()
        {
            if (bridge == null) bridge = GetComponentInParent<OpenCodeAvatarBridgeV2>();
            if (viewer == null && Camera.main != null) viewer = Camera.main.transform;
            Build();
            PlaceInFrontOfViewer();
            SetVisible(visible);
            Refresh();
        }

        void Update()
        {
            if (Keyboard.current?[toggleKey].wasPressedThisFrame == true) SetVisible(!visible);
            if (!visible || Time.unscaledTime < nextRefresh) return;
            nextRefresh = Time.unscaledTime + 0.2f;
            Refresh();
        }

        public void SetVisible(bool value)
        {
            visible = value;
            if (canvas != null) canvas.gameObject.SetActive(value);
        }

        public void PlaceInFrontOfViewer()
        {
            if (canvas == null || viewer == null) return;
            canvas.transform.position = viewer.position + viewer.forward * 1.35f - viewer.right * 0.52f + Vector3.up * 0.08f;
            AvatarWorldUI.FaceViewer(canvas.transform, viewer);
        }

        void Build()
        {
            if (canvas != null) return;
            canvas = AvatarWorldUI.CreateCanvas("Jarvis Developer Panel", transform, new Vector2(610f, 520f), 0.00155f);
            var panel = AvatarWorldUI.Image("Panel", canvas.transform, new Color(0.045f, 0.055f, 0.08f, 0.96f),
                Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            var outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.12f, 0.74f, 0.78f, 0.8f);
            outline.effectDistance = new Vector2(2f, -2f);
            AvatarWorldUI.Text("Title", panel.transform, "OPENCODE CUSTOMS  ·  AVATAR BRIDGE", 22f, Color.white, TextAlignmentOptions.Left,
                new Vector2(0.04f, 0.88f), new Vector2(0.82f, 0.98f), Vector2.zero, Vector2.zero);
            statusDot = AvatarWorldUI.Image("Status Dot", panel.transform, Color.gray,
                new Vector2(0.84f, 0.91f), new Vector2(0.88f, 0.96f), Vector2.zero, Vector2.zero);
            status = AvatarWorldUI.Text("Status", panel.transform, "Offline", 18f, new Color(0.72f, 0.76f, 0.84f), TextAlignmentOptions.Left,
                new Vector2(0.89f, 0.88f), new Vector2(0.98f, 0.98f), Vector2.zero, Vector2.zero);
            AvatarWorldUI.Image("Divider", panel.transform, new Color(0.2f, 0.24f, 0.32f, 1f),
                new Vector2(0.04f, 0.865f), new Vector2(0.96f, 0.869f), Vector2.zero, Vector2.zero);

            SectionLabel(panel.transform, "RUNTIME", 0.81f);
            runtime = Body(panel.transform, 0.61f, 0.80f);
            SectionLabel(panel.transform, "AGENT ACTIVITY", 0.56f);
            activity = Body(panel.transform, 0.34f, 0.55f);
            SectionLabel(panel.transform, "CONVERSATION", 0.29f);
            conversation = Body(panel.transform, 0.15f, 0.28f);
            error = AvatarWorldUI.Text("Error", panel.transform, string.Empty, 17f, new Color(1f, 0.48f, 0.45f), TextAlignmentOptions.TopLeft,
                new Vector2(0.04f, 0.09f), new Vector2(0.96f, 0.15f), Vector2.zero, Vector2.zero);

            AvatarWorldUI.Button("Input Mode", panel.transform, "Input", new Color(0.15f, 0.18f, 0.25f, 1f), () => inputMode?.ToggleMode(),
                new Vector2(0.04f, 0.02f), new Vector2(0.22f, 0.085f), Vector2.zero, Vector2.zero);
            AvatarWorldUI.Button("Keyboard", panel.transform, "Клавіатура", new Color(0.08f, 0.56f, 0.59f, 1f), () => keyboard?.Toggle(),
                new Vector2(0.24f, 0.02f), new Vector2(0.47f, 0.085f), Vector2.zero, Vector2.zero);
            AvatarWorldUI.Button("Chat", panel.transform, "Чат", new Color(0.1f, 0.42f, 0.5f, 1f), () => chatPanel?.Toggle(),
                new Vector2(0.49f, 0.02f), new Vector2(0.61f, 0.085f), Vector2.zero, Vector2.zero);
            AvatarWorldUI.Button("Recenter", panel.transform, "Перед собою", new Color(0.15f, 0.18f, 0.25f, 1f), PlaceInFrontOfViewer,
                new Vector2(0.63f, 0.02f), new Vector2(0.82f, 0.085f), Vector2.zero, Vector2.zero);
            AvatarWorldUI.Button("Hide", panel.transform, "Сховати", new Color(0.24f, 0.17f, 0.22f, 1f), () => SetVisible(false),
                new Vector2(0.84f, 0.02f), new Vector2(0.96f, 0.085f), Vector2.zero, Vector2.zero);
        }

        void Refresh()
        {
            if (bridge == null || status == null) return;
            status.text = bridge.ConnectionState;
            statusDot.color = bridge.ConnectionState == "Connected"
                ? new Color(0.2f, 0.9f, 0.55f)
                : bridge.ConnectionState == "Retrying" || bridge.ConnectionState == "Connecting" || bridge.ConnectionState == "Bootstrapping"
                    ? new Color(1f, 0.72f, 0.24f)
                    : new Color(1f, 0.35f, 0.35f);
            var sensor = bridge.worldSensor;
            var capabilities = bridge.capabilityRegistry;
            var steps = bridge.CurrentGoalState?.steps;
            var step = steps == null ? "—" : System.Array.Find(steps, value => value.status == "active")?.text ?? System.Array.Find(steps, value => value.status == "pending")?.text ?? "—";
            runtime.text =
                $"Input  <color=#92A0B8>{inputMode?.CurrentMode ?? (Application.isEditor ? "Editor" : "Quest")}</color>     " +
                $"Eyes  <color=#92A0B8>{(inputMode?.CurrentEyeHeight ?? 0f):F2} m</color>\n" +
                $"Focus  <color=#92A0B8>{inputMode?.FocusState ?? "—"}</color>     " +
                $"Restore  <color=#92A0B8>{inputMode?.FocusRestoreReason ?? "—"}</color>\n" +
                $"Voice  <color=#92A0B8>{bridge.VoiceEngine} · {(bridge.receiveVoice ? bridge.AudioPlaybackState : "disabled")} · {bridge.RealtimeStage}</color>     " +
                $"World  <color=#92A0B8>{sensor?.Latest?.entities.Count ?? 0} entities · {capabilities?.All.Count ?? 0} capabilities</color>\n" +
                $"Model  <color=#92A0B8>{Short(bridge.ResponseModel)}</color>     TTFT  <color=#92A0B8>{bridge.ResponseTTFTMs} ms</color>     Total  <color=#92A0B8>{bridge.ResponseGenerationMs} ms</color>";
            activity.text =
                $"State  <color=#92A0B8>{reactions?.CurrentState ?? "—"}</color>     Gesture  <color=#92A0B8>{reactions?.CurrentGesture ?? rigTargets?.ActiveGesture ?? "—"}</color>\n" +
                $"Gaze  <color=#92A0B8>{rigTargets?.CurrentGazeTarget ?? "—"}</color>     Speed  <color=#92A0B8>{(locomotion?.CurrentSpeed ?? 0f):F2} m/s</color>\n" +
                $"Goal  <color=#92A0B8>{bridge.CurrentGoal ?? "—"}</color>\nStep  <color=#92A0B8>{step}</color>";
            conversation.text =
                $"You  <color=#92A0B8>{Short(bridge.LastTranscript)}</color>\n" +
                $"Jarvis  <color=#92A0B8>{Short(bridge.LastAssistantText)}</color>";
            error.text = string.IsNullOrWhiteSpace(bridge.LastError) ? string.Empty : "Error: " + Short(bridge.LastError);
        }

        static string Short(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "—";
            var clean = value.Replace('\n', ' ').Trim();
            return clean.Length <= 110 ? clean : clean.Substring(0, 109) + "…";
        }

        static void SectionLabel(Transform parent, string value, float bottom)
        {
            AvatarWorldUI.Text(value, parent, value, 15f, new Color(0.35f, 0.84f, 0.86f), TextAlignmentOptions.BottomLeft,
                new Vector2(0.04f, bottom), new Vector2(0.96f, bottom + 0.045f), Vector2.zero, Vector2.zero);
        }

        static TextMeshProUGUI Body(Transform parent, float bottom, float top)
        {
            return AvatarWorldUI.Text("Body", parent, string.Empty, 18f, Color.white, TextAlignmentOptions.TopLeft,
                new Vector2(0.04f, bottom), new Vector2(0.96f, top), Vector2.zero, Vector2.zero);
        }
    }
}
