using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarSpeechBubble : MonoBehaviour
    {
        public OpenCodeAvatarBridgeV2 bridge;
        public Transform head;
        public Transform viewer;
        public Vector3 worldOffset = new Vector3(0f, 0.48f, 0f);
        [Min(1f)] public float visibleSeconds = 8f;
        [Min(40)] public int maximumCharacters = 320;

        Canvas canvas;
        CanvasGroup group;
        TextMeshProUGUI message;
        float hideAt;
        bool subscribed;

        void Start()
        {
            if (bridge == null) bridge = GetComponentInParent<OpenCodeAvatarBridgeV2>();
            if (viewer == null && Camera.main != null) viewer = Camera.main.transform;
            Build();
            Subscribe();
            HideImmediate();
        }

        void OnEnable() => Subscribe();

        void OnDisable()
        {
            if (!subscribed || bridge == null) return;
            bridge.onAssistantText?.RemoveListener(Show);
            bridge.onAssistantState?.RemoveListener(SetState);
            subscribed = false;
        }

        void LateUpdate()
        {
            if (canvas == null || head == null) return;
            canvas.transform.position = head.position + worldOffset;
            AvatarWorldUI.FaceViewer(canvas.transform, viewer);
            if (group.alpha <= 0f || Time.unscaledTime <= hideAt) return;
            group.alpha = Mathf.MoveTowards(group.alpha, 0f, Time.unscaledDeltaTime * 2.5f);
            if (group.alpha <= 0.01f) canvas.gameObject.SetActive(false);
        }

        public void Show(string value)
        {
            if (canvas == null) Build();
            if (string.IsNullOrWhiteSpace(value) || message == null) return;
            var clean = value.Trim();
            message.text = clean.Length <= maximumCharacters ? clean : clean.Substring(0, maximumCharacters - 1) + "…";
            canvas.gameObject.SetActive(true);
            group.alpha = 1f;
            hideAt = Time.unscaledTime + visibleSeconds;
        }

        void SetState(string state)
        {
            if (canvas == null) Build();
            if ((state == "thinking" || state == "planning") && (message == null || !canvas.gameObject.activeSelf)) Show("…");
            if (state == "error") Show("Не вдалося завершити відповідь.");
        }

        void Subscribe()
        {
            if (subscribed || bridge == null) return;
            bridge.onAssistantText ??= new AvatarStringEvent();
            bridge.onAssistantState ??= new AvatarStringEvent();
            bridge.onAssistantText.AddListener(Show);
            bridge.onAssistantState.AddListener(SetState);
            subscribed = true;
        }

        void Build()
        {
            if (canvas != null) return;
            canvas = AvatarWorldUI.CreateCanvas("Comic Speech Bubble", transform, new Vector2(460f, 190f), 0.0018f);
            group = canvas.gameObject.AddComponent<CanvasGroup>();
            var tail = AvatarWorldUI.Image("Bubble Tail", canvas.transform, new Color(0.96f, 0.95f, 0.91f, 1f),
                new Vector2(0.43f, 0f), new Vector2(0.57f, 0f), new Vector2(0f, -20f), new Vector2(0f, 20f));
            tail.rectTransform.sizeDelta = new Vector2(42f, 42f);
            tail.rectTransform.localRotation = Quaternion.Euler(0f, 0f, 45f);
            var panel = AvatarWorldUI.Image("Bubble", canvas.transform, new Color(0.96f, 0.95f, 0.91f, 1f),
                Vector2.zero, Vector2.one, new Vector2(8f, 12f), new Vector2(-8f, -12f));
            var outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.08f, 0.08f, 0.1f, 0.95f);
            outline.effectDistance = new Vector2(4f, -4f);
            AvatarWorldUI.Text("Speaker", panel.transform, "JARVIS", 18f, new Color(0.14f, 0.55f, 0.58f), TextAlignmentOptions.TopLeft,
                new Vector2(0f, 0.72f), new Vector2(1f, 1f), new Vector2(24f, 0f), new Vector2(-24f, -12f));
            message = AvatarWorldUI.Text("Message", panel.transform, string.Empty, 27f, new Color(0.08f, 0.08f, 0.1f), TextAlignmentOptions.MidlineLeft,
                new Vector2(0f, 0f), new Vector2(1f, 0.76f), new Vector2(24f, 16f), new Vector2(-24f, 0f));
        }

        void HideImmediate()
        {
            if (group != null) group.alpha = 0f;
            if (canvas != null) canvas.gameObject.SetActive(false);
        }
    }
}
