#!/usr/bin/env bash
# Where each creature on the battlefield is, and where to click it.
#
# A name box marks a card's LEFT edge, not its centre, and clicking the name's
# x on a tight row hits the neighbour. The power/toughness box under a creature
# is horizontally centred on the card, so it is a far better anchor: pair each
# name with the nearest P/T below it and click that x.
#
#   board.sh            both halves
#   board.sh mine       our row only  (y 400-520)
#   board.sh theirs     their row only (y 150-330)
set -uo pipefail
touch /tmp/mtga-acting 2>/dev/null || true
which="${1:-both}"
macctl move MTGA 0.12 0.20 >/dev/null 2>&1; sleep 0.30
macctl read MTGA --region 0.07,0.15,0.80,0.65 --boxes 2>/dev/null | python3 -c "
import json, re, sys
which = sys.argv[1]
bs = json.load(sys.stdin).get('boxes', [])
pt   = [b for b in bs if re.fullmatch(r'\d{1,2}\s*/\s*\d{1,2}', b['text'].strip())]
# Card names only. Two things masquerade as names: the rules-text tooltip that
# Arena parks in the right-hand column when a card is hovered or a trigger is on
# the stack, and stray fragments of it. Drop that column outright, and drop
# anything too long to be a title.
name = [b for b in bs
        if 3 < len(b['text'].strip()) <= 34
        and b['at'][0] < 1200
        and not re.fullmatch(r'[\d/ ]+', b['text'].strip())]
LANES = {'theirs': (140, 340), 'mine': (380, 540)}
used = set()
for n in sorted(name, key=lambda b: (b['at'][1], b['at'][0])):
    nx, ny = n['at']
    lane = next((k for k, (lo, hi) in LANES.items() if lo <= ny <= hi), None)
    if lane is None or (which != 'both' and lane != which): continue
    # the P/T that belongs to this card: below it, and nearest horizontally
    # Claim each P/T box once. Sharing one between two names put two different
    # creatures at the same click point, and the second click hit the first
    # card — which is exactly how a targeted trigger lands on the wrong body.
    below = [p for p in pt if 10 < p['at'][1] - ny < 110 and abs(p['at'][0] - nx) < 120
             and id(p) not in used]
    if below:
        p = min(below, key=lambda p: abs(p['at'][0] - nx))
        used.add(id(p))
        print(f\"{p['at'][0]} {ny + 40} {lane} {p['text'].strip()} {n['text'].strip()}\")
    else:
        # No readable power/toughness — the box is small and Vision drops it
        # often enough. Do NOT drop the creature with it: a card the helper
        # cannot see is a card the helper cannot click, and that turned a
        # 'choose a creature' prompt into a dead end mid-game. Fall back to the
        # name's left edge plus half a card width.
        print(f\"{nx + 45} {ny + 40} {lane} ?/? {n['text'].strip()}\")
" "$which"
