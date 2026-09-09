#!/usr/bin/env python3
"""Small helpers over the mirrored DraftState. Usage: statecheck.py <state.json> pos | island <grpId>"""
import json, sys
s = json.load(open(sys.argv[1]))
cmd = sys.argv[2]

def basic(c):
    return c["rarity"] == "land" or str(c["type"]).startswith("Basic Land")

if cmd == "pos":
    print(f"{s['pack']}-{s['pick']}")
elif cmd == "island":
    g = int(sys.argv[3])
    c = next(c for c in s["cards"] if c["grpId"] == g)
    sys.exit(0 if basic(c) else 1)
elif cmd == "forced":
    # Exit 0 when there is nothing to protect the drafter from: a single card
    # left in the pack, or a pack of nothing but basics. The last pick of an
    # Arena pack is always forced, so refusing it there just stalls the draft.
    cards = s["cards"]
    sys.exit(0 if len(cards) <= 1 or all(basic(c) for c in cards) else 1)
