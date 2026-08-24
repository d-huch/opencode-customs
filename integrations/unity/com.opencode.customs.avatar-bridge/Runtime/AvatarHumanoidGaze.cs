using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarHumanoidGaze : MonoBehaviour
    {
        public Animator animator;
        public Transform defaultTarget;
        [Range(0f, 180f)] public float maximumYaw = 75f;
        [Range(0f, 90f)] public float maximumPitchUp = 45f;
        [Range(0f, 90f)] public float maximumPitchDown = 35f;
        [Min(0.1f)] public float minimumDistance = 0.5f;
        [Min(0.1f)] public float smoothing = 10f;
        [Range(0f, 1f)] public float bodyWeight = 0.08f;
        [Range(0f, 1f)] public float headWeight = 0.75f;
        [Range(0f, 1f)] public float eyesWeight = 0.35f;
        [Range(0f, 1f)] public float clampWeight = 0.7f;

        Vector3 desiredPosition;
        Vector3 smoothedPosition;
        float overrideUntil;
        float currentWeight;

        public string CurrentTarget { get; private set; } = "player";

        void Awake()
        {
            if (animator == null) animator = GetComponentInChildren<Animator>(true);
            desiredPosition = ResolveDefaultPosition();
            smoothedPosition = desiredPosition;
        }

        void Update()
        {
            if (Time.unscaledTime >= overrideUntil)
            {
                desiredPosition = ResolveDefaultPosition();
                CurrentTarget = "player";
            }
            desiredPosition = Constrain(desiredPosition);
            var delta = 1f - Mathf.Exp(-smoothing * Time.unscaledDeltaTime);
            smoothedPosition = Vector3.Lerp(smoothedPosition, desiredPosition, delta);
            currentWeight = Mathf.MoveTowards(currentWeight, 1f, delta);
        }

        void OnAnimatorIK(int layerIndex)
        {
            if (animator == null || !animator.isHuman || layerIndex != 0) return;
            animator.SetLookAtWeight(currentWeight, bodyWeight, headWeight, eyesWeight, clampWeight);
            animator.SetLookAtPosition(smoothedPosition);
        }

        public void LookAt(Vector3 position, float seconds)
        {
            if (!IsFinite(position)) return;
            desiredPosition = position;
            overrideUntil = Time.unscaledTime + Mathf.Max(0.1f, seconds);
            CurrentTarget = position.ToString("F2");
        }

        public void ResetTarget()
        {
            overrideUntil = 0f;
            desiredPosition = ResolveDefaultPosition();
            CurrentTarget = "player";
        }

        Vector3 ResolveDefaultPosition()
        {
            if (defaultTarget != null && IsFinite(defaultTarget.position)) return defaultTarget.position;
            var head = animator != null && animator.isHuman ? animator.GetBoneTransform(HumanBodyBones.Head) : null;
            var origin = head != null ? head.position : transform.position + Vector3.up * 1.6f;
            return origin + transform.forward * 2f;
        }

        Vector3 Constrain(Vector3 position)
        {
            var head = animator != null && animator.isHuman ? animator.GetBoneTransform(HumanBodyBones.Head) : null;
            var origin = head != null ? head.position : transform.position + Vector3.up * 1.6f;
            var direction = position - origin;
            if (!IsFinite(direction) || direction.sqrMagnitude < minimumDistance * minimumDistance)
                direction = transform.forward * minimumDistance;

            var local = transform.InverseTransformDirection(direction.normalized);
            var yaw = Mathf.Clamp(Mathf.Atan2(local.x, local.z) * Mathf.Rad2Deg, -maximumYaw, maximumYaw);
            var horizontal = Mathf.Max(0.001f, new Vector2(local.x, local.z).magnitude);
            var pitch = Mathf.Clamp(Mathf.Atan2(local.y, horizontal) * Mathf.Rad2Deg, -maximumPitchDown, maximumPitchUp);
            var rotation = transform.rotation * Quaternion.Euler(-pitch, yaw, 0f);
            return origin + rotation * Vector3.forward * Mathf.Max(minimumDistance, direction.magnitude);
        }

        static bool IsFinite(Vector3 value) =>
            !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
            !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
            !float.IsNaN(value.z) && !float.IsInfinity(value.z);
    }
}
