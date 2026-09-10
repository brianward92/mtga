#!/usr/bin/env bash
# g.sh — play-speed wrapper for driving Arena during a MATCH.
#
# Everything here takes coordinates in SCREENSHOT space (the 1800px-wide image
# `arena.sh shot` produces) and converts to screen points once, so a whole turn
# can be issued as one command. During a match Arena runs a turn timer, and the
# round trip of one screenshot per micro-action is enough on its own to lose a
# game on time — which is exactly how the first one was lost.
#
#   g.sh click X Y          g.sh drag X1 Y1 X2 Y2        g.sh shot NAME
#   g.sh next               g.sh allattack               g.sh noblocks
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
BIN=build/dev
IFS=, read -r WX WY WW WH <<< "$(bash scripts/dev/arena.sh rect)"
SW=1800; SH=1052   # the shot's pixel dimensions
sx() { python3 -c "print(round($WX + $1 * $WW / $SW))"; }
sy() { python3 -c "print(round($WY + $1 * $WH / $SH))"; }
act() { osascript -e 'tell application "MTGA" to activate' >/dev/null; }

case "${1:-}" in
  click) act; "$BIN/click" "$(sx "$2")" "$(sy "$3")" ;;
  drag)  act; "$BIN/drag" "$(sx "$2")" "$(sy "$3")" "$(sx "$4")" "$(sy "$5")" "${6:-20}" ;;
  move)  "$BIN/move-mouse" "$(sx "$2")" "$(sy "$3")" ;;
  # The three buttons that appear in the same place every turn.
  next|allattack|noblocks|confirm) act; "$BIN/click" "$(sx 1663)" "$(sy 930)" ;;
  shot)  "$BIN/move-mouse" "$(sx 900)" "$(sy 300)"; sleep 0.6; bash scripts/dev/arena.sh shot "${2:-m}" >/dev/null; echo "build/dev/shots/${2:-m}.png" ;;
  *) echo "g.sh click|drag|move|next|allattack|noblocks|shot" >&2; exit 2 ;;
esac
