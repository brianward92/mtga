#!/usr/bin/env python3
"""Small helpers over the mirrored DraftState. Usage: statecheck.py <state.json> pos | island <grpId>"""
import json, sys
s = json.load(open(sys.argv[1]))
cmd = sys.argv[2]
if cmd == "pos":
    print(f"{s['pack']}-{s['pick']}")
elif cmd == "island":
    g = int(sys.argv[3])
    c = next(c for c in s["cards"] if c["grpId"] == g)
    sys.exit(0 if (c["rarity"] == "land" or str(c["type"]).startswith("Basic Land")) else 1)
