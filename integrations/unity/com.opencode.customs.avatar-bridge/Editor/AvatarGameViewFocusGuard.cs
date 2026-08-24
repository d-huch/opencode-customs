using UnityEditor;
using UnityEngine;

namespace OpenCode.Customs.AvatarBridge.Editor
{
    [InitializeOnLoad]
    static class AvatarGameViewFocusGuard
    {
        static bool? previous;

        static AvatarGameViewFocusGuard()
        {
            EditorApplication.playModeStateChanged += state =>
            {
                if (state == PlayModeStateChange.EnteredPlayMode) previous = null;
                if (state == PlayModeStateChange.ExitingPlayMode) previous = null;
            };
            EditorApplication.update += Update;
        }

        static void Update()
        {
            if (!EditorApplication.isPlaying || EditorApplication.isPaused) return;
            var window = EditorWindow.focusedWindow;
            var focused = window != null && window.GetType().FullName == "UnityEditor.GameView";
            if (previous == focused) return;
            previous = focused;
            var reason = focused
                ? "Game View regained focus"
                : window == null ? "Editor window lost focus" : "Focused " + window.GetType().Name;
            foreach (var input in Object.FindObjectsByType<AvatarEditorInputMode>(FindObjectsInactive.Include))
                input.SetGameViewFocused(focused, reason);
        }
    }
}
