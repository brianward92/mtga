#!/usr/bin/env bash
# Arena's window rect, straight from the native helper: "x,y,width,height".
#
# The overlay app also publishes a rect in its state mirror, and that copy CAN
# GO STALE — on 2026-09-09 it reported 113,112 while Arena's window was actually
# at 152,33, a 39x79 point error. Every coordinate computed from the mirror that
# evening landed in the wrong place: blocks that never registered, spells
# dropped back into hand, a land that would not play. The helper is live, so ask
# it, and keep the mirror only as a fallback for when the helper is missing.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

helper=""
for candidate in \
  "build/native/arena-window-watch" \
  "/Applications/MTGA Draft Assistant.app/Contents/Resources/native/arena-window-watch"
do
  [ -x "$candidate" ] && helper="$candidate" && break
done
[ -n "$helper" ] || { echo "arena-rect: native helper not found" >&2; exit 2; }

dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
mkfifo "$dir/ctl"
exec 9<>"$dir/ctl"
"$helper" <"$dir/ctl" >"$dir/out" 2>/dev/null &
pid=$!
for _ in $(seq 1 40); do
  line=$(grep -m1 -E '^G ' "$dir/out" 2>/dev/null || true)
  [ -n "$line" ] && break
  sleep 0.1
done
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null || true
exec 9>&-

case "${line:-}" in
  "G NOWIN"|"") echo "arena-rect: Arena window not found" >&2; exit 1 ;;
esac
# "G x,y,w,h,frontmost" -> "x,y,w,h"
printf '%s\n' "${line#G }" | cut -d, -f1-4
