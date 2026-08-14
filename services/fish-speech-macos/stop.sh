#!/usr/bin/env bash
set -euo pipefail

service_dir="$(cd "$(dirname "$0")" && pwd)"
pid_file="$service_dir/.runtime/server.pid"

if [[ ! -f "$pid_file" ]]; then
  echo "Fish Speech is not running."
  exit 0
fi

server_pid="$(cat "$pid_file")"
if kill -0 "$server_pid" 2>/dev/null; then
  kill "$server_pid"
  for _ in {1..20}; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
fi

rm -f "$pid_file"
echo "Fish Speech stopped."

