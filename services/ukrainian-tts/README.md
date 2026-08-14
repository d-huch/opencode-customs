# OpenCode Customs Local Voice Runtime

This Docker service exposes an OpenAI-compatible local text-to-speech endpoint and a streaming speech-to-text WebSocket
for OpenCode Customs. It never calls macOS speech recognition or synthesis and has no Apple fallback.

Two explicit modes are available:

- `quality` — Silero V5 CIS Extended for Ukrainian, `stress-uk` for contextual stress marks, and a separate Silero English model for Latin-language fragments. Ukrainian voices: `kateryna`, `lada`, `mykyta`, `oleksa`, and `tetiana`.
- `fast` — the Ukrainian Piper ONNX voice for lower latency and CPU usage.

Quality mode keeps complete English passages on the dedicated Silero English voice. Inside predominantly Ukrainian text,
known English names are first replaced by the pronunciation dictionary and short remaining Latin fragments are rendered
as Ukrainian phonetic forms. This avoids abrupt voice changes for product names and abbreviations while preserving natural
English synthesis for full English replies. Fast mode applies the same short-fragment adaptation before Piper synthesis.
This is language-aware synthesis within the selected mode, not an engine fallback. Models stay loaded while the container
is running. Accent results are cached in memory and generated audio is cached on disk by mode, voice, speed, and normalized
text.

The container includes SciPy because Silero V5 CIS Extended imports it while restoring the packaged model.

The desktop client speaks new assistant replies for both typed and voice-submitted prompts. It starts from the first complete
sentence or a bounded 50–140 character clause. While that audio is playing, it prepares the next chunk in parallel. This
reduces time to first sound without waiting for the full assistant response. Playback failures are logged separately from
successful backend synthesis so a silent renderer can be distinguished from a TTS generation failure.

## Full-duplex recognition

The desktop keeps one microphone stream open and sends 16 kHz mono PCM frames to
`WS /v1/audio/transcriptions/stream`. Chromium WebRTC echo cancellation receives the active renderer output as its
playback reference before the microphone reaches the backend. The server then combines an RMS noise gate with aggressive
WebRTC VAD, preserves the latest 700 milliseconds in a ring buffer, streams at most two Whisper previews, and uses a
two-stage endpoint. A short pause requests a
candidate transcript; an unfinished phrase receives a semantic continuation window before it becomes final. This
means an interruption includes speech that began before TTS playback was stopped instead of losing its first words.

Preview recognition uses the dedicated tiny recognizer and never blocks the accurate final decode. The final transcript
is decoded once from the complete utterance by the configured main recognizer, without feeding earlier hypotheses back as
a prompt. Repeated sentence and phrase blocks are removed before the transcript reaches the desktop, stale previews are
discarded, and sub-360-millisecond noise bursts never create a user request.

Each streaming event includes the VAD state, captured audio and speech/silence duration, pre-roll, transcription
latency, transcript stability, and endpoint reason used by the in-chat voice diagnostics view.

For reproducible recognition diagnostics, `POST /v1/audio/transcriptions/replay?language=uk` accepts a PCM16 WAV body.
Mono and stereo input are supported and resampled to 16 kHz before passing through the same faster-whisper recognizer.
The response includes the transcript, source sample rate, channel count, audio duration, and transcription time. The
desktop Voice Inspector invokes this endpoint only after the user explicitly selects a WAV file; the live stream itself
does not write microphone audio to disk.

`POST /v1/audio/duplex/reliability` runs a bounded real-audio reliability suite. It repeats the same synthesized PCM
duplex regression for 1–20 cycles, optionally injects deterministic input delay and a reconnect boundary, continues after
an isolated failed cycle, and reports RSS, peak RSS, active thread, and open file-descriptor deltas. It does not retry a
real backend failure and does not switch to another voice or recognizer.

The client also sends the spoken response text with the duplex state. It is used only to reject residual semantic echo;
audio never enters the LLM context. A distinct partial transcript interrupts playback and the active model turn, while
echo-like transcripts are ignored. The WebSocket remains active between turns, so no Swift process or Apple Speech
service is launched for each utterance.

## Start

```bash
cd services/ukrainian-tts
docker compose up --build -d
docker compose logs -f
```

The first start downloads the Silero Ukrainian and English packages, the Piper ONNX voice, and the `stress-uk` model into the persistent `ukrainian-tts-cache` volume. Startup can therefore take several minutes; later starts reuse the cache.

The two modes load independently. The default source list contains an archived byte-for-byte snapshot of the official V5 package followed by the official Silero host. Downloaded Torch packages are validated before entering the persistent cache, and a corrupt cached package is discarded before retrying another source. If neither source is reachable, the API stays online, `/health` reports quality mode as unavailable, and fast mode can still be selected explicitly. It never switches to fast mode automatically. To use an already downloaded official Silero V5 CIS Extended package, place it at `models/v5_cis_ext.pt`; the container mounts that directory read-only. You can likewise provide `models/v3_en.pt`.

## Verify

