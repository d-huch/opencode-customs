using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    /// <summary>Runs small local reactions without an LLM call. Animator parameters are optional.</summary>
    public sealed class AvatarMicroReactions : MonoBehaviour
    {
        public Animator animator;
        public string stateParameter = "AgentState";
        public string emotionParameter = "Emotion";
        public string intensityParameter = "EmotionIntensity";

        public void SetState(string state)
        {
            if (animator == null || string.IsNullOrWhiteSpace(stateParameter)) return;
            animator.SetInteger(stateParameter, StateID(state));
        }

        public void SetEmotion(string emotion, float intensity)
        {
            if (animator == null) return;
            if (!string.IsNullOrWhiteSpace(emotionParameter)) animator.SetInteger(emotionParameter, Animator.StringToHash(emotion ?? "neutral"));
            if (!string.IsNullOrWhiteSpace(intensityParameter)) animator.SetFloat(intensityParameter, Mathf.Clamp01(intensity), 0.12f, Time.unscaledDeltaTime);
        }

        static int StateID(string state)
        {
            switch (state)
            {
                case "listening": return 1;
                case "thinking": return 2;
                case "speaking": return 3;
                case "uncertain": return 4;
                case "success": return 5;
                case "danger": return 6;
                default: return 0;
            }
        }
    }
}
