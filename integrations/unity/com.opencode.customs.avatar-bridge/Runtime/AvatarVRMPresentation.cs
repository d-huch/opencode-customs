using System;
using System.Collections.Generic;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge
{
    [Serializable]
    public sealed class AvatarBlendShapeBinding
    {
        public string key;
        public string blendShape;
        [Range(0f, 100f)] public float weight = 100f;
    }

    /// <summary>
    /// Maps the shared Jarvis presentation stream to a VRM-compatible humanoid.
    /// It intentionally targets standard Animator and blend-shape APIs so the same
    /// component works with UniVRM imports and ordinary humanoid test meshes.
    /// </summary>
    public sealed class AvatarVRMPresentation : MonoBehaviour
    {
        public OpenCodeAvatarBridgeV2 bridge;
        public AvatarMicroReactions reactions;
        public SkinnedMeshRenderer face;
        public AvatarBlendShapeBinding[] visemes = Array.Empty<AvatarBlendShapeBinding>();
        public AvatarBlendShapeBinding[] emotions = Array.Empty<AvatarBlendShapeBinding>();
        [Range(1f, 30f)] public float blendSpeed = 14f;
        public bool naturalBlinking = true;
        public string leftBlinkBlendShape = "eyeBlinkLeft";
        public string rightBlinkBlendShape = "eyeBlinkRight";
        [Min(0.02f)] public float blinkDuration = 0.12f;
        public Vector2 blinkInterval = new Vector2(2.5f, 6f);

        sealed class RuntimeBinding
        {
            public int index;
            public float weight;
        }

        readonly Dictionary<string, List<RuntimeBinding>> visemeBindings = new Dictionary<string, List<RuntimeBinding>>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, List<RuntimeBinding>> emotionBindings = new Dictionary<string, List<RuntimeBinding>>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<int, float> visemeTargets = new Dictionary<int, float>();
        readonly Dictionary<int, float> emotionTargets = new Dictionary<int, float>();
        readonly HashSet<int> boundIndices = new HashSet<int>();
        int leftBlinkIndex = -1;
        int rightBlinkIndex = -1;
        float nextBlinkAt;
        float blinkStartedAt = -1f;
        float facialOverrideUntil;

        public string CurrentEmotion { get; private set; } = "neutral";
        public string LastViseme { get; private set; } = "—";

        void Awake()
        {
            if (bridge == null) bridge = GetComponentInParent<OpenCodeAvatarBridgeV2>();
            if (reactions == null) reactions = GetComponentInChildren<AvatarMicroReactions>();
            RebuildBindings();
        }

        void OnEnable()
        {
            if (bridge == null) return;
            bridge.onAssistantState?.AddListener(SetState);
            bridge.onSpeechEmotion?.AddListener(SetEmotion);
            bridge.onViseme?.AddListener(SetViseme);
        }

        void OnDisable()
        {
            if (bridge == null) return;
            bridge.onAssistantState?.RemoveListener(SetState);
            bridge.onSpeechEmotion?.RemoveListener(SetEmotion);
            bridge.onViseme?.RemoveListener(SetViseme);
        }

        void Update()
        {
            if (face == null) return;
            foreach (var index in boundIndices)
            {
                var viseme = visemeTargets.TryGetValue(index, out var visemeValue) ? visemeValue : 0f;
                var emotion = emotionTargets.TryGetValue(index, out var emotionValue) ? emotionValue : 0f;
                UpdateBlend(index, Mathf.Max(viseme, emotion));
            }
            UpdateBlink();
        }

        public void SetState(string state) => reactions?.SetState(state);

        public void SetEmotion(string emotion, float intensity)
        {
            reactions?.SetEmotion(emotion, intensity);
            CurrentEmotion = string.IsNullOrWhiteSpace(emotion) ? "neutral" : emotion;
            ClearTargets(emotionTargets);
            Apply(CurrentEmotion, Mathf.Clamp01(intensity), emotionBindings, emotionTargets);
            facialOverrideUntil = Time.unscaledTime + 0.35f;
        }

        public void SetViseme(string shape, float intensity)
        {
            ClearTargets(visemeTargets);
            LastViseme = string.IsNullOrWhiteSpace(shape) ? "—" : shape;
            if (!string.IsNullOrWhiteSpace(shape)) Apply(shape, Mathf.Clamp01(intensity), visemeBindings, visemeTargets);
            else if (face != null)
                foreach (var index in visemeTargets.Keys)
                    face.SetBlendShapeWeight(index, emotionTargets.TryGetValue(index, out var emotion) ? emotion : 0f);
            facialOverrideUntil = Time.unscaledTime + 0.08f;
        }

        public void ResetFace()
        {
            ClearTargets(visemeTargets);
            ClearTargets(emotionTargets);
            LastViseme = "—";
            CurrentEmotion = "neutral";
            reactions?.SetEmotion("neutral", 0f);
            if (face != null) foreach (var index in boundIndices) face.SetBlendShapeWeight(index, 0f);
        }

        public void RebuildBindings()
        {
            visemeBindings.Clear();
            emotionBindings.Clear();
            visemeTargets.Clear();
            emotionTargets.Clear();
            boundIndices.Clear();
            if (face == null || face.sharedMesh == null) return;
            BuildBindings(visemes, visemeBindings, visemeTargets);
            BuildBindings(emotions, emotionBindings, emotionTargets);
            leftBlinkIndex = face.sharedMesh.GetBlendShapeIndex(leftBlinkBlendShape);
            rightBlinkIndex = face.sharedMesh.GetBlendShapeIndex(rightBlinkBlendShape);
            ScheduleBlink();
        }

        void BuildBindings(AvatarBlendShapeBinding[] bindings, Dictionary<string, List<RuntimeBinding>> output, Dictionary<int, float> targets)
        {
            foreach (var binding in bindings)
            {
                if (binding == null || string.IsNullOrWhiteSpace(binding.key) || string.IsNullOrWhiteSpace(binding.blendShape)) continue;
                var index = face.sharedMesh.GetBlendShapeIndex(binding.blendShape);
                if (index < 0) continue;
                if (!output.TryGetValue(binding.key, out var values))
                {
                    values = new List<RuntimeBinding>();
                    output.Add(binding.key, values);
                }
                values.Add(new RuntimeBinding { index = index, weight = binding.weight });
                targets[index] = 0f;
                boundIndices.Add(index);
            }
        }

        static void Apply(string key, float intensity, Dictionary<string, List<RuntimeBinding>> bindings, Dictionary<int, float> targets)
        {
            if (!bindings.TryGetValue(key, out var values)) return;
            foreach (var binding in values) targets[binding.index] = Mathf.Max(targets[binding.index], binding.weight * intensity);
        }

        static void ClearTargets(Dictionary<int, float> targets)
        {
            foreach (var index in new List<int>(targets.Keys)) targets[index] = 0f;
        }

        void UpdateBlend(int index, float target)
        {
            var current = face.GetBlendShapeWeight(index);
            face.SetBlendShapeWeight(index, Mathf.MoveTowards(current, target, blendSpeed * 100f * Time.unscaledDeltaTime));
            if (visemeTargets.TryGetValue(index, out var viseme) && viseme > 0f)
                visemeTargets[index] = Mathf.MoveTowards(viseme, 0f, blendSpeed * 35f * Time.unscaledDeltaTime);
        }

        void UpdateBlink()
        {
            if (!naturalBlinking || leftBlinkIndex < 0 || rightBlinkIndex < 0) return;
            if (blinkStartedAt < 0f && Time.unscaledTime >= nextBlinkAt && Time.unscaledTime >= facialOverrideUntil)
                blinkStartedAt = Time.unscaledTime;
            if (blinkStartedAt < 0f) return;
            var progress = Mathf.Clamp01((Time.unscaledTime - blinkStartedAt) / blinkDuration);
            var weight = Mathf.Sin(progress * Mathf.PI) * 100f;
            face.SetBlendShapeWeight(leftBlinkIndex, weight);
            face.SetBlendShapeWeight(rightBlinkIndex, weight);
            if (progress < 1f) return;
            blinkStartedAt = -1f;
            face.SetBlendShapeWeight(leftBlinkIndex, 0f);
            face.SetBlendShapeWeight(rightBlinkIndex, 0f);
            ScheduleBlink();
        }

        void ScheduleBlink()
        {
            nextBlinkAt = Time.unscaledTime + UnityEngine.Random.Range(Mathf.Max(0.2f, blinkInterval.x), Mathf.Max(blinkInterval.x, blinkInterval.y));
        }
    }
}
