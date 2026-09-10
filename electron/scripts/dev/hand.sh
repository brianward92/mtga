#!/usr/bin/env bash
# Where each card in hand is on screen.
#
# Read in narrow vertical slices rather than one wide strip. The OCR merges
# every text box sharing a row into one line with no horizontal limit, so a
# single read of the hand returns all seven card names welded together with a
# centre point in the middle of the hand, which is on no card at all.
set -euo pipefail
Y="${1:-0.855}"      # top of the card-name row, as a fraction of the window
H="${2:-0.055}"
for i in $(seq 0 11); do
  X=$(python3 -c "print(f'{0.12 + $i*0.07:.4f}')")
  macctl read MTGA --region "$X,$Y,0.075,$H" 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
for l in d.get('lines',[]):
    t=l['text'].strip()
    if len(t)>2: print(f\"{l['at'][0]:5d} {l['at'][1]:4d}  {t}\")
"
done | sort -n | uniq