```bash
curl http://127.0.0.1:8880/health
curl http://127.0.0.1:8880/v1/models

curl http://127.0.0.1:8880/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"silero-v5-ukrainian","mode":"quality","voice":"kateryna","input":"Вітаю! OpenCode Customs is ready.","response_format":"wav"}' \
  --output opencode-customs-quality.wav

curl http://127.0.0.1:8880/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"piper-ukrainian","mode":"fast","voice":"ukrainian_tts","input":"Швидка локальна озвучка готова.","response_format":"wav"}' \
  --output opencode-customs-fast.wav
```

Response headers expose `X-TTS-Cache`, preparation time, synthesis time, and total backend time. OpenCode Customs shows these metrics after playing a test phrase in Voice settings.

## Pronunciations and accents

Edit `app/pronunciations.json` to add project-specific names, abbreviations, and technical terms. Values may contain Unicode acute accents; the backend converts them to the stress syntax expected by Silero. The contextual accentor runs after dictionary replacement and caches repeated text.

## Configuration

- `TTS_QUALITY_MODEL_ID` — public API identifier for quality mode.
- `TTS_FAST_MODEL_ID` — public API identifier for fast mode.
- `TTS_SILERO_UKRAINIAN_URL` — comma-separated Silero V5 CIS Extended package URLs.
- `TTS_SILERO_ENGLISH_URL` — comma-separated Silero English package URLs.
- `TTS_SILERO_UKRAINIAN_PATH` and `TTS_SILERO_ENGLISH_PATH` — optional mounted model paths. Local files take precedence over downloads.
- `TTS_PIPER_MODEL_URL` and `TTS_PIPER_CONFIG_URL` — Piper ONNX model and JSON URLs.
- `TTS_ENGLISH_VOICE` — Silero English speaker, default `en_0`.
- `TTS_CPU_THREADS` — Torch CPU threads, default `4`.
- `TTS_MAX_INPUT_CHARS` — maximum request length, default `6000`.
- `TTS_CHUNK_CHARS` — maximum Silero synthesis chunk, default `350`.
- `TTS_CACHE_ROOT` — model and audio cache directory.
- `TTS_DOWNLOAD_ATTEMPTS` and `TTS_DOWNLOAD_TIMEOUT_SECONDS` — bounded model download retry policy.
- `STT_MODEL` — faster-whisper model used for final command transcription, default `large-v3-turbo`. The smaller wake model may produce provisional live text, but it is never accepted as the final user message.
- `STT_WAKE_MODEL` — dedicated low-latency wake-word recognizer, default `tiny`. It is not used as an answer,
  coding, command, or fallback model.
- `STT_DEVICE` and `STT_COMPUTE_TYPE` — inference target, default `cpu` and `int8`.
- `STT_PRE_ROLL_MS` — server-side microphone ring buffer, default `700`.
- `STT_SILENCE_MS` — initial pause before endpoint analysis, default `700`.
- `STT_SEMANTIC_GRACE_MS` — maximum continuation window for an unfinished phrase, default `1800`.
- `STT_PARTIAL_MS` — minimum interval between preview transcriptions, default `2400`.
- `STT_MAX_PARTIALS` — maximum preview decodes per utterance, default `2`.
- `STT_MAX_UTTERANCE_MS` — hard upper bound for one utterance, default `15000`.
- `STT_MIN_SPEECH_MS` — minimum accepted voiced duration, default `360`.
- `STT_MIN_RMS` — normalized PCM energy required in addition to WebRTC VAD, default `0.0012`.
- `STT_MIN_FINAL_CONFIDENCE` — minimum final large-model confidence admitted to chat, history, and memory, default `0.45`.
- `STT_ENDPOINT_COMMIT_MS` — minimum silence before a sufficiently long, complete phrase is committed, default `1300` ms.
- `STT_SEMANTIC_MIN_SPEECH_MS` — minimum detected speech required for an early semantic commit, default `1200` ms; shorter fragments wait for the semantic grace period.
- `STT_VAD_MODE` — WebRTC VAD aggressiveness from `0` to `3`, default `2` to preserve quieter Ukrainian syllables.
- `STT_WAKE_MATCH_THRESHOLD` — generic similarity threshold for configured wake phrases, default `0.78`.
- `STT_WAKE_COMMAND_OVERLAP_MS` — audio retained before the detected wake-word boundary, default `80` ms.

When the configurable wake gate is armed, VAD sends a completed microphone fragment only to the dedicated wake
recognizer. Unmatched background speech is discarded without invoking the main `STT_MODEL`. A matched phrase exposes its
word timestamp; the main recognizer then receives only the command audio after that boundary. A phrase without a command
opens the configured follow-up window. If the dedicated wake recognizer is unavailable, the stream returns a visible
error and never falls through to full STT.

The application never switches between quality and fast mode automatically. If the selected backend fails, the error is shown and the hands-free loop stops.

## Licenses

Silero V5 CIS Extended is distributed under CC-NC-BY. Piper is GPL-3.0 and individual voice models can carry their own model-card licenses. Review all upstream licenses before commercial distribution.
