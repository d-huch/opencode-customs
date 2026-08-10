using UnityEngine;

namespace Evaluation.Health
{
    public sealed class PlayerHealth : MonoBehaviour
    {
        [SerializeField] private int maximum = 100;
        public int Current { get; private set; }

        private void Awake() => Current = maximum;

        public void ApplyDamage(int amount)
        {
            Current = Mathf.Max(0, Current - amount);
            HealthEvents.Publish(Current, maximum);
        }
    }
}
