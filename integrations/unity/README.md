# OpenCode Customs Unity/VR Avatar Bridge v2.1

The Unity 6 integration is a UPM package at `com.opencode.customs.avatar-bridge`. It turns one companion into a bounded autonomous agent driven by semantic world state, typed capabilities, a goal stack, trusted autonomy profiles, and save-scoped memory.

## Install the v2 package

In Unity Package Manager choose **Add package from disk** and select:

`integrations/unity/com.opencode.customs.avatar-bridge/package.json`

Add these components to the companion root:

- `OpenCodeAvatarBridgeV2` — protocol, reconnect, heartbeat, resume, speech interruption, action execution, and binary reply audio;
- `AvatarCapabilityRegistry` — discovers typed capabilities below the companion;
- `AvatarWorldSensor` — bounded radius/FOV/raycast perception with snapshots, deltas, and attention events;
- `AvatarDeveloperOverlay` — connection, goal, action latency, entity, capability, and approval diagnostics;
- optional `AvatarScenarioRecorder` — JSONL record/replay without a headset.

The included standard capabilities cover NavMesh `move_to`, `follow`, `stay`, character expressions, and generic registered interactions. Add game-specific doors, seats, inventory, combat, or quest choices by deriving from `AvatarCapabilityBehaviour` and returning a JSON Schema manifest. The game owns preconditions and risk; the agent cannot lower them.

Every v2.1 manifest can also declare a permission category, expected postconditions, and side effects. Action results return a machine code, changed entity IDs, and whether the agent must observe again. Existing v2 clients remain compatible; absent v2.1 fields receive conservative defaults.

## Jarvis Lab vertical slice

Import the **Jarvis Lab** sample and choose **OpenCode Customs → Create Jarvis Lab Scene**. The generated Unity scene contains a baked NavMesh, typed item inspection/pickup/drop/use/crafting, a locked door, technician NPC, save-slot quest, relationship state, a critical training target, developer overlay, and record/replay fixture. It is the acceptance environment for the personal local Jarvis before broader SDK work.

## PCVR

Open **Settings → Avatar & VR** in OpenCode Customs, copy the loopback pairing JSON, and paste it into `OpenCodeAvatarBridgeV2.connectionJson`. The token is sent only in the initial WebSocket hello and is never put in a URL.

## Meta Quest

1. Enable secure LAN access in **Avatar & VR**. It is disabled by default.
2. Generate a one-time QR/PIN and use the displayed WSS address, PIN, and certificate fingerprint in the Quest pairing screen.
3. Call `QuestPairing.PairAsync(...)` (or POST `{ "pin": "123456", "name": "Quest 3" }` to `/pair`). Save the returned connection JSON in `OpenCodeAvatarBridgeV2.connectionJson`.
4. Pin the SHA-256 fingerprint. Never replace the validation callback with an accept-all handler. If a Quest IL2CPP profile cannot use `ClientWebSocket` certificate callbacks, provide a native Android `IAvatarTransport` implementation with the same pin before enabling LAN play.

OpenCode Customs stores only the token hash and allows each paired device to be revoked.

## Voice and interruption

Connect the VR microphone/VAD integration to `SubmitSpeechStart`, `SubmitSpeechPartial`, `SubmitSpeechFinal`, and `CancelSpeech`. A speech start stops local playback and cancels the running model turn. TTS arrives as bounded binary chunks with a JSON start/end envelope; the SDK reconstructs WAV playback. Idle animations and immediate local reactions should remain in Unity without an LLM call.

## Protocol v1 compatibility

`OpenCodeAvatarBridge.cs` remains the standalone v1 adapter for existing scenes. Desktop accepts v1, v2, and the backward-compatible v2.1 minor extension. New projects should use the UPM package: only v2 supports semantic perception, dynamic capabilities, bounded goals, save-slot memory, replay, approvals, reconnect/resume, Quest pairing, and binary audio.

## Security boundaries

- PCVR binds to loopback only.
- Quest uses WSS, one-time pairing, per-device credentials, certificate pinning, and revocation.
- LAN is off by default.
- `ambient` actions run automatically; reversible `interaction` actions follow the autonomy setting; a `critical` action runs automatically only when its exact permission category is trusted for that game. Unknown and untrusted critical categories require a 30-second VR/Desktop approval and default to deny.
- Capabilities invoke registered adapters only. No arbitrary Unity method, hierarchy, file, or shell access is exposed.
