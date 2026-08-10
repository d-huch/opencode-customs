# OpenCode Customs Local Voice Runtime

This Docker service exposes an OpenAI-compatible local text-to-speech endpoint for OpenCode Customs. It never calls macOS speech synthesis and has no Apple fallback.

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

The application never switches between quality and fast mode automatically. If the selected backend fails, the error is shown and the hands-free loop stops.

## Licenses

Silero V5 CIS Extended is distributed under CC-NC-BY. Piper is GPL-3.0 and individual voice models can carry their own model-card licenses. Review all upstream licenses before commercial distribution.
