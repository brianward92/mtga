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
# Tell the rope guard a real driver is working, so it stands down (see guard.ts).
touch /tmp/mtga-acting 2>/dev/null || true
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
  # Judge the refusal on the button's MAIN label only, and the permission on
  # any part of it.
  #
  # The control stacks a main label over a sub-label ("Next" over "To Combat"),
  # and the two were being joined before matching. That broke both ways. At the
  # opponent's end step it reads "My Turn" over "End Turn", and the joined
  # string contains "End Turn", so a plain pass was refused every single turn.
  # Meanwhile a garbled main label ("K-" over "Resolve") still needs to work,
  # so permission has to look at the whole thing.
  main=$(echo "$label" | awk -F' / ' '{print $1}')
  if echo "$main" | grep -Eq '[0-9]+ (Attacker|Blocker)'; then main="COUNT:$main"; fi
  case "$main" in
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
    *)
      case "$label" in
        *Next*|*"To "*|*"Take Action"*|*OK*|*Submit*|*Done*|*Resolve*|*Pass*|*Continue*|*"My Turn"*) ok=1 ;;
      esac ;;
  esac
else
  # Tolerate the recogniser doubling a letter: "All Attack" arrives as "Alll Attack".
  # Fuzzy, because Vision substitutes letters as readily as it doubles them:
  # "All Attack" has come back as "Alll Attack" and "4 Attackers" as
  # "4 Aftackers", and an exact-ish regex refused a button that was plainly
  # there — which then needed a bare coordinate click, losing the safety check
  # the label was for. Fold lookalikes, drop non-letters, and accept a match
  # when nearly all of the wanted letters appear in order.
  if python3 -c "
import sys, unicodedata
HOM = str.maketrans({'\u0430':'a','\u0435':'e','\u043e':'o','\u0440':'p','\u0441':'c','\u0443':'y',
                     '\u0445':'x','\u0456':'i','\u0410':'A','\u0415':'E','\u041e':'O','\u0420':'P',
                     '\u0421':'C','\u0422':'T','\u0425':'X','\u041a':'K','\u0412':'B','\u041c':'M',
                     '\u041d':'H'})
def fold(t):
    t = unicodedata.normalize('NFKC', t).translate(HOM).lower()
    return ''.join(c for c in t if c.isalnum())
want, label = fold(sys.argv[1]), fold(sys.argv[2])
if want and want in label: sys.exit(0)
i = 0
for ch in label:
    if i < len(want) and ch == want[i]: i += 1
sys.exit(0 if want and i >= len(want) - 1 else 1)
" "$want" "$label"; then ok=1; fi
fi
if [ "$ok" = 1 ]; then macctl click MTGA 0.9250 0.8890 >/dev/null 2>&1; echo "step: clicked '$label'"; else echo "step: NOT clicking '$label' (wanted $want)"; exit 1; fi
