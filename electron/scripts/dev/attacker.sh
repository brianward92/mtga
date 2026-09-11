#!/usr/bin/env bash
# Where the opponent's attacking creature is on screen, for a block drag.
#
# Attackers animate down into the lane between the two battlefields, roughly
# y 220-340. Their lands sit ABOVE that, y≈170, and "topmost box" picked a
# Hidden Volcano over a 7/7 once, which cost a game. Stay in the lane and
# never return a land.
set -uo pipefail
# Tell the rope guard a real driver is working, so it stands down (see guard.ts).
touch /tmp/mtga-acting 2>/dev/null || true
macctl read MTGA --region 0.10,0.24,0.75,0.20 --boxes 2>/dev/null | python3 -c "
import json,sys,re
LAND=re.compile(r'volcano|swamp|cave|island|mountain|forest|plains|passage|tunnel|citadel|vents|maw|monument|grotto|lair|deeps', re.I)
bs=[b for b in json.load(sys.stdin).get('boxes',[])
    if len(b['text'].strip())>3 and b['at'][0]<1150 and 220<=b['at'][1]<=340
    and 'block' not in b['text'].lower() and not LAND.search(b['text'])]
for b in sorted(bs,key=lambda b:b['at'][0]): print(b['at'][0], b['at'][1], b['text'].strip())
"
