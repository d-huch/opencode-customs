# Embodied Agent SDK Beta

Embodied Agent SDK connects a Unity 6 or Quest 3 experience to the local Embodied Agent Runtime. Gameplay exposes
semantic world state and typed capabilities; the runtime never receives arbitrary access to Unity methods, the
hierarchy, files, or shell commands.

## Install

Add `com.embodiedagent.sdk` with Unity Package Manager, import the **Equipment Isolation Safety Instructor** sample,
and run **Embodied Agent → Setup Wizard**. The wizard discovers a local runtime, creates an agent root, validates the
scene, attaches a versioned scenario and guides the first deterministic Replay run. See the packaged
**15-minute quickstart** for the complete self-service path.

Editor and PCVR use one-time loopback bootstrap credentials. Quest uses one-time PIN pairing, WSS certificate
pinning, and encrypted device credentials. LAN access is disabled until explicitly enabled in the runtime.

## Supported Beta matrix

- Unity 6 and Meta Quest 3
- Embodied Agent Runtime on macOS arm64 and Windows x64
- LM Studio and llama-server
- Protocol v2.12 with backward compatibility for v2.11 AI Trainee clients
- AI Trainee Guided/Blind live demonstrations and side-effect-free fixture batch testing

The sample is a technology demonstration and is not a certified safety procedure.

## Scenario and training results

Open **Embodied Agent → Scenario Studio** to author instruction, observation, user wait, typed action, verification,
branch and completion steps. Validation blocks missing IDs, broken transitions, unbounded cycles and critical actions
without permission categories. Training outcomes can be exported as local JSON, CSV, a hash-chained audit bundle or an
explicitly configured xAPI statement. Raw audio and model prompts are not part of those reports.

Replay Lab evaluates sanitized timelines without replaying real interaction, external or critical side effects. Its CI
gate detects duplicate responses, session loss, permission bypass, duplicate actions, memory leakage, stuck turns and
failed barge-in neutralization.

The packaged Runtime also provides a localhost-only **Live Instructor Console** for one supervised trainee. It can pause,
resume, retry, provide text hints, resolve pending approvals, confirm instructor-owned evidence and terminate a run safely.
Unity remains authoritative and duplicate commands cannot repeat scenario interventions.

## Record a practical LOTO instruction

1. Import the Safety Instructor sample and create the Equipment Isolation scene.
2. Enter Play Mode and select **Record LOTO instruction** in the trainee HUD.
3. Interact with the PPE station, hazard placard, Stop button, disconnect, lock/tag, tester and instructor in the real procedure order. Use **Start narration / Stop narration** to attach spoken guidance.
4. Stop the recording, then open **Embodied Agent → Review Recorded Instruction**.
5. Edit, reorder, split, merge or exclude steps and select **Test this training**.

Raw audio is discarded. Stable typed actions remain authoritative; local model assistance may improve wording but cannot change entity, capability, risk or permission identifiers.
