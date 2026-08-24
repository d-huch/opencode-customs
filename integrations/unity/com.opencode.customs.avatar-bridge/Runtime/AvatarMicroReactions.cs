using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    /// <summary>Runs small local reactions without an LLM call. Animator parameters are optional.</summary>
    public sealed class AvatarMicroReactions : MonoBehaviour
    {
        public static readonly string[] SupportedGestures =
        {
            "wave", "point", "nod", "thinking", "relieved_sigh", "thoughtful_head_shake", "lengthy_nod", "acknowledge",
            "happy_gesture", "angry_gesture", "hard_nod", "annoyed_head_shake", "cocky", "yes", "no", "sarcastic_nod",
            "weight_shift", "dismiss", "look_away", "hallin",
        };

        public Animator animator;
        public string stateParameter = "AgentState";
        public string emotionParameter = "Emotion";
        public string intensityParameter = "EmotionIntensity";
        public string CurrentState { get; private set; } = "idle";
        public int CurrentAnimatorStateID => PresentationStateID(CurrentState);
        public string CurrentEmotion { get; private set; } = "neutral";
        public string CurrentGesture { get; private set; } = "—";
        Coroutine clearGestureRoutine;
        float nextReactionAt;

        public void SetState(string state)
        {
            var next = string.IsNullOrWhiteSpace(state) ? "idle" : state;
            if (CurrentState == next) return;
            CurrentState = next;
            if (animator == null || string.IsNullOrWhiteSpace(stateParameter)) return;
            if (clearGestureRoutine != null) StopCoroutine(clearGestureRoutine);
            clearGestureRoutine = null;
            ClearGesture();

            // Speaking and thinking are presentation phases, not continuous body poses.
            // Keeping AgentState at 2/3 made the Animator immediately re-enter the same
            // clip after every gesture, producing a visibly mechanical infinite loop.
            animator.SetInteger(stateParameter, CurrentAnimatorStateID);
            if ((CurrentState == "thinking" || CurrentState == "planning") && Time.unscaledTime >= nextReactionAt)
            {
                var gestures = new[] { "thinking", "thoughtful_head_shake", "look_away", "weight_shift", "nod" };
                var start = Random.Range(0, gestures.Length);
                for (var index = 0; index < gestures.Length; index++)
                    if (TriggerGesture(gestures[(start + index) % gestures.Length])) break;
                nextReactionAt = Time.unscaledTime + Random.Range(3.5f, 7f);
            }
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
            if (!HasTrigger(trigger)) return false;
            CurrentGesture = gesture.ToLowerInvariant();
            animator.SetTrigger(trigger);
            if (clearGestureRoutine != null) StopCoroutine(clearGestureRoutine);
            clearGestureRoutine = StartCoroutine(ClearGestureAfterDelay());
            return true;
        }

        public void ClearGesture() => CurrentGesture = "—";

        public static bool SupportsGesture(string gesture) => System.Array.Exists(SupportedGestures, value => string.Equals(value, gesture, System.StringComparison.OrdinalIgnoreCase));

        System.Collections.IEnumerator ClearGestureAfterDelay()
        {
            yield return new WaitForSecondsRealtime(Random.Range(1.1f, 1.8f));
            ClearGesture();
            clearGestureRoutine = null;
        }

        bool HasTrigger(string name)
        {
            foreach (var parameter in animator.parameters)
                if (parameter.type == AnimatorControllerParameterType.Trigger && parameter.name == name) return true;
            return false;
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

        static int PresentationStateID(string state)
        {
            if (state == "speaking" || state == "thinking" || state == "planning" || state == "responding") return 0;
            return StateID(state);
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
                case "relieved_sigh": return "RelievedSigh";
                case "thoughtful_head_shake": return "ThoughtfulHeadShake";
                case "lengthy_nod": return "LengthyNod";
                case "acknowledge": return "Acknowledge";
                case "happy_gesture": return "HappyGesture";
                case "angry_gesture": return "AngryGesture";
                case "hard_nod": return "HardNod";
                case "annoyed_head_shake": return "AnnoyedHeadShake";
                case "cocky": return "Cocky";
                case "yes": return "Yes";
                case "no": return "No";
                case "sarcastic_nod": return "SarcasticNod";
                case "weight_shift": return "WeightShift";
                case "dismiss": return "Dismiss";
                case "look_away": return "LookAway";
                case "hallin": return "Hallin";
                default: return null;
            }
        }
    }
}
