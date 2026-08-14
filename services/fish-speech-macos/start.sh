#!/usr/bin/env bash
set -euo pipefail

service_dir="$(cd "$(dirname "$0")" && pwd)"
runtime_dir="$service_dir/.runtime"
source_dir="$runtime_dir/fish-speech"
venv_dir="$runtime_dir/venv"
pid_file="$runtime_dir/server.pid"
log_file="$runtime_dir/server.log"
port="${FISH_SPEECH_PORT:-8080}"
matplotlib_dir="$runtime_dir/matplotlib"

if [[ ! -x "$venv_dir/bin/python" || ! -f "$runtime_dir/s2-pro.downloaded" ]]; then
  echo "Fish Speech is not installed. Run ./install.sh first."
  exit 1
fi

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "Fish Speech is already running with PID $(cat "$pid_file")."
  exit 0
fi

if ! "$venv_dir/bin/python" -c 'import torch; raise SystemExit(0 if torch.backends.mps.is_available() else 1)'; then
  echo "PyTorch MPS is unavailable in this process. Fish Speech was not started; CPU fallback is disabled."
  echo "Launch this script from a native macOS terminal or OpenCode Customs with Metal access."
  exit 1
fi

mkdir -p "$runtime_dir" "$matplotlib_dir"
cd "$source_dir"

MPLCONFIGDIR="$matplotlib_dir" \
PYTORCH_ENABLE_MPS_FALLBACK=0 \
  nohup "$venv_dir/bin/python" tools/api_server.py \
    --listen 127.0.0.1:"$port" \
    --device mps \
    --half \
    >"$log_file" 2>&1 &

server_pid=$!
echo "$server_pid" >"$pid_file"
echo "Starting Fish Speech S2 Pro on PyTorch MPS (PID $server_pid)."
echo "Log: $log_file"

for _ in {1..180}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Fish Speech stopped during startup. Last log lines:"
    tail -80 "$log_file"
    exit 1
  fi
  if curl --silent --fail "http://127.0.0.1:$port/v1/health" >/dev/null; then
    echo "Fish Speech is ready at http://127.0.0.1:$port/v1/tts"
    exit 0
  fi
  sleep 1
done

echo "Fish Speech is still loading. Follow progress with ./logs.sh."
exit 2
