# OpenCode Customs Quest 3 alpha

The Unity project in `vr-avatar/` targets stable Unity 6 (`6000.5.1f1`) and consumes the Avatar Bridge as a local UPM package.

1. Open `vr-avatar/` in Unity Hub with Android Build Support installed.
2. Let Package Manager resolve the stable Meta OpenXR, OpenXR, XRI and XR Hands versions.
3. Run **OpenCode Customs → Create Quest Jarvis Room**.
4. Run **OpenCode Customs → Validate Quest Jarvis Room** to verify both hands, both controllers and missing-script references.
5. Add the project VRM/humanoid as a child of **Jarvis VRM Companion** and map its Animator/blendshapes in `AvatarVRMPresentation`.
6. In OpenCode Customs, open **Settings → Avatar & VR**, enable LAN, pair the Quest, and paste the pairing JSON into `OpenCodeAvatarBridgeV2`.
7. Build the enabled `JarvisRoom` scene for Android.

The project uses only Unity's New Input System. The scene contains tracked Quest controller models and articulated hand visuals; `AvatarXRInputVisuals` automatically selects the currently tracked modality for each side. It also contains typed observe/action capabilities, NavMesh movement, inventory items, a gated door, an NPC, a persistent quest, a critical training target, microphone streaming and the developer overlay.
