#!/usr/bin/env python3
"""Click our (or their) best creature, for a trigger that wants a target.

Power comes from the game log, position comes from OCR, and the two are matched
by name. Reading power off the screen does not work: a rules tooltip parks over
the board often enough that every power/toughness box becomes unreadable at
once, and a helper that ranked creatures by what it could see then ranked
nothing at all. The log always knows what each creature is; the screen is only
needed for where it is.

  target-best.py            ours, highest power
  target-best.py theirs     theirs, highest power
  target-best.py theirs low theirs, LOWEST power (a chump, a mana dork)
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from plan import card_names  # noqa: E402

side = sys.argv[1] if len(sys.argv) > 1 else 'mine'
lowest = len(sys.argv) > 2 and sys.argv[2] == 'low'
NAMES = card_names()

raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                     capture_output=True, text=True, timeout=60).stdout
st = json.loads(raw.strip().splitlines()[-1])
bf = st['myBattlefield'] if side == 'mine' else st['theirBattlefield']
creatures = [c for c in bf if 'CardType_Creature' in (c.get('cardTypes') or [])]
if not creatures:
    print(f"target-best: no creatures on the {side} board"); sys.exit(1)

rows = subprocess.run(['bash', os.path.join(HERE, 'board.sh'), side],
                      capture_output=True, text=True, timeout=90).stdout.splitlines()
seen = []
for line in rows:
    f = line.split()
    if len(f) >= 5:
        seen.append((int(f[0]), int(f[1]), ' '.join(f[4:]).lower()))

def norm(t):
    return re.sub(r'[^a-z]', '', t.lower())

def find_pos(name):
    """Match a log name to an OCR row, tolerating a clipped first glyph."""
    n = norm(name)
    for x, y, text in seen:
        t = norm(text)
        if not t:
            continue
        if t in n or n in t or (len(n) > 3 and n[1:] in t) or (len(t) > 3 and t[1:] in n):
            return x, y
    return None

ranked = sorted(creatures, key=lambda c: (c.get('power') or 0), reverse=not lowest)
for c in ranked:
    nm = NAMES.get(c.get('grpId'), (f"grp{c.get('grpId')}", ''))[0]
    pos = find_pos(nm)
    if pos:
        print(f"target-best: {side} {nm} {c.get('power')}/{c.get('toughness')} at {pos[0]},{pos[1]}")
        subprocess.run(['bash', os.path.join(HERE, 'click-at.sh'), str(pos[0]), str(pos[1])], timeout=60)
        sys.exit(0)
    print(f"target-best: {nm} is on the board but not locatable on screen")
print("target-best: could not place any creature on screen")
sys.exit(1)
