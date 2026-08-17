using UnityEngine;

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

        public void LookAt(Vector3 position)
        {
            if (headLookTarget != null) headLookTarget.position = position;
        }

        public void PointAt(Vector3 position, bool leftHand)
        {
            var target = leftHand ? leftHandTarget : rightHandTarget;
            if (target != null) target.position = position;
        }
    }
}
