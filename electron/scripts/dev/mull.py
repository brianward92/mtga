#!/usr/bin/env python3
"""Wait for the mulligan prompt and answer it.

Keep two to five *coloured* sources in seven. The old rule counted lands, and
lost a game to it: it kept a hand whose two lands were both Mutavault, which
makes colourless mana, in a mono-white deck where every spell costs {W}. The
game was played to turn sixteen with no creature ever cast. A land that cannot
pay for anything in the deck is not a land for mulligan purposes.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from plan import card_names  # noqa: E402

# Lands that make no coloured mana. Short and grown by hand: the card database
# does not say what a land taps for in a form worth parsing, and the list of
# colourless lands that turn up in a constructed deck is small.
COLOURLESS = {'mutavault', 'wastes', 'shrine of the forsaken gods', 'blast zone',
              'crawling barrens', 'field of ruin', 'rogue' 's passage',
              'demolition field', 'hall of storm giants', 'faceless haven'}

deadline = time.time() + (int(sys.argv[1]) if len(sys.argv) > 1 else 120)
NAMES = card_names()

def state():
    raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(raw.strip().splitlines()[-1])

st = None
while time.time() < deadline:
    subprocess.run(['bash', os.path.join(HERE, 'hold.sh')])
    st = state()
    if (st.get('decision') or {}).get('kind') == 'mulligan':
        break
    time.sleep(2)
else:
    print("mull: no mulligan prompt in time"); sys.exit(1)

hand = st['hand']
lands, sources = [], []
for o in hand:
    if 'CardType_Land' not in (o.get('cardTypes') or []):
        continue
    nm = NAMES.get(o.get('grpId'), ('?', ''))[0]
    lands.append(nm)
    if nm.lower() not in COLOURLESS:
        sources.append(nm)

print(f"mull: {len(hand)} cards, {len(lands)} land ({', '.join(lands) or 'none'}), "
      f"{len(sources)} coloured source(s)")

# Always keep. A mulligan leads to a "Return N cards" screen whose ONLY
# interaction is dragging cards onto the library, and drag does not work in
# this client at all — not macctl's drag at any speed or step count, not a
# hand-built press-move-release, not click-then-click, not double-click. The
# screen cannot be answered, and the game is stuck there until Arena times it
# out. Until drag is solved, taking a mulligan is strictly worse than keeping
# whatever was dealt, however bad it is.
#
# The coloured-source count above is still printed, because it is the right
# rule and worth having the moment bottoming becomes reachable.
if True:
    for _ in range(5):
        subprocess.run(['bash', os.path.join(HERE, 'btn.sh'), 'Keep', '0.3,0.65,0.7,0.30', '2'],
                       capture_output=True, text=True, timeout=60)
        time.sleep(1.2)
        if (state().get('decision') or {}).get('kind') != 'mulligan':
            print("mull: kept"); sys.exit(0)
    print("mull: could not make the Keep click land"); sys.exit(3)

# Mulligan ONCE, then take whatever comes.
#
# A mulligan does not clear the mulligan decision — it deals a new seven and
# asks again — so a "click until the prompt goes away" loop is a loop that
# mulligans to nothing. It took this account to a four-card hand before anyone
# noticed. Progress is a NEW HAND, not the absence of the prompt, and one
# mulligan is the most this heuristic is confident enough to take.
before = [o['instanceId'] for o in hand]
print(f"mull: {len(sources)} coloured source(s) — taking one mulligan")
for _ in range(4):
    subprocess.run(['bash', os.path.join(HERE, 'btn.sh'), 'Mulligan', '0.3,0.65,0.7,0.30', '3'],
                   capture_output=True, text=True, timeout=60)
    time.sleep(2.2)
    now = state()
    fresh = [o['instanceId'] for o in now['hand']]
    if fresh != before:
        print(f"mull: mulliganed to a new hand of {len(fresh)}")
        sys.exit(0)
print("mull: could not make the Mulligan click land"); sys.exit(3)
