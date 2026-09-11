#!/usr/bin/env bash
# Click the bottom-right step button, but only if its label is one we expect.
#
# That button is context-sensitive. In the attackers step it reads "All Attack"
# and clicking it declares every creature; in second main it reads "End Turn".
# Pressing it three times to "push through combat" once declared four attackers
# I meant to hold back, then ended the turn with five mana unspent. Read first.
#
#   step.sh                 click if the label is a plain advance (Next / To ... / N Attacker(s) / No Blocks / N Blockers / Take Action / OK / Submit / Done / Resolve / Pass)
#   step.sh "End Turn"      click only if it says End Turn
set -uo pipefail
want="${1:-advance}"
readlabel() { macctl read MTGA --region "$1" --boxes 2>/dev/null | python3 -c "
import json,sys
try: print(' / '.join(b['text'].strip() for b in json.load(sys.stdin).get('boxes',[])))
except Exception: print('')"; }
label=$(readlabel 0.80,0.85,0.20,0.12)
# The label read occasionally comes back as a glyph or two ("K-") mid-animation.
# One retry on a slightly larger crop before deciding the button is unreadable;
# refusing End Turn on a junk read stranded a turn on a keyboard fallback.
if [ "${#label}" -lt 3 ]; then sleep 0.4; label=$(readlabel 0.78,0.83,0.22,0.15); fi
ok=0
if [ "$want" = "advance" ]; then
  # A declaration COUNT ("3 Attackers", "2 Blockers") submits the declaration;
  # "To Blockers" is a plain priority pass. Only the digit form is refused.
  if echo "$label" | grep -Eq '[0-9]+ (Attacker|Blocker)'; then label="COUNT:$label"; fi
  case "$label" in
    COUNT:*) ok=0 ;;
    # Never auto-click "No Blocks" or "Decline". Game one of the event was
    # lost exactly here: a block drag that had landed on nothing left the
    # button reading "No Blocks", the helper treated that as a plain advance,
    # and seven damage went through at six life. A no-block is a decision;
    # ask for it by name (step.sh "No Blocks") or it does not happen.
    # A declaration count ("3 Attackers", "2 Blockers") SUBMITS the declaration.
    # Auto-clicking one shipped a three-creature attack that was meant to be a
    # lone deathtouch poke. Submit declarations only by name.
    *Al*Attack*|*"End Turn"*|*"No Block"*|*Decline*) ok=0 ;;
    *Next*|*"To "*|*"Take Action"*|*OK*|*Submit*|*Done*|*Resolve*|*Pass*|*Continue*) ok=1 ;;
  esac
else
  # Tolerate the recogniser doubling a letter: "All Attack" arrives as "Alll Attack".
  pat=$(python3 -c "import re,sys;print(''.join(ch+'+' if ch.isalpha() else re.escape(ch) for ch in sys.argv[1]))" "$want")
  echo "$label" | grep -Eqi "$pat" && ok=1
fi
if [ "$ok" = 1 ]; then macctl click MTGA 0.9250 0.8890 >/dev/null 2>&1; echo "step: clicked '$label'"; else echo "step: NOT clicking '$label' (wanted $want)"; exit 1; fi
