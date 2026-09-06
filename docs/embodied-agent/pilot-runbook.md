# Embodied Agent SDK Alpha — pilot runbook

## Target customer

The first pilot is an industrial or enterprise VR training team that needs private local inference, typed actions,
auditability, and repeatable failure testing. The reference exercise is simulated equipment isolation. It is not a
real safety-control system and must not actuate physical equipment.

## Installation target

- Unity 6 project with the `com.embodiedagent.sdk` UPM package
- macOS arm64 or Windows x64 workstation
- LM Studio or llama-server listening on loopback
- Meta Quest 3 through the existing paired WSS transport, or Unity Editor over localhost bootstrap

## Clean-project setup

1. Import `com.embodiedagent.sdk-0.4.0-beta.2.tgz` with Unity Package Manager, or use the included local packages from the air-gapped bundle.
2. Open `Embodied Agent > Setup Wizard` and verify the local Runtime.
3. Import the Equipment Isolation Safety Instructor sample.
4. Run `Embodied Agent > Create Equipment Isolation Scene`.
5. Start the Runtime and use **Open Control Center** in the wizard. It opens a one-time localhost URL; no token is copied.
6. Configure the exact LM Studio or llama-server model ID, plus optional local STT/TTS endpoints, and restart the Runtime.
7. Enter Play Mode. The SDK obtains a single-use bootstrap token; no JSON is pasted into the scene.

## Acceptance script

The instructor guides a trainee through PPE inspection, hazard identification, normal machine shutdown, simulated
lockout, zero-energy verification, and instructor sign-off. Critical steps require explicit approval. Disconnect the
Runtime mid-exercise, restart it, and confirm that the canonical session is recovered without duplicate text or
actions.

Before a pilot build run:

```sh
bun run check:embodied --unity --quest --build
```

The Replay gate must detect all five seeded regressions and pass the reference run. A twenty-minute session must
complete without duplicated responses, lost session state, memory-scope leakage, or a permission bypass.

## Audit bundle

Export only hashed text references, turn phases, model route, capability results, approval state, reconnect events,
and latency. Raw audio, prompt text, provider tokens, personal memory content, and credentials are excluded.

## Release boundary

Development artifacts are ad-hoc signed on macOS and unsigned on Windows. A production pilot release sets
`EMBODIED_RELEASE=production`, `EMBODIED_CODESIGN_IDENTITY`, `EMBODIED_NOTARY_PROFILE` and
`EMBODIED_AUDIT_SIGNING_KEY`; both Windows executables must already pass Authenticode verification. Missing production
credentials are a release blocker, not a reason to silently distribute unsigned binaries.
