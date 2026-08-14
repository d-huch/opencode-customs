#!/usr/bin/env bash
set -euo pipefail

service_dir="$(cd "$(dirname "$0")" && pwd)"
pid_file="$service_dir/.runtime/server.pid"
port="${FISH_SPEECH_PORT:-8080}"

if [[ ! -f "$pid_file" ]] || ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "Fish Speech is stopped."
  exit 1
fi

if ! curl --silent --fail "http://127.0.0.1:$port/v1/health"; then
  echo "Fish Speech process is running, but the API is not ready."
  exit 2
fi

echo
echo "Fish Speech is ready on PyTorch MPS (PID $(cat "$pid_file"))."

