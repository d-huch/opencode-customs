using UnityEngine;
using UnityEngine.AI;

namespace OpenCode.Customs.AvatarBridge
{
    /// <summary>Feeds an in-place Humanoid controller from NavMesh motion.</summary>
    public sealed class AvatarLocomotionController : MonoBehaviour
    {
        public NavMeshAgent agent;
        public Animator animator;
        public string speedParameter = "Speed";
        public string angularSpeedParameter = "AngularSpeed";
        [Min(0f)] public float damping = 0.12f;

        float previousYaw;

        public float CurrentSpeed { get; private set; }
        public float CurrentAngularSpeed { get; private set; }

        void Awake()
        {
            if (agent == null) agent = GetComponentInParent<NavMeshAgent>();
            if (animator == null) animator = GetComponentInChildren<Animator>();
            if (animator != null) animator.applyRootMotion = false;
            previousYaw = transform.eulerAngles.y;
        }

        void Update()
        {
            if (agent == null || animator == null) return;
            CurrentSpeed = agent.enabled ? agent.velocity.magnitude : 0f;
            var yaw = transform.eulerAngles.y;
            CurrentAngularSpeed = Time.unscaledDeltaTime > 0f ? Mathf.DeltaAngle(previousYaw, yaw) / Time.unscaledDeltaTime : 0f;
            previousYaw = yaw;
            if (!string.IsNullOrWhiteSpace(speedParameter))
                animator.SetFloat(speedParameter, CurrentSpeed, damping, Time.deltaTime);
            if (!string.IsNullOrWhiteSpace(angularSpeedParameter))
                animator.SetFloat(angularSpeedParameter, CurrentAngularSpeed, damping, Time.deltaTime);
        }
    }
}
