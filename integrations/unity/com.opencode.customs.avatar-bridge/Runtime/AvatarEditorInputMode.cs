using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarEditorInputMode : MonoBehaviour
    {
        public Transform xrOrigin;
        public Transform cameraFloorOffset;
        public Transform head;
        public Transform leftController;
        public Transform rightController;
        public GameObject simulator;
        public AvatarXRInputVisuals visuals;
        public TrackedPoseDriver[] poseDrivers;
        public Key toggleKey = Key.F1;
        [Min(0.1f)] public float moveSpeed = 3f;
        [Min(0.1f)] public float sprintMultiplier = 1.8f;
        [Min(0.01f)] public float lookSensitivity = 0.08f;
        [Min(0.5f)] public float standingHeadHeight = 1.7f;
        public bool startInSimulatorMode = true;

        float yaw;
        float pitch;
        float stableHeadHeight;
        Vector3 stableOriginPosition;
        Quaternion stableOriginRotation = Quaternion.identity;
        Vector3 initialOriginPosition;
        Quaternion initialOriginRotation = Quaternion.identity;
        Vector3 stableHeadPosition;
        Quaternion stableHeadRotation = Quaternion.identity;
        bool hasInitialOriginPose;
        bool hasStableSimulatorPose;
        bool simulatorMode = true;
        bool gameViewFocused = true;
        bool focusPaused;
        int focusRestoreFrames;
        string focusRestoreReason = "Play session started";

        public string CurrentMode => !Application.isEditor ? "Quest" : simulatorMode ? "XRI Simulator" : "Desktop Walk";
        public float CurrentEyeHeight => xrOrigin != null && head != null ? head.position.y - xrOrigin.position.y : 0f;
        public string FocusState => !Application.isEditor ? "Quest" : focusPaused ? "Game View paused" : gameViewFocused ? "Game View focused" : "Game View restoring";
        public string FocusRestoreReason => focusRestoreReason;

        void Awake()
        {
            simulatorMode = startInSimulatorMode;
            EnsureEditorRigHeight();
            if (head != null)
            {
                yaw = head.eulerAngles.y;
                pitch = NormalizeAngle(head.eulerAngles.x);
                stableHeadHeight = Mathf.Max(standingHeadHeight, head.position.y - transform.position.y);
                CaptureSimulatorPose();
            }
            ApplyMode();
        }

        void OnEnable() => Application.onBeforeRender += BeforeRender;

        void OnDisable() => Application.onBeforeRender -= BeforeRender;

        void Update()
        {
#if UNITY_EDITOR
            if (Keyboard.current?[toggleKey].wasPressedThisFrame == true) ToggleMode();
            if (simulatorMode || xrOrigin == null || head == null) return;

            PositionDesktopControllers();

            var keyboard = Keyboard.current;
            var mouse = Mouse.current;
            if (keyboard == null) return;
            var input = new Vector2(
                (keyboard.dKey.isPressed ? 1f : 0f) - (keyboard.aKey.isPressed ? 1f : 0f),
                (keyboard.wKey.isPressed ? 1f : 0f) - (keyboard.sKey.isPressed ? 1f : 0f));
            var forward = Vector3.ProjectOnPlane(head.forward, Vector3.up).normalized;
            var right = Vector3.ProjectOnPlane(head.right, Vector3.up).normalized;
            var speed = moveSpeed * (keyboard.leftShiftKey.isPressed ? sprintMultiplier : 1f);
            xrOrigin.position += (forward * input.y + right * input.x).normalized * (input.sqrMagnitude > 0f ? speed * Time.unscaledDeltaTime : 0f);

            if (mouse?.rightButton.isPressed != true) return;
            var delta = mouse.delta.ReadValue() * lookSensitivity;
            yaw += delta.x;
            pitch = Mathf.Clamp(pitch - delta.y, -80f, 80f);
            xrOrigin.rotation = Quaternion.Euler(0f, yaw, 0f);
            head.localRotation = Quaternion.Euler(pitch, 0f, 0f);
#endif
        }

        void LateUpdate()
        {
#if UNITY_EDITOR
            if (!simulatorMode || xrOrigin == null || head == null) return;
            if (focusPaused || focusRestoreFrames > 0)
            {
                RestoreSimulatorPose(stableHeadPosition, stableHeadRotation);
                RestoreCollapsedSimulatorControllers();
                if (!focusPaused && --focusRestoreFrames <= 0) SetPoseDrivers(true);
                return;
            }
            StabilizeSimulatorPose();
#endif
        }

        void BeforeRender()
        {
#if UNITY_EDITOR
            if (!simulatorMode || xrOrigin == null || head == null) return;
            if (focusPaused || focusRestoreFrames > 0)
            {
                RestoreSimulatorPose(stableHeadPosition, stableHeadRotation);
                return;
            }
            StabilizeSimulatorPose();
#endif
        }

        public void SetGameViewFocused(bool focused, string reason)
        {
#if UNITY_EDITOR
            if (!simulatorMode || gameViewFocused == focused) return;
            gameViewFocused = focused;
            focusRestoreReason = string.IsNullOrWhiteSpace(reason) ? (focused ? "Game View regained focus" : "Editor focus changed") : reason;
            if (!focused)
            {
                CaptureSimulatorPose();
                focusPaused = true;
                focusRestoreFrames = 0;
                SetPoseDrivers(false);
                return;
            }
            RestoreSimulatorPose(stableHeadPosition, stableHeadRotation);
            RestoreCollapsedSimulatorControllers();
            focusPaused = false;
            // XRI Simulation publishes one or two zero poses after Editor focus is
            // restored. Keep the drivers paused until those frames have passed.
            focusRestoreFrames = 2;
#endif
        }

        void StabilizeSimulatorPose()
        {
            EnsureEditorRigHeight();
            var position = xrOrigin.InverseTransformPoint(head.position);
            var rotation = Quaternion.Inverse(xrOrigin.rotation) * head.rotation;
            var resetPosition = Mathf.Abs(position.x) < 0.02f && Mathf.Abs(position.z) < 0.02f &&
                (position.y < 0.5f || Mathf.Abs(position.y - standingHeadHeight) < 0.08f);
            var resetRotation = Quaternion.Angle(rotation, Quaternion.identity) < 1f;
            var originReturnedToStart = hasInitialOriginPose &&
                Vector3.Distance(xrOrigin.position, initialOriginPosition) < 0.02f &&
                Quaternion.Angle(xrOrigin.rotation, initialOriginRotation) < 1f &&
                (Vector3.Distance(stableOriginPosition, initialOriginPosition) > 0.05f ||
                 Quaternion.Angle(stableOriginRotation, initialOriginRotation) > 2f);
            var changedFromStable = hasStableSimulatorPose &&
                (Vector3.Distance(position, stableHeadPosition) > 0.05f ||
                 Quaternion.Angle(rotation, stableHeadRotation) > 2f ||
                 originReturnedToStart);

            // XRI Simulation briefly writes its origin pose when Game view loses focus.
            // Restore the complete last valid world pose, not only eye height, so clicking
            // another Editor window cannot teleport or rotate the player.
            if (hasStableSimulatorPose && ((resetPosition && resetRotation && changedFromStable) || position.y < 0.5f))
            {
                RestoreSimulatorPose(stableHeadPosition, stableHeadRotation);
                RestoreCollapsedSimulatorControllers();
                return;
            }

            stableHeadHeight = Mathf.Max(standingHeadHeight, position.y);
            CaptureSimulatorPose(position, rotation);
            RestoreCollapsedSimulatorControllers();
        }

        void CaptureSimulatorPose()
        {
            if (xrOrigin == null || head == null) return;
            CaptureSimulatorPose(
                xrOrigin.InverseTransformPoint(head.position),
                Quaternion.Inverse(xrOrigin.rotation) * head.rotation);
        }

        void CaptureSimulatorPose(Vector3 position, Quaternion rotation)
        {
            if (!hasInitialOriginPose)
            {
                initialOriginPosition = xrOrigin.position;
                initialOriginRotation = xrOrigin.rotation;
                hasInitialOriginPose = true;
            }
            stableOriginPosition = xrOrigin.position;
            stableOriginRotation = xrOrigin.rotation;
            stableHeadPosition = position;
            stableHeadRotation = rotation;
            hasStableSimulatorPose = true;
        }

        void RestoreSimulatorPose(Vector3 position, Quaternion rotation)
        {
            if (!hasStableSimulatorPose)
            {
                stableOriginPosition = xrOrigin.position;
                stableOriginRotation = xrOrigin.rotation;
                stableHeadPosition = new Vector3(position.x, Mathf.Max(stableHeadHeight, standingHeadHeight), position.z);
                stableHeadRotation = rotation;
                hasStableSimulatorPose = true;
            }

            xrOrigin.SetPositionAndRotation(stableOriginPosition, stableOriginRotation);
            head.SetPositionAndRotation(
                xrOrigin.TransformPoint(stableHeadPosition),
                xrOrigin.rotation * stableHeadRotation);
        }

        void EnsureEditorRigHeight()
        {
#if UNITY_EDITOR
            if (cameraFloorOffset == null) return;
            var position = cameraFloorOffset.localPosition;
            if (Mathf.Abs(position.y - standingHeadHeight) < 0.001f) return;
            cameraFloorOffset.localPosition = new Vector3(position.x, standingHeadHeight, position.z);
#endif
        }

        void RestoreCollapsedSimulatorControllers()
        {
            RestoreCollapsedSimulatorController(leftController, new Vector3(-0.24f, -0.46f, 0.42f), -8f);
            RestoreCollapsedSimulatorController(rightController, new Vector3(0.24f, -0.46f, 0.42f), 8f);
        }

        void RestoreCollapsedSimulatorController(Transform controller, Vector3 offset, float yawOffset)
        {
            if (controller == null) return;
            var originOffset = controller.position - (cameraFloorOffset != null ? cameraFloorOffset.position : xrOrigin.position);
            var collapsedAtHead = head != null && Mathf.Abs(controller.position.y - head.position.y) < 0.18f &&
                Vector3.Distance(controller.position, head.position) < 0.45f;
            if (originOffset.sqrMagnitude > 0.04f && !collapsedAtHead) return;
            controller.position = head.TransformPoint(offset);
            controller.rotation = head.rotation * Quaternion.Euler(12f, yawOffset, 0f);
        }

        public void ToggleMode()
        {
            if (!Application.isEditor) return;
            simulatorMode = !simulatorMode;
            ApplyMode();
        }

        void ApplyMode()
        {
            if (!Application.isEditor) return;
            EnsureEditorRigHeight();
            if (simulator != null) simulator.SetActive(simulatorMode);
            if (visuals != null) visuals.forceControllers = !simulatorMode;
            SetPoseDrivers(simulatorMode && !focusPaused && focusRestoreFrames == 0);
            if (simulatorMode) return;
            if (head != null)
            {
                var local = head.localPosition;
                head.localPosition = new Vector3(local.x, cameraFloorOffset != null && head.parent == cameraFloorOffset ? 0f : standingHeadHeight, local.z);
            }
            PositionDesktopControllers();
        }

        void SetPoseDrivers(bool enabled)
        {
            if (poseDrivers == null) return;
            foreach (var driver in poseDrivers)
                if (driver != null) driver.enabled = enabled;
        }

        void PositionDesktopControllers()
        {
            PositionController(leftController, new Vector3(-0.24f, -0.46f, 0.42f), -8f);
            PositionController(rightController, new Vector3(0.24f, -0.46f, 0.42f), 8f);
        }

        void PositionController(Transform controller, Vector3 offset, float yawOffset)
        {
            if (controller == null || head == null) return;
            controller.position = head.TransformPoint(offset);
            controller.rotation = head.rotation * Quaternion.Euler(12f, yawOffset, 0f);
        }

        static float NormalizeAngle(float value) => value > 180f ? value - 360f : value;
    }
}
