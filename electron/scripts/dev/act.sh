#!/usr/bin/env bash
# Do something, wait for the engine to actually move, then report the new state.
#
# The point is round trips. Acting and then looking used to be two commands, and
# a command costs a model round trip — which measurement put at 85-90% of a
# game's wall clock, against about a minute of actual tool work. Folding the
# observation into the action halves that at a stroke.
#
#   act.sh key a
#   act.sh click 0.925 0.889
#   act.sh drag 0.42 0.95 0.40 0.60
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# Move the cursor off the board before clicking.
#
# Hovering a card pops a large preview of that same card, which then sits over
# the thing you were about to click, and the click lands on the preview instead.
# It cost two separate stalls where a target plainly on screen simply would not
# select. The existing rule was "park before reading"; it applies to clicking
# just as much.
park() { macctl move MTGA 0.12 0.30 >/dev/null 2>&1; sleep 0.25; }
case "${1:-}" in
  drag) shift; macctl drag MTGA "$1" "$2" "$3" "$4" --steps 12 >/dev/null 2>&1 ;;
  click) shift; park; macctl click MTGA "$1" "$2" >/dev/null 2>&1 ;;
  key) shift; macctl key "$1" >/dev/null 2>&1 ;;
  point) shift; park; macctl click MTGA \
      "$(python3 -c "print(f'{($1-152)/1280:.4f}')")" \
      "$(python3 -c "print(f'{($2-33)/748:.4f}')")" >/dev/null 2>&1 ;;
  none|"") : ;;
  *) echo "act: unknown '$1'" >&2; exit 2 ;;
esac
npx tsx "$here/settle.ts" "${SETTLE_MS:-4000}" >/dev/null 2>&1 || true
# When blocks are being declared, print who is actually assigned to whom. The
# drop point is not the assignment: attackers stack in the UI, so dropping three
# blockers on the same visual pile puts two of them on the same creature and
# wastes one. The log says what really happened; the screen does not.
npx tsx "$here/match.ts"
