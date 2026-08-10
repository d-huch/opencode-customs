using Evaluation.Health;
using UnityEngine;
using UnityEngine.UI;

namespace Evaluation.UI
{
    public sealed class HealthBar : MonoBehaviour
    {
        [SerializeField] private Slider slider;

        private void OnEnable() => HealthEvents.Changed += UpdateValue;
        private void OnDisable() => HealthEvents.Changed -= UpdateValue;
        private void UpdateValue(int current, int maximum) => slider.value = (float)current / maximum;
    }
}
