#!/usr/bin/env bash
# Pick the next card in the live Arena draft based on the overlay's recommendation.
# Requires: the app running with MTGA_STATE_FILE (see the dev run wrapper) and
# Arena on the draft screen. Usage: pick-next-card.sh [top|<grpId>] [--dry-run] [--allow-land]
#
# SAFETY: exactly one double-click, then WAIT for the pick to be logged; a
# retry happens only if the SAME pack/pick is still on screen (never fire into
# the next pack). Basic lands are refused unless --allow-land.
set -euo pipefail
cd "$(dirname "$0")/../.."
STATE="${MTGA_STATE_FILE:?set MTGA_STATE_FILE to the mirrored state file}"
HIST="$HOME/Library/Application Support/mtga-tracker/draft-history.jsonl"
TSX="./node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "tsx missing; run npm ci in electron/ first" >&2; exit 2; }
WHAT="top"; DRY=0; ALLOW_LAND=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --allow-land) ALLOW_LAND=1 ;;
    *) WHAT="$a" ;;
  esac
done
BIN=build/dev; mkdir -p "$BIN"
for t in dblclick move-mouse click; do [ -x "$BIN/$t" ] || swiftc -O -o "$BIN/$t" "scripts/dev/$t.swift"; done

osascript -e 'tell application "MTGA" to activate' >/dev/null; sleep 0.8
R=$(osascript -e 'tell application "System Events" to tell process "MTGA" to get {position, size} of window 1' | tr -d ' ')
IFS=, read -r x y w h <<< "$R"
RECT="{\"x\":$x,\"y\":$y,\"width\":$w,\"height\":$h}"

pos() { python3 scripts/dev/statecheck.py "$STATE" pos; }
POS0=$(pos)
"$TSX" scripts/dev/pick.ts "$STATE" "$RECT" list
P=$("$TSX" scripts/dev/pick.ts "$STATE" "$RECT" "$WHAT")
echo "target: $P  (at pack-pick $POS0)"
read -r TX TY TGRP TNAME <<< "$P"
is_land() { python3 scripts/dev/statecheck.py "$STATE" island "$TGRP"; }
if [ "$ALLOW_LAND" = 0 ] && is_land; then
  echo "REFUSING to pick a basic land ($TNAME); pass --allow-land if you really mean it" >&2; exit 3
fi
[ "$DRY" = 1 ] && exit 0
if [ "$(pos)" != "$POS0" ]; then echo "pack advanced before clicking; aborting" >&2; exit 4; fi

BEFORE=$(grep -c '"type":"pick"' "$HIST" 2>/dev/null || echo 0)
picked() { [ "$(grep -c '"type":"pick"' "$HIST" 2>/dev/null || echo 0)" -gt "$BEFORE" ]; }
# Arena wants a real pointer: one click selects the card (Confirm Pick lights
# up), a second click on Confirm commits it. Double-clicking the card is
# unreliable because Arena's own card preview covers it.
"$BIN/click" "$TX" "$TY"
sleep 1
read -r CX CY _ <<< "$(npx tsx scripts/dev/pick.ts "$STATE" "$RECT" confirm)"
"$BIN/click" "$CX" "$CY"
for i in $(seq 1 12); do sleep 0.5; picked && break; done
if ! picked && [ "$(pos)" = "$POS0" ]; then
  # One retry: re-select and confirm again.
  "$BIN/click" "$TX" "$TY"; sleep 1; "$BIN/click" "$CX" "$CY"
  for i in $(seq 1 12); do sleep 0.5; picked && break; done
fi
"$BIN/move-mouse" 1300 900
if picked; then
  tail -1 "$HIST" | python3 -c 'import sys,json;d=json.loads(sys.stdin.readline());print("PICKED P%sP%s: %s (model rank %s, model wanted %s)"%(d["pack"],d["pick"],d["name"],d["takenRank"],d["recommendedName"]))'
else
  echo "WARNING: pick not confirmed (state now $(pos))" >&2; exit 5
fi
