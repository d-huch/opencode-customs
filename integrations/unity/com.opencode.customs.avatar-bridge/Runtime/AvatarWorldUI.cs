using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;
using UnityEngine.XR.Interaction.Toolkit.UI;

namespace OpenCode.Customs.AvatarBridge
{
    static class AvatarWorldUI
    {
        public static Canvas CreateCanvas(string name, Transform parent, Vector2 size, float scale)
        {
            var root = new GameObject(name, typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster), typeof(TrackedDeviceGraphicRaycaster));
            root.transform.SetParent(parent, false);
            var rect = root.GetComponent<RectTransform>();
            rect.sizeDelta = size;
            rect.localScale = Vector3.one * scale;
            var canvas = root.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = Camera.main;
            root.GetComponent<CanvasScaler>().dynamicPixelsPerUnit = 12f;
            return canvas;
        }

        public static Image Image(string name, Transform parent, Color color, Vector2 anchorMin, Vector2 anchorMax, Vector2 offsetMin, Vector2 offsetMax)
        {
            var value = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image)).GetComponent<Image>();
            value.transform.SetParent(parent, false);
            value.color = color;
            SetRect(value.rectTransform, anchorMin, anchorMax, offsetMin, offsetMax);
            return value;
        }

        public static TextMeshProUGUI Text(string name, Transform parent, string value, float size, Color color, TextAlignmentOptions alignment,
            Vector2 anchorMin, Vector2 anchorMax, Vector2 offsetMin, Vector2 offsetMax)
        {
            var text = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            text.transform.SetParent(parent, false);
            text.text = value;
            text.fontSize = size;
            text.color = color;
            text.alignment = alignment;
            text.textWrappingMode = TextWrappingModes.Normal;
            text.overflowMode = TextOverflowModes.Ellipsis;
            SetRect(text.rectTransform, anchorMin, anchorMax, offsetMin, offsetMax);
            return text;
        }

        public static Button Button(string name, Transform parent, string label, Color color, UnityAction action,
            Vector2 anchorMin, Vector2 anchorMax, Vector2 offsetMin, Vector2 offsetMax)
        {
            var image = Image(name, parent, color, anchorMin, anchorMax, offsetMin, offsetMax);
            var button = image.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            var colors = button.colors;
            colors.highlightedColor = Color.Lerp(color, Color.white, 0.18f);
            colors.pressedColor = Color.Lerp(color, Color.black, 0.18f);
            button.colors = colors;
            Text("Label", button.transform, label, 22f, Color.white, TextAlignmentOptions.Center,
                Vector2.zero, Vector2.one, new Vector2(6f, 4f), new Vector2(-6f, -4f));
            button.onClick.AddListener(action);
            return button;
        }

        public static void SetRect(RectTransform rect, Vector2 anchorMin, Vector2 anchorMax, Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        public static void FaceViewer(Transform value, Transform viewer)
        {
            if (value == null || viewer == null) return;
            var direction = value.position - viewer.position;
            if (direction.sqrMagnitude > 0.001f) value.rotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
        }
    }
}
