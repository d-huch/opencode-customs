using UnityEngine;
using UnityEngine.Animations.Rigging;

namespace OpenCode.Customs.AvatarBridge
{
    /// <summary>
    /// Stable targets for Unity Animation Rigging constraints. Assign headLookTarget to a
    /// Multi-Aim Constraint and hand targets to Two-Bone IK constraints in the character rig.
    /// The Bridge moves targets only; the project's rig keeps ownership of weights and anatomy.
    /// </summary>
    public sealed class AvatarRigTargets : MonoBehaviour
    {
        public Transform headLookTarget;
        public Transform leftHandTarget;
        public Transform rightHandTarget;
        public Transform defaultLookTarget;
        public Rig headRig;
        public Rig leftHandRig;
        public Rig rightHandRig;
        [Min(0.1f)] public float lookOverrideSeconds = 3f;
        [Min(0.1f)] public float pointHoldSeconds = 2.5f;
        [Min(0.1f)] public float targetSmoothing = 12f;

        Vector3 desiredLookPosition;
        Vector3 desiredLeftHandPosition;
        Vector3 desiredRightHandPosition;
        float lookOverrideUntil;
        float leftPointUntil;
        float rightPointUntil;

        public string CurrentGazeTarget { get; private set; } = "player";
        public string ActiveGesture { get; private set; } = "—";

        void Awake()
        {
            desiredLookPosition = headLookTarget != null ? headLookTarget.position : transform.position + transform.forward * 2f;
            desiredLeftHandPosition = leftHandTarget != null ? leftHandTarget.position : transform.position;
            desiredRightHandPosition = rightHandTarget != null ? rightHandTarget.position : transform.position;
        }

        void LateUpdate()
        {
            var delta = 1f - Mathf.Exp(-targetSmoothing * Time.unscaledDeltaTime);
            if (Time.unscaledTime >= lookOverrideUntil && defaultLookTarget != null)
            {
                desiredLookPosition = defaultLookTarget.position;
                CurrentGazeTarget = "player";
            }
            if (headLookTarget != null) headLookTarget.position = Vector3.Lerp(headLookTarget.position, desiredLookPosition, delta);
            if (leftHandTarget != null) leftHandTarget.position = Vector3.Lerp(leftHandTarget.position, desiredLeftHandPosition, delta);
            if (rightHandTarget != null) rightHandTarget.position = Vector3.Lerp(rightHandTarget.position, desiredRightHandPosition, delta);
            if (headRig != null) headRig.weight = Mathf.MoveTowards(headRig.weight, 1f, delta);
            UpdateHandRig(leftHandRig, Time.unscaledTime < leftPointUntil, delta);
            UpdateHandRig(rightHandRig, Time.unscaledTime < rightPointUntil, delta);
            if (Time.unscaledTime >= leftPointUntil && Time.unscaledTime >= rightPointUntil) ActiveGesture = "—";
        }

        public void LookAt(Vector3 position)
        {
            desiredLookPosition = position;
            lookOverrideUntil = Time.unscaledTime + lookOverrideSeconds;
            CurrentGazeTarget = position.ToString("F2");
        }

        public void PointAt(Vector3 position, bool leftHand)
        {
            if (leftHand)
            {
                desiredLeftHandPosition = position;
                leftPointUntil = Time.unscaledTime + pointHoldSeconds;
            }
            else
            {
                desiredRightHandPosition = position;
                rightPointUntil = Time.unscaledTime + pointHoldSeconds;
            }
            ActiveGesture = leftHand ? "point-left" : "point-right";
        }

        public void ResetOverrides()
        {
            lookOverrideUntil = 0f;
            leftPointUntil = 0f;
            rightPointUntil = 0f;
            ActiveGesture = "—";
        }

        static void UpdateHandRig(Rig rig, bool active, float delta)
        {
            if (rig != null) rig.weight = Mathf.MoveTowards(rig.weight, active ? 1f : 0f, delta);
        }
    }
}
