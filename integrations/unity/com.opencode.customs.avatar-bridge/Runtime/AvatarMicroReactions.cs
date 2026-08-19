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
        public string CurrentState { get; private set; } = "idle";
        public string CurrentEmotion { get; private set; } = "neutral";
        public string CurrentGesture { get; private set; } = "—";

        public void SetState(string state)
        {
            CurrentState = string.IsNullOrWhiteSpace(state) ? "idle" : state;
            if (animator == null || string.IsNullOrWhiteSpace(stateParameter)) return;
            animator.SetInteger(stateParameter, StateID(CurrentState));
        }

        public void SetEmotion(string emotion, float intensity)
        {
            CurrentEmotion = string.IsNullOrWhiteSpace(emotion) ? "neutral" : emotion;
            if (animator == null) return;
            if (!string.IsNullOrWhiteSpace(emotionParameter)) animator.SetInteger(emotionParameter, Animator.StringToHash(CurrentEmotion));
            if (!string.IsNullOrWhiteSpace(intensityParameter)) animator.SetFloat(intensityParameter, Mathf.Clamp01(intensity), 0.12f, Time.unscaledDeltaTime);
        }

        public bool TriggerGesture(string gesture)
        {
            var trigger = GestureTrigger(gesture);
            if (trigger == null || animator == null) return false;
            CurrentGesture = gesture.ToLowerInvariant();
            animator.SetTrigger(trigger);
            StopAllCoroutines();
            StartCoroutine(ClearGestureAfterDelay());
            return true;
        }

        public void ClearGesture() => CurrentGesture = "—";

        System.Collections.IEnumerator ClearGestureAfterDelay()
        {
            yield return new WaitForSecondsRealtime(3f);
            ClearGesture();
        }

        static int StateID(string state)
        {
            switch (state)
            {
                case "listening": return 1;
                case "thinking": return 2;
                case "planning": return 2;
                case "speaking": return 3;
                case "acting": return 5;
                case "uncertain": return 4;
                case "error": return 6;
                case "success": return 5;
                case "danger": return 6;
                default: return 0;
            }
        }

        static string GestureTrigger(string gesture)
        {
            if (string.IsNullOrWhiteSpace(gesture)) return null;
            switch (gesture.ToLowerInvariant())
            {
                case "wave": return "Wave";
                case "point": return "Point";
                case "nod": return "Nod";
                case "thinking": return "Thinking";
                default: return null;
            }
        }
    }
}
