# Autonomous Companion sample

1. Create a GameObject named `OpenCode Companion`.
2. Add `OpenCodeAvatarBridgeV2`, `AvatarCapabilityRegistry`, and `AvatarWorldSensor`.
3. Add `MoveToCapability`, `FollowCapability`, `StayCapability`, `CharacterExpressionCapability`, and `InteractCapability` as needed.
4. Assign a baked `NavMeshAgent`, the player/camera transforms, the Animator, and an AudioSource.
5. Mark perceived objects with `OpenCodeWorldEntity`; expose reversible interactions by deriving from `OpenCodeInteractable`.
6. Paste the PCVR pairing JSON or the Quest device credential from OpenCode Customs.

The Bridge samples the semantic world at a bounded rate. It never sends the Unity hierarchy and never asks the model for per-frame movement.
