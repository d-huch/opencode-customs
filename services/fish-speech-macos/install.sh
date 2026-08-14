#!/usr/bin/env bash
set -euo pipefail

service_dir="$(cd "$(dirname "$0")" && pwd)"
runtime_dir="$service_dir/.runtime"
source_dir="$runtime_dir/fish-speech"
venv_dir="$runtime_dir/venv"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Fish Speech MPS setup requires an Apple Silicon Mac."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh and retry."
  exit 1
fi

brew install ffmpeg sox portaudio uv git-lfs
mkdir -p "$runtime_dir"

if [[ ! -d "$source_dir/.git" ]]; then
  git clone --depth 1 https://github.com/fishaudio/fish-speech.git "$source_dir"
fi

git -C "$source_dir" lfs install --local
if [[ ! -x "$venv_dir/bin/python" ]]; then
  uv venv --python 3.12 "$venv_dir"
fi
UV_PROJECT_ENVIRONMENT="$venv_dir" uv sync --project "$source_dir" --locked
uv pip install --python "$venv_dir/bin/python" "huggingface_hub[hf_xet]"

if [[ ! -f "$runtime_dir/s2-pro.downloaded" ]]; then
  "$venv_dir/bin/hf" download fishaudio/s2-pro --local-dir "$source_dir/checkpoints/s2-pro"
  touch "$runtime_dir/s2-pro.downloaded"
fi

"$venv_dir/bin/python" - <<'PY'
import torch

if not torch.backends.mps.is_available():
    raise SystemExit("PyTorch was installed, but the MPS backend is unavailable.")

print(f"PyTorch {torch.__version__}; MPS is available.")
PY

echo "Fish Speech S2 Pro is installed locally. Run ./start.sh to start the MPS server."
