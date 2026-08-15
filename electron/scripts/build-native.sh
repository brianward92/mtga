#!/usr/bin/env bash
# Compile the native helpers into build/native (macOS only; skipped elsewhere
# or when swiftc is unavailable — the app falls back to osascript polling).
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = "Darwin" ] || { echo "[native] not macOS, skipping"; exit 0; }
command -v swiftc >/dev/null || { echo "[native] swiftc missing, skipping (osascript fallback)"; exit 0; }
mkdir -p build/native
SRC=native/arena-window-watch.swift
OUT=build/native/arena-window-watch
if [ ! -x "$OUT" ] || [ "$SRC" -nt "$OUT" ]; then
  swiftc -O -o "$OUT" "$SRC"
  echo "[native] built $OUT"
fi
