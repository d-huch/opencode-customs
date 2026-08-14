#!/usr/bin/env bash
set -euo pipefail

service_dir="$(cd "$(dirname "$0")" && pwd)"
log_file="$service_dir/.runtime/server.log"

if [[ ! -f "$log_file" ]]; then
  echo "No Fish Speech log exists yet."
  exit 1
fi

tail -f "$log_file"

