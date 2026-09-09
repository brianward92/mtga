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
for t in move-mouse click; do [ -x "$BIN/$t" ] || swiftc -O -o "$BIN/$t" "scripts/dev/$t.swift"; done

osascript -e 'tell application "MTGA" to activate' >/dev/null; sleep 0.8
# Geometry comes from the app's mirrored rect (CGWindowList, no Accessibility).
# The AX rect reports nonsense while Arena is full screen, and this script used
# to trust it. arena.sh rect falls back to AX only when the mirror is missing.
IFS=, read -r x y w h <<< "$(bash scripts/dev/arena.sh rect)"
RECT="{\"x\":$x,\"y\":$y,\"width\":$w,\"height\":$h}"

st() { "$TSX" scripts/dev/state.ts "$STATE" "$@"; }
pos() { st packpick; }
POS0=$(pos)
"$TSX" scripts/dev/pick.ts "$STATE" "$RECT" list
P=$("$TSX" scripts/dev/pick.ts "$STATE" "$RECT" "$WHAT")
echo "target: $P  (at pack-pick $POS0)"
read -r TX TY TGRP TNAME <<< "$P"
is_land() { st basic "$TGRP"; }
# The last card of a pack is forced, and a pack can be all basics: refusing
# there is not a safeguard, it just stalls the draft.
is_forced() { st forced; }
if [ "$ALLOW_LAND" = 0 ] && is_land && ! is_forced; then
  echo "REFUSING to pick a basic land ($TNAME); pass --allow-land if you really mean it" >&2; exit 3
fi
if [ "$ALLOW_LAND" = 0 ] && is_land; then echo "taking $TNAME: forced (no non-land left)"; fi
[ "$DRY" = 1 ] && exit 0
if [ "$(pos)" != "$POS0" ]; then echo "pack advanced before clicking; aborting" >&2; exit 4; fi

# Confirm the screen agrees before committing. Cells are matched to cards by
# position, so any ordering error clicks the neighbour; reading the card's title
# band back catches that whatever caused it.
if ! V=$("$TSX" scripts/dev/pick.ts "$STATE" "$RECT" verify "$TGRP"); then
  echo "$V" >&2
  echo "ABORTING: the target cell does not hold $TNAME; not clicking" >&2; exit 6
fi
echo "verified: $V"

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
