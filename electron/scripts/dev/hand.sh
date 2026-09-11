#!/usr/bin/env bash
touch /tmp/mtga-acting 2>/dev/null || true
# Where each card in hand is on screen, in one capture.
#
# --boxes returns Vision's individual text boxes instead of merged lines. The
# merge joins everything sharing a row, which welds a whole hand of card names
# into one string centred on no card at all. Working around that by reading the
# row through a dozen narrow crops cost about twelve seconds per turn; this is
# under one.
set -euo pipefail
Y="${1:-0.78}"; H="${2:-0.22}"   # generous: the hand arcs, and a tight crop clips the names entirely
macctl read MTGA --region "0.05,$Y,0.90,$H" --boxes 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
for b in sorted(d.get('boxes',[]), key=lambda b: b['at'][0]):
    t=b['text'].strip()
    if len(t)>2: print(f\"{b['at'][0]:5d} {b['at'][1]:4d}  {t}\")
"
