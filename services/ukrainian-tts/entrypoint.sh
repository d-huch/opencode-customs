#!/bin/sh
set -eu

mkdir -p "$HF_HOME" "${TTS_CACHE_ROOT:-/home/tts/.cache/opencode-customs}"
chown -R tts:tts /home/tts/.cache
exec gosu tts "$@"
