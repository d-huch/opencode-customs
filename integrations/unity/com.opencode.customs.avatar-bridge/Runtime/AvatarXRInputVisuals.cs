using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace OpenCode.Customs.AvatarBridge
{
    public sealed class AvatarXRInputVisuals : MonoBehaviour
    {
        public GameObject leftController;
        public GameObject rightController;
        public GameObject leftHand;
        public GameObject rightHand;
        public bool showControllersWhenUntracked = true;
        public float refreshInterval = 0.2f;

        readonly List<InputDevice> devices = new();
        float nextRefresh;

        void OnEnable()
        {
            InputDevices.deviceConnected += OnDeviceChanged;
            InputDevices.deviceDisconnected += OnDeviceChanged;
            Refresh();
        }

        void OnDisable()
        {
            InputDevices.deviceConnected -= OnDeviceChanged;
            InputDevices.deviceDisconnected -= OnDeviceChanged;
        }

        void Update()
        {
            if (Time.unscaledTime < nextRefresh) return;
            Refresh();
        }

        void OnDeviceChanged(InputDevice _) => Refresh();

        void Refresh()
        {
            nextRefresh = Time.unscaledTime + Mathf.Max(0.05f, refreshInterval);
            SetSide(InputDeviceCharacteristics.Left, leftController, leftHand);
            SetSide(InputDeviceCharacteristics.Right, rightController, rightHand);
        }

        void SetSide(InputDeviceCharacteristics side, GameObject controller, GameObject hand)
        {
            var handTracked = IsTracked(side | InputDeviceCharacteristics.HandTracking);
            var controllerTracked = IsTracked(side | InputDeviceCharacteristics.Controller);
            SetActive(hand, handTracked);
            SetActive(controller, !handTracked && (controllerTracked || showControllersWhenUntracked));
        }

        bool IsTracked(InputDeviceCharacteristics characteristics)
        {
            devices.Clear();
            InputDevices.GetDevicesWithCharacteristics(characteristics, devices);
            return devices.Exists(device => device.isValid &&
                (!device.TryGetFeatureValue(CommonUsages.isTracked, out var tracked) || tracked));
        }

        static void SetActive(GameObject value, bool active)
        {
            if (value != null && value.activeSelf != active) value.SetActive(active);
        }
    }
}
