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
label=$(macctl read MTGA --region 0.80,0.85,0.20,0.12 --boxes 2>/dev/null | python3 -c "
import json,sys
try: print(' / '.join(b['text'].strip() for b in json.load(sys.stdin).get('boxes',[])))
except Exception: print('')")
ok=0
if [ "$want" = "advance" ]; then
  case "$label" in
    # Never auto-click "No Blocks" or "Decline". Game one of the event was
    # lost exactly here: a block drag that had landed on nothing left the
    # button reading "No Blocks", the helper treated that as a plain advance,
    # and seven damage went through at six life. A no-block is a decision;
    # ask for it by name (step.sh "No Blocks") or it does not happen.
    *"All Attack"*|*"End Turn"*|*"No Block"*|*Decline*) ok=0 ;;
    *Next*|*"To "*|*Attacker*|*Blocker*|*"Take Action"*|*OK*|*Submit*|*Done*|*Resolve*|*Pass*|*Continue*) ok=1 ;;
  esac
else
  case "$label" in *"$want"*) ok=1 ;; esac
fi
if [ "$ok" = 1 ]; then macctl click MTGA 0.9250 0.8890 >/dev/null 2>&1; echo "step: clicked '$label'"; else echo "step: NOT clicking '$label' (wanted $want)"; exit 1; fi
