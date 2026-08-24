# Mixamo animation inputs

Add the following Humanoid animation files here. Use these exact names and download `Walk` and `Run` with **In Place** enabled:

- `Idle.fbx`
- `Walk.fbx`
- `Run.fbx`
- `Talking.fbx`
- `Thinking.fbx`
- `Wave.fbx`
- `Point.fbx`
- `Nod.fbx`

Animation-only FBX files without skin are sufficient. The Jarvis Room builder configures them as Humanoid clips, loops the continuous states, and creates `GamerGirlAgent.controller` plus its upper-body Avatar Mask.

The files are user-provided and remain subject to their original Mixamo/Adobe license.

Optional character reactions live in `Gestures/`. The builder imports every recognized file there as a one-shot upper-body state. OpenCode Customs exposes them through typed `express` names such as `relieved_sigh`, `acknowledge`, `yes`, `no`, `sarcastic_nod`, `dismiss`, and `look_away`; unknown Animator triggers remain blocked.
