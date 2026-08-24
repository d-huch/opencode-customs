using OpenCode.Customs.AvatarBridge;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace OpenCode.Customs.QuestAlpha.Editor
{
    public static class AvatarAutoconnectSmoke
    {
        const string PendingKey = "OpenCode.Customs.AvatarAutoconnectSmoke.Pending";
        const string StartedKey = "OpenCode.Customs.AvatarAutoconnectSmoke.Started";

        public static void Run()
        {
            SessionState.SetBool(PendingKey, true);
            SessionState.SetFloat(StartedKey, (float)EditorApplication.timeSinceStartup);
            EditorSceneManager.OpenScene("Assets/OpenCodeCustoms/JarvisRoom/JarvisRoom.unity");
            EditorApplication.EnterPlaymode();
        }

        [InitializeOnLoadMethod]
        static void Resume()
        {
            if (!SessionState.GetBool(PendingKey, false)) return;
            EditorApplication.update -= Poll;
            EditorApplication.update += Poll;
        }

        static void Poll()
        {
            if (!SessionState.GetBool(PendingKey, false)) return;
            if (EditorApplication.isPlaying)
            {
                var bridges = Object.FindObjectsByType<OpenCodeAvatarBridgeV2>(FindObjectsInactive.Include);
                if (bridges.Length > 1)
                {
                    Debug.LogError("OpenCode Customs runtime contains duplicate Avatar Bridge components: " + bridges.Length + ".");
                    Finish(1);
                    return;
                }
                var bridge = bridges.FirstOrDefault();
                if (bridge != null && bridge.IsConnected && bridge.ConnectionState == "Connected")
                {
                    var input = Object.FindAnyObjectByType<AvatarEditorInputMode>(FindObjectsInactive.Include);
                    var eyeHeight = input != null && input.xrOrigin != null && input.head != null
                        ? input.head.position.y - input.xrOrigin.position.y
                        : 0f;
                    if (input == null || input.cameraFloorOffset == null || eyeHeight < 1.5f)
                    {
                        Debug.LogError("OpenCode Customs XRI simulator eye height is invalid: " + eyeHeight.ToString("0.00") + " m.");
                        Finish(1);
                        return;
                    }
                    if (input.leftController == null || input.rightController == null ||
                        input.leftController.position.y > input.head.position.y - 0.35f ||
                        input.rightController.position.y > input.head.position.y - 0.35f)
                    {
                        Debug.LogError("OpenCode Customs simulated controllers are not positioned below eye level.");
                        Finish(1);
                        return;
                    }
                    if (!bridge.receiveVoice || bridge.audioSource == null || bridge.audioSource.playOnAwake || bridge.audioSource.volume < 0.99f)
                    {
                        Debug.LogError("OpenCode Customs Unity voice playback is not configured.");
                        Finish(1);
                        return;
                    }
                    var bubble = Object.FindAnyObjectByType<AvatarSpeechBubble>(FindObjectsInactive.Include);
                    var keyboard = Object.FindAnyObjectByType<AvatarVRKeyboard>(FindObjectsInactive.Include);
                    var chatPanel = Object.FindAnyObjectByType<AvatarChatPanel>(FindObjectsInactive.Include);
                    var overlay = Object.FindAnyObjectByType<AvatarDeveloperOverlay>(FindObjectsInactive.Include);
                    var canvases = Resources.FindObjectsOfTypeAll<Canvas>().Where(value => value.gameObject.scene.IsValid()).ToArray();
                    if (bubble == null || keyboard == null || chatPanel == null || overlay == null ||
                        keyboard.chatPanel != chatPanel || chatPanel.keyboard != keyboard || overlay.keyboard != keyboard || overlay.chatPanel != chatPanel ||
                        !canvases.Any(value => value.name == "Comic Speech Bubble" && value.renderMode == RenderMode.WorldSpace) ||
                        !canvases.Any(value => value.name == "Jarvis VR Keyboard" && value.renderMode == RenderMode.WorldSpace) ||
                        !canvases.Any(value => value.name == "Jarvis Chat Panel" && value.renderMode == RenderMode.WorldSpace) ||
                        !canvases.Any(value => value.name == "Jarvis Developer Panel" && value.renderMode == RenderMode.WorldSpace))
                    {
                        Debug.LogError("OpenCode Customs world-space speech bubble, text chat, VR keyboard, or developer panel is unavailable.");
                        Finish(1);
                        return;
                    }
                    var missing = Resources.FindObjectsOfTypeAll<GameObject>()
                        .Where(value => value.scene.IsValid())
                        .Select(value => new
                        {
                            value,
                            count = GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(value),
                        })
                        .Where(value => value.count > 0)
                        .Select(value => value.value.scene.name + "/" + AnimationUtility.CalculateTransformPath(
                            value.value.transform,
                            value.value.transform.root) + " (" + value.count + ")")
                        .Distinct()
                        .OrderBy(value => value)
                        .ToArray();
                    if (missing.Length > 0)
                    {
                        Debug.LogError("OpenCode Customs runtime objects contain missing scripts:\n" + string.Join("\n", missing));
                        Finish(1);
                        return;
                    }
                    Debug.Log("OpenCode Customs Avatar autoconnect smoke passed with comic speech, text chat, VR keyboard, world-space diagnostics, " +
                        eyeHeight.ToString("0.00") + " m eye height and voice playback enabled.");
                    Finish(0);
                    return;
                }
            }
            if (EditorApplication.timeSinceStartup - SessionState.GetFloat(StartedKey, 0) <= 15) return;
            var current = Object.FindAnyObjectByType<OpenCodeAvatarBridgeV2>(FindObjectsInactive.Include);
            Debug.LogError($"OpenCode Customs Avatar autoconnect smoke timed out after 15 seconds. State: {current?.ConnectionState ?? "missing"}. Error: {current?.LastError ?? "none"}.");
            Finish(1);
        }

        static void Finish(int code)
        {
            SessionState.EraseBool(PendingKey);
            SessionState.EraseFloat(StartedKey);
            EditorApplication.update -= Poll;
            if (EditorApplication.isPlaying) EditorApplication.ExitPlaymode();
            EditorApplication.Exit(code);
        }
    }
}
