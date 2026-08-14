# Fish Speech S2 Pro on macOS MPS

This service runs the official Fish Speech API natively on Apple Silicon through PyTorch MPS. Audio, the voice
reference, and generated speech remain on this Mac. Docker, Fish Audio Cloud, Apple speech, and CPU operation fallback
are not used.

## Install

Fish Speech S2 Pro is large and is intended for a high-memory machine. Close unused local models before installation
and synthesis.

```bash
cd services/fish-speech-macos
./install.sh
```

The installer adds the native Homebrew dependencies, creates a private Python 3.12 environment under `.runtime/`,
clones Fish Speech, and downloads `fishaudio/s2-pro`.

## Run

```bash
./start.sh
./status.sh
./logs.sh
./stop.sh
```

The API listens only on `127.0.0.1:8080`. In OpenCode Customs select **Fish Audio Local** and keep the endpoint set to
`http://127.0.0.1:8080/v1/tts`. The server is launched with `PYTORCH_ENABLE_MPS_FALLBACK=0`; an unsupported GPU
operation fails visibly instead of silently moving synthesis to the CPU. PyTorch compilation is intentionally disabled
because Fish Speech does not support it on macOS.

Use `FISH_SPEECH_PORT` to select another loopback port for the start and status scripts.
