# OpenCode Customs Unity/VR bridge

This integration connects a Unity character to the loopback-only Avatar Bridge in OpenCode Customs Desktop. It is intended for PCVR or a Unity player running on the same computer as OpenCode Customs. Standalone headsets need a separately secured LAN relay; the local token is intentionally not exposed to the network.

## Setup

1. Open **Settings → Avatar & VR** in OpenCode Customs and copy the Unity pairing JSON.
2. Copy `OpenCodeAvatarBridge.cs` into `Assets/OpenCodeCustoms/` in the Unity project.
3. Add `OpenCodeAvatarBridge` to the character GameObject and paste the pairing JSON.
4. Assign its `Animator`, `AudioSource`, and character root.
5. Connect the final transcript event from the project's VR speech-to-text component to `SubmitTranscript(string)`. The bridge deliberately accepts final text, so it can work with Whisper, platform dictation, or an existing VR voice SDK without locking the project to one microphone provider.
6. Optionally enter the OpenCode provider/model IDs. With no session ID, the first utterance creates a projectless Chat session.
7. To hear replies inside Unity, enable `Receive Voice` and configure the same local TTS/Fish S2 Pro endpoint and preset used by the personality.

`ClientWebSocket` is used with one serialized send and one receive loop, matching the .NET concurrency contract. Unity JSON payloads use plain serializable classes compatible with `JsonUtility`.

## Protocol v1

Unity connects to the copied `ws://127.0.0.1:<port>/avatar` URL and sends `hello` first. The token is carried in that first message and never placed in the URL.

Client messages:

- `user.transcript` — a final user utterance;
- `character.action.result` — confirmation or failure for an agent-requested action.

Server messages:

- `assistant.started`, `assistant.text`, `assistant.audio`, `assistant.done`, `assistant.error`;
- `character.action` with one of `animation.trigger`, `emotion.set`, `gesture.play`, `look_at`, `move_to`, or `speech.stop`.

The agent cannot invoke arbitrary Unity methods. It sees only the character's declared capabilities, actions pass the normal OpenCode permission system, and each action must be acknowledged by Unity before the agent may report success.
