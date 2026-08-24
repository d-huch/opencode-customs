using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarChatPanel : MonoBehaviour
    {
        public const string FirstTestPrompt = "Привіт, Джарвісе!";
        public const string SecondTestPrompt = "Що ти бачиш у цій кімнаті?";

        public OpenCodeAvatarBridgeV2 bridge;
        public AvatarVRKeyboard keyboard;
        public Transform viewer;
        public Key toggleKey = Key.C;
        [Range(1, 50)] public int maximumMessages = 20;

        readonly List<ChatMessage> messages = new List<ChatMessage>();
        Canvas canvas;
        ScrollRect scroll;
        TextMeshProUGUI history;
        TextMeshProUGUI status;
        bool subscribed;
        ChatMessage pendingAssistant;

        public bool IsVisible => canvas != null && canvas.gameObject.activeSelf;
        public int MessageCount => messages.Count;
        public string RenderedHistory => history == null ? string.Empty : history.text;

        void Start()
        {
            if (bridge == null) bridge = FindAnyObjectByType<OpenCodeAvatarBridgeV2>();
            if (viewer == null && Camera.main != null) viewer = Camera.main.transform;
            Build();
            Subscribe();
            Hide();
        }

        void OnEnable() => Subscribe();

        void OnDisable()
        {
            if (!subscribed || bridge == null) return;
            bridge.onConnected?.RemoveListener(OnConnected);
            bridge.onUserText?.RemoveListener(AddUserMessage);
            bridge.onAssistantText?.RemoveListener(AddAssistantMessage);
            bridge.onAssistantDelta?.RemoveListener(AppendAssistantDelta);
            bridge.onAssistantState?.RemoveListener(SetAssistantState);
            bridge.onError?.RemoveListener(ShowError);
            subscribed = false;
        }

        void Update()
        {
            if (Keyboard.current?[toggleKey].wasPressedThisFrame == true) Toggle();
        }

        public void Toggle()
        {
            if (IsVisible) Hide();
            else Show();
        }

        public void Show()
        {
            if (canvas == null) Build();
            if (viewer == null && Camera.main != null) viewer = Camera.main.transform;
            if (viewer != null)
            {
                canvas.transform.position = viewer.position + viewer.forward * 1.3f + Vector3.up * 0.42f;
                AvatarWorldUI.FaceViewer(canvas.transform, viewer);
            }
            canvas.gameObject.SetActive(true);
            SetStatus(bridge != null && bridge.IsConnected ? "Готовий до листування" : "Очікування з’єднання…", false);
            ScrollToLatest();
        }

        public void Hide()
        {
            if (canvas != null) canvas.gameObject.SetActive(false);
        }

        public void SendTestPrompt(string text)
        {
            Show();
            if (bridge == null || !bridge.IsConnected)
            {
                ShowError("Немає з’єднання з OpenCode Customs.");
                return;
            }
            bridge.SubmitTypedText(text);
        }

        public void ClearHistory()
        {
            messages.Clear();
            RefreshHistory();
        }

        public void ShowError(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            Show();
            AddMessage("system", value.Trim());
            SetStatus("Помилка", true);
        }

        void OnConnected(string _) => SetStatus("Готовий до листування", false);

        void AddUserMessage(string value)
        {
            AddMessage("user", value);
            pendingAssistant = null;
            SetStatus("Jarvis друкує…", false);
        }

        void AddAssistantMessage(string value)
        {
            if (pendingAssistant == null) AddMessage("assistant", value);
            else
            {
                pendingAssistant.text = string.IsNullOrWhiteSpace(value) ? pendingAssistant.text : value.Trim();
                pendingAssistant = null;
                RefreshHistory();
            }
            SetStatus("Готовий до листування", false);
        }

        void AppendAssistantDelta(string value)
        {
            if (string.IsNullOrEmpty(value)) return;
            if (pendingAssistant == null)
            {
                pendingAssistant = new ChatMessage { role = "assistant", text = string.Empty };
                messages.Add(pendingAssistant);
                while (messages.Count > Mathf.Max(1, maximumMessages)) messages.RemoveAt(0);
            }
            pendingAssistant.text += value;
            RefreshHistory();
            SetStatus("Jarvis відповідає…", false);
        }

        void SetAssistantState(string value)
        {
            if (value == "thinking" || value == "planning") SetStatus("Jarvis думає…", false);
            if (value == "responding") SetStatus("Jarvis відповідає…", false);
            if (value == "idle" || value == "listening") SetStatus("Готовий до листування", false);
            if (value == "uncertain" || value == "error") SetStatus("Не вдалося отримати відповідь", true);
        }

        void AddMessage(string role, string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            var clean = value.Trim();
            if (messages.Count > 0 && messages[messages.Count - 1].role == role && messages[messages.Count - 1].text == clean) return;
            messages.Add(new ChatMessage { role = role, text = clean });
            while (messages.Count > Mathf.Max(1, maximumMessages)) messages.RemoveAt(0);
            RefreshHistory();
        }

        void RefreshHistory()
        {
            if (history == null) return;
            if (messages.Count == 0)
            {
                history.text = "<color=#8792A8>Оберіть тестову репліку або введіть власний текст.</color>";
                ScrollToLatest();
                return;
            }
            var lines = new List<string>();
            foreach (var message in messages)
            {
                var label = message.role == "user" ? "ВИ" : message.role == "assistant" ? "JARVIS" : "СИСТЕМА";
                var color = message.role == "user" ? "#5EE3E6" : message.role == "assistant" ? "#FFFFFF" : "#FF918C";
                lines.Add("<color=" + color + "><b>" + label + "</b></color>\n" + Escape(message.text));
            }
            history.text = string.Join("\n\n", lines);
            ScrollToLatest();
        }

        void ScrollToLatest()
        {
            if (scroll == null) return;
            Canvas.ForceUpdateCanvases();
            scroll.verticalNormalizedPosition = 0f;
        }

        void SetStatus(string value, bool failed)
        {
            if (status == null) return;
            status.text = value;
            status.color = failed ? new Color(1f, 0.5f, 0.48f) : new Color(0.45f, 0.88f, 0.9f);
        }

        void Subscribe()
        {
            if (subscribed || bridge == null) return;
            bridge.onConnected ??= new AvatarStringEvent();
            bridge.onUserText ??= new AvatarStringEvent();
            bridge.onAssistantText ??= new AvatarStringEvent();
            bridge.onAssistantDelta ??= new AvatarStringEvent();
            bridge.onAssistantState ??= new AvatarStringEvent();
            bridge.onError ??= new AvatarStringEvent();
            bridge.onConnected.AddListener(OnConnected);
            bridge.onUserText.AddListener(AddUserMessage);
            bridge.onAssistantText.AddListener(AddAssistantMessage);
            bridge.onAssistantDelta.AddListener(AppendAssistantDelta);
            bridge.onAssistantState.AddListener(SetAssistantState);
            bridge.onError.AddListener(ShowError);
            subscribed = true;
        }

        void Build()
        {
            if (canvas != null) return;
            canvas = AvatarWorldUI.CreateCanvas("Jarvis Chat Panel", transform, new Vector2(760f, 620f), 0.00125f);
            var panel = AvatarWorldUI.Image("Chat Panel", canvas.transform, new Color(0.045f, 0.055f, 0.08f, 0.97f),
                Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            var outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(0.1f, 0.82f, 0.84f, 0.8f);
            outline.effectDistance = new Vector2(2f, -2f);
            AvatarWorldUI.Text("Title", panel.transform, "ЧАТ ІЗ JARVIS", 24f, Color.white, TextAlignmentOptions.Left,
                Vector2.zero, Vector2.zero, new Vector2(28f, 558f), new Vector2(420f, 603f));
            status = AvatarWorldUI.Text("Status", panel.transform, "Очікування з’єднання…", 17f, new Color(0.45f, 0.88f, 0.9f), TextAlignmentOptions.Right,
                Vector2.zero, Vector2.zero, new Vector2(420f, 558f), new Vector2(732f, 603f));

            var viewport = AvatarWorldUI.Image("History Viewport", panel.transform, new Color(0.075f, 0.088f, 0.12f, 1f),
                Vector2.zero, Vector2.zero, new Vector2(24f, 176f), new Vector2(736f, 548f));
            var mask = viewport.gameObject.AddComponent<Mask>();
            mask.showMaskGraphic = true;
            history = AvatarWorldUI.Text("History", viewport.transform, string.Empty, 20f, new Color(0.82f, 0.85f, 0.91f), TextAlignmentOptions.TopLeft,
                new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(18f, 0f), new Vector2(-18f, 0f));
            history.rectTransform.pivot = new Vector2(0.5f, 1f);
            history.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll = viewport.gameObject.AddComponent<ScrollRect>();
            scroll.viewport = viewport.rectTransform;
            scroll.content = history.rectTransform;
            scroll.horizontal = false;
            scroll.vertical = true;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 24f;

            AvatarWorldUI.Button("Test Prompt One", panel.transform, FirstTestPrompt, new Color(0.12f, 0.3f, 0.38f, 1f), () => SendTestPrompt(FirstTestPrompt),
                Vector2.zero, Vector2.zero, new Vector2(24f, 108f), new Vector2(368f, 162f));
            AvatarWorldUI.Button("Test Prompt Two", panel.transform, SecondTestPrompt, new Color(0.12f, 0.3f, 0.38f, 1f), () => SendTestPrompt(SecondTestPrompt),
                Vector2.zero, Vector2.zero, new Vector2(376f, 108f), new Vector2(736f, 162f));
            AvatarWorldUI.Button("Keyboard", panel.transform, "Клавіатура", new Color(0.08f, 0.56f, 0.59f, 1f), () => keyboard?.Show(),
                Vector2.zero, Vector2.zero, new Vector2(24f, 28f), new Vector2(298f, 88f));
            AvatarWorldUI.Button("Clear", panel.transform, "Очистити", new Color(0.16f, 0.18f, 0.24f, 1f), ClearHistory,
                Vector2.zero, Vector2.zero, new Vector2(312f, 28f), new Vector2(566f, 88f));
            AvatarWorldUI.Button("Close", panel.transform, "Закрити", new Color(0.24f, 0.17f, 0.22f, 1f), Hide,
                Vector2.zero, Vector2.zero, new Vector2(580f, 28f), new Vector2(736f, 88f));
            RefreshHistory();
        }

        static string Escape(string value) => value.Replace("<", "＜").Replace(">", "＞");

        sealed class ChatMessage
        {
            public string role;
            public string text;
        }
    }
}
