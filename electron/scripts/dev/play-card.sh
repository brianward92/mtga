#!/usr/bin/env bash
# Play or cast one card out of hand, by name.
#
# Double-click, not drag. Arena accepts a double-click on a card in hand as
# "play this", and in this client that is the ONLY thing it reliably accepts:
# a single click does nothing, and a drag from the card to the battlefield —
# which is what this script used to do, with a hover-settle and twelve steps of
# intermediate motion — also does nothing. Two clicks land the card every time,
# and cost about a second instead of three.
#
# The hand recentres after every play, so a position read before the previous
# card left is wrong. Re-scan, match the name, then click — never reuse a
# coordinate across two plays.
set -uo pipefail
# Tell the rope guard a real driver is working, so it stands down (see guard.ts).
touch /tmp/mtga-acting 2>/dev/null || true
here="$(cd "$(dirname "$0")" && pwd -P)"
want="$1"
# Match the name tolerantly. Vision clips the first glyph of a card sitting at
# the left edge of the crop often enough to matter — "Luminarch Aspirant" came
# back as "uminarch Aspirant" and a plain grep called the card absent while it
# was plainly in hand. So: substring first, then the same test ignoring the
# leading character, then a loose "most of the letters, in order" fallback.
# Look more than once. The hand physically recentres after every play, and a
# read taken during that animation returns the names it can see mid-slide —
# which is often not all of them. Both creatures of a two-cast turn were
# repeatedly reported "not in hand" while sitting plainly in it, costing a play
# a turn. Three looks, a beat apart, and only then call it absent.
match_in_hand() {
bash "$here/hand.sh" 0.72 0.28 2>/dev/null | python3 -c "
import sys, re
want = sys.argv[1].lower()
rows = [l.rstrip() for l in sys.stdin if l.strip()]
def text(r): return ' '.join(r.split()[2:]).lower()
def sub(w, t): return w in t
def skipfirst(w, t): return len(w) > 2 and w[1:] in t
def loose(w, t):
    w = re.sub(r'[^a-z]', '', w); t = re.sub(r'[^a-z]', '', t)
    if len(w) < 4: return False
    i = 0
    for ch in t:
        if i < len(w) and ch == w[i]: i += 1
    return i >= len(w) - 1 and i >= 4
for test in (sub, skipfirst, loose):
    for r in rows:
        if test(want, text(r)): print(r); sys.exit(0)
" "$1" | head -1
}
hit=""
for attempt in 1 2 3; do
  hit=$(match_in_hand "$want")
  [ -n "$hit" ] && break
  sleep 0.8
done
if [ -z "$hit" ]; then echo "play-card: '$want' is not in hand"; exit 1; fi
x=$(echo "$hit" | awk '{print $1}'); y=$(echo "$hit" | awk '{print $2}')
# Live geometry, never a cached rect: the window has moved between runs before.
read -r wx wy ww wh <<<"$(macctl window MTGA 2>/dev/null | python3 -c "
import json,sys; print(*json.load(sys.stdin)['window']['bounds'])")"
# Click below the title, on the art, but never below the window edge. With
# eight cards the outer ones sit so low that title+25 is past the bottom, and a
# press there lands on the Dock: Arena loses focus and the next input is lost.
read -r fx fy <<<"$(python3 -c "
y=min($y+25, $wy+$wh-8)
print(f'{($x-$wx)/$ww:.4f} {(y-$wy)/$wh:.4f}')")"
echo "play-card: '$want' at $x,$y -> double-click $fx,$fy"
macctl click MTGA "$fx" "$fy" --count 2 >/dev/null 2>&1
sleep 0.9
# Modal cards ask which half you meant. A channel land (Eiganjo) or a
# double-faced card opens a "Choose One" panel with the normal face on the left
# and the alternative on the right, and until one is picked the card is neither
# played nor in hand — so every later read says "not in hand" and the turn
# quietly stalls with a Cancel button on screen. Pick the left face, which is
# the one this script was asked for.
choice=$(macctl read MTGA --boxes 2>/dev/null | python3 -c "
import json, sys
try: bs = json.load(sys.stdin).get('boxes', [])
except Exception: sys.exit()
if not any('hoose One' in b['text'] for b in bs): sys.exit()
want = sys.argv[1].lower()[:8]
faces = [b for b in bs if want in b['text'].lower() and 300 < b['at'][1] < 560]
if faces:
    b = min(faces, key=lambda b: b['at'][0])
    print(b['at'][0], b['at'][1] + 60)
" "$want")
if [ -n "$choice" ]; then
  echo "play-card: 'Choose One' panel — taking the left face"
  bash "$here/click-at.sh" $choice
fi
npx tsx "$here/settle.ts" 4000 >/dev/null 2>&1
