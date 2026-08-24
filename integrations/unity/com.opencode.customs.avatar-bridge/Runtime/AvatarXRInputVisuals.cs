using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.XR.Hands;
using UnityEngine.XR.Interaction.Toolkit.Inputs;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarXRInputVisuals : MonoBehaviour
    {
        public GameObject leftController;
        public GameObject rightController;
        public GameObject leftHand;
        public GameObject rightHand;
        public XRInputModalityManager modalityManager;
        public bool showControllersWhenUntracked = true;
        public bool forceControllers;
        [Min(0.05f)] public float refreshInterval = 0.2f;
        [Min(0f)] public float trackingGraceSeconds = 0.75f;

        readonly List<XRHandSubsystem> handSubsystems = new();
        float nextRefresh;
        float leftTrackedAt;
        float rightTrackedAt;
        bool leftShowingHand;
        bool rightShowingHand;

        public bool LeftShowingHand => leftShowingHand;
        public bool RightShowingHand => rightShowingHand;

        void OnEnable()
        {
            InputSystem.onDeviceChange += OnDeviceChanged;
            if (modalityManager != null) modalityManager.enabled = false;
            Refresh();
        }

        void OnDisable() => InputSystem.onDeviceChange -= OnDeviceChanged;

        void Update()
        {
            if (Time.unscaledTime < nextRefresh) return;
            Refresh();
        }

        void OnDeviceChanged(InputDevice _, InputDeviceChange __) => Refresh();

        public void Refresh()
        {
            nextRefresh = Time.unscaledTime + Mathf.Max(0.05f, refreshInterval);
            handSubsystems.Clear();
            SubsystemManager.GetSubsystems(handSubsystems);
            var subsystem = handSubsystems.Find(value => value != null && value.running);
            SetSide(true, IsControllerTracked(XRController.leftHand), subsystem?.leftHand.isTracked == true);
            SetSide(false, IsControllerTracked(XRController.rightHand), subsystem?.rightHand.isTracked == true);
        }

        void SetSide(bool left, bool controllerTracked, bool handTracked)
        {
            var now = Time.unscaledTime;
            if (controllerTracked || handTracked)
            {
                if (left) leftTrackedAt = now;
                else rightTrackedAt = now;
            }

            var trackedAt = left ? leftTrackedAt : rightTrackedAt;
            var showingHand = left ? leftShowingHand : rightShowingHand;
            if (forceControllers) showingHand = false;
            else if (handTracked) showingHand = true;
            else if (controllerTracked) showingHand = false;
            else if (now - trackedAt > trackingGraceSeconds) showingHand = false;

            var showController = !showingHand && (controllerTracked || forceControllers || showControllersWhenUntracked);
            SetActive(left ? leftHand : rightHand, showingHand);
            SetActive(left ? leftController : rightController, showController);
            if (left) leftShowingHand = showingHand;
            else rightShowingHand = showingHand;
        }

        static bool IsControllerTracked(XRController controller) =>
            controller != null && controller.added && (controller.isTracked == null || controller.isTracked.isPressed);

        static void SetActive(GameObject value, bool active)
        {
            if (value != null && value.activeSelf != active) value.SetActive(active);
        }
    }
}
