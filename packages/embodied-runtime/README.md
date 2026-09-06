# Embodied Agent Runtime

Private, local-first runtime for the public `com.embodiedagent.sdk` Unity package. It owns model access,
conversation state, memory, permissions, reconnect handling, and Replay Lab execution while the Unity package
owns world sensing and typed actions.

## Beta development start

```sh
bun run src/index.ts
```

The Runtime binds its control API to `127.0.0.1:57110` and the Unity bootstrap API to `127.0.0.1:57112`.
No model or bridge token is exposed by the health endpoint. Local provider configuration is read from the
Runtime state directory, independently from an OpenCode Customs installation.

Environment variables:

- `EMBODIED_RUNTIME_STATE`: override the state directory.
- `EMBODIED_RUNTIME_PORT`: override the authenticated control API port.
- `EMBODIED_BOOTSTRAP_PORT`: override the Unity localhost bootstrap port.
- `EMBODIED_RUNTIME_TOKEN`: supply the control token instead of generating one.

The authenticated `PUT /v1/config` control endpoint accepts a local model selection and writes it for the next
Runtime start:

```json
{
  "providerID": "lmstudio",
  "baseURL": "http://127.0.0.1:1234/v1",
  "modelID": "your-loaded-model",
  "speech": {
    "transcription": {
      "baseURL": "http://127.0.0.1:8000/v1",
      "modelID": "your-whisper-model",
      "language": "uk"
    },
    "synthesis": {
      "endpoint": "http://127.0.0.1:8080/v1/audio/speech",
      "modelID": "your-speech-model",
      "voice": "instructor"
    }
  }
}
```

`providerID` is limited to `lmstudio` or `llama-server`, and the Beta only accepts loopback endpoints. This keeps
gameplay code independent from the selected local backend.

Speech is optional and also restricted to loopback. The STT adapter sends a bounded PCM16 WAV to an
OpenAI-compatible `/v1/audio/transcriptions` route after the user finishes speaking. The TTS adapter calls an
OpenAI-compatible speech endpoint and streams the returned WAV to the active Unity or Quest client. The Runtime
does not silently fall back to a cloud service or a different voice.

The Beta supports providers already implemented by the local OpenCode engine, including LM Studio and
llama-server. Cloud provider presets are intentionally not exposed by this product surface.

## Replay and diagnostics

The authenticated Control Center includes Replay Lab. It evaluates a fixture, renders its event timeline and compares a
candidate with a known-good baseline without executing gameplay side effects. The CLI emits human-readable or JUnit
results:

```sh
bun run replay fixtures/equipment-isolation-happy.json --junit dist/replay.xml
```

Fixtures may declare deterministic disconnect, model-offline, timeout, duplicate-event, permission-denial,
action-failure or memory-scope-leak injections. `GET /v1/diagnostics` exports a bounded support bundle without tokens,
audio, prompts or personal data.

The **Live Instructor Console** is served from `/instructor` through the same one-time localhost login. It mirrors the
authoritative Unity scenario snapshot over authenticated SSE and supports one supervised trainee. Commands are bound to
the run, revision and expected step, then acknowledged and audited by request ID so reconnect cannot repeat an intervention.

Release packaging produces a native macOS installer, an externally signed Windows MSI, standalone Runtime and Replay
executables, the UPM archive, signed offline-update manifests, a license inventory and a CycloneDX SBOM. Runtime state
tracks crash recovery and suspends an active scenario after an unclean restart. Default local retention is 14 days for
logs, 30 days for Replay and 365 days for results.

Optional xAPI delivery is configured in Control Center. Its bearer credential is protected by Keychain or DPAPI, terminal
results use deterministic statement IDs, and uncertain delivery remains in a durable outbox until an administrator retries
it. LRS failure never blocks the local Training Outcome.

`bun run package:beta` intentionally fails without production identities, Windows and Quest evidence, a dependency scan,
clean onboarding within 30 minutes and confirmation of two paid design partners. Development artifacts are never labelled
as a production Beta.
