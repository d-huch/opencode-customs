using System.Collections;
using UnityEngine;
using UnityEngine.XR.Management;

namespace EmbodiedAgent.Unity
{
    [DefaultExecutionOrder(-10000)]
    public sealed class AvatarQuestXrLifecycle : MonoBehaviour
    {
        bool initialized;

        IEnumerator Start()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            var manager = XRGeneralSettings.Instance?.Manager;
            if (manager == null)
            {
                Debug.LogError("Embodied Agent Quest XR lifecycle could not find XR Plug-in Management settings.", this);
                yield break;
            }
            if (!manager.isInitializationComplete) yield return manager.InitializeLoader();
            if (!manager.isInitializationComplete || manager.activeLoader == null)
            {
                Debug.LogError("Embodied Agent Quest XR lifecycle could not initialize the OpenXR loader.", this);
                yield break;
            }
            initialized = true;
            manager.StartSubsystems();
#else
            yield break;
#endif
        }

        void OnDestroy()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!initialized) return;
            var manager = XRGeneralSettings.Instance?.Manager;
            if (manager == null || !manager.isInitializationComplete) return;
            manager.DeinitializeLoader();
            initialized = false;
#endif
        }
    }
}
