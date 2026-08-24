using System;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace OpenCode.Customs.AvatarBridge
{
    [DisallowMultipleComponent]
    public sealed class AvatarVRKeyboard : MonoBehaviour
    {
        static readonly string[][] Ukrainian =
        {
            new[] { "Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х", "Ї" },
            new[] { "Ф", "І", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Є" },
            new[] { "Я", "Ч", "С", "М", "И", "Т", "Ь", "Б", "Ю", ".", ",", "?" },
        };
        static readonly string[][] English =
        {
            new[] { "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P" },
            new[] { "A", "S", "D", "F", "G", "H", "J", "K", "L" },
            new[] { "Z", "X", "C", "V", "B", "N", "M", ".", ",", "?" },
        };

        public OpenCodeAvatarBridgeV2 bridge;
        public AvatarChatPanel chatPanel;
        public Transform viewer;
        public Key toggleKey = Key.K;
        [Min(40)] public int maximumCharacters = 500;
        public bool hideAfterSend;

        Canvas canvas;
        TextMeshProUGUI input;
        TextMeshProUGUI layoutLabel;
        RectTransform keysRoot;
        string value = string.Empty;
        bool ukrainian = true;
        bool uppercase;

        public bool IsVisible => canvas != null && canvas.gameObject.activeSelf;

        void Start()
        {
            if (bridge == null) bridge = FindAnyObjectByType<OpenCodeAvatarBridgeV2>();
            if (viewer == null && Camera.main != null) viewer = Camera.main.transform;
            Build();
            Hide();
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
                canvas.transform.position = viewer.position + viewer.forward * 1.15f - Vector3.up * 0.34f;
                AvatarWorldUI.FaceViewer(canvas.transform, viewer);
            }
            canvas.gameObject.SetActive(true);
            chatPanel?.Show();
            RefreshInput();
        }

        public void Hide()
        {
            if (canvas != null) canvas.gameObject.SetActive(false);
        }

        void Build()
        {
            if (canvas != null) return;
            canvas = AvatarWorldUI.CreateCanvas("Jarvis VR Keyboard", transform, new Vector2(900f, 450f), 0.00145f);
            var panel = AvatarWorldUI.Image("Keyboard Panel", canvas.transform, new Color(0.055f, 0.065f, 0.09f, 0.97f),
                Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            panel.gameObject.AddComponent<Outline>().effectColor = new Color(0.1f, 0.82f, 0.84f, 0.8f);
            layoutLabel = AvatarWorldUI.Text("Layout", panel.transform, "UK", 18f, new Color(0.4f, 0.9f, 0.92f), TextAlignmentOptions.TopRight,
                new Vector2(0.86f, 0.84f), new Vector2(0.98f, 0.98f), Vector2.zero, Vector2.zero);
            input = AvatarWorldUI.Text("Input", panel.transform, string.Empty, 27f, Color.white, TextAlignmentOptions.MidlineLeft,
                new Vector2(0.03f, 0.79f), new Vector2(0.85f, 0.96f), new Vector2(12f, 4f), new Vector2(-8f, -4f));
            var inputBackground = AvatarWorldUI.Image("Input Background", panel.transform, new Color(0.11f, 0.13f, 0.18f, 1f),
                new Vector2(0.025f, 0.78f), new Vector2(0.975f, 0.97f), Vector2.zero, Vector2.zero);
            inputBackground.transform.SetAsFirstSibling();
            keysRoot = new GameObject("Keys", typeof(RectTransform)).GetComponent<RectTransform>();
            keysRoot.SetParent(panel.transform, false);
            AvatarWorldUI.SetRect(keysRoot, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            BuildKeys();
            CreateBottomButtons(panel.transform);
        }

        void BuildKeys()
        {
            for (var index = keysRoot.childCount - 1; index >= 0; index--) Destroy(keysRoot.GetChild(index).gameObject);
            var rows = ukrainian ? Ukrainian : English;
            for (var row = 0; row < rows.Length; row++)
            {
                var keys = rows[row];
                var width = Mathf.Min(66f, 800f / keys.Length - 7f);
                var rowWidth = keys.Length * (width + 7f) - 7f;
                var start = (900f - rowWidth) * 0.5f;
                var bottom = 228f - row * 76f;
                for (var column = 0; column < keys.Length; column++)
                {
                    var key = keys[column];
                    var left = start + column * (width + 7f);
                    AvatarWorldUI.Button("Key " + key, keysRoot, key, new Color(0.15f, 0.18f, 0.25f, 1f), () => Append(key),
                        Vector2.zero, Vector2.zero, new Vector2(left, bottom), new Vector2(left + width, bottom + 58f));
                }
            }
        }

        void CreateBottomButtons(Transform parent)
        {
            Bottom(parent, "Layout", ukrainian ? "EN" : "UK", 20f, 90f, () => { ukrainian = !ukrainian; layoutLabel.text = ukrainian ? "UK" : "EN"; BuildKeys(); });
            Bottom(parent, "Case", "Аа", 118f, 80f, () => uppercase = !uppercase);
            Bottom(parent, "Space", "Пробіл", 206f, 260f, () => Append(" "));
            Bottom(parent, "Backspace", "⌫", 474f, 82f, Backspace);
            Bottom(parent, "Clear", "Очистити", 564f, 116f, () => { value = string.Empty; RefreshInput(); });
            Bottom(parent, "Send", "Надіслати", 688f, 132f, Send);
            Bottom(parent, "Close", "×", 828f, 52f, Hide);
        }

        void Bottom(Transform parent, string name, string label, float left, float width, UnityEngine.Events.UnityAction action)
        {
            AvatarWorldUI.Button(name, parent, label, name == "Send" ? new Color(0.08f, 0.58f, 0.6f, 1f) : new Color(0.17f, 0.19f, 0.25f, 1f), action,
                Vector2.zero, Vector2.zero, new Vector2(left, 18f), new Vector2(left + width, 72f));
        }

        void Append(string character)
        {
            if (value.Length >= maximumCharacters) return;
            value += uppercase ? character.ToUpperInvariant() : character.ToLowerInvariant();
            RefreshInput();
        }

        void Backspace()
        {
            if (value.Length == 0) return;
            value = value.Substring(0, value.Length - 1);
            RefreshInput();
        }

        void Send()
        {
            var text = value.Trim();
            if (text.Length == 0) return;
            if (bridge == null || !bridge.IsConnected)
            {
                chatPanel?.ShowError("Немає з’єднання з OpenCode Customs. Репліку не стерто.");
                return;
            }
            bridge.SubmitTypedText(text);
            value = string.Empty;
            RefreshInput();
            if (hideAfterSend) Hide();
        }

        void RefreshInput()
        {
            if (input == null) return;
            input.text = value.Length == 0 ? "Введіть репліку…" : value + "<color=#5EE3E6>▌</color>";
            input.color = value.Length == 0 ? new Color(0.58f, 0.62f, 0.7f) : Color.white;
        }
    }
}
