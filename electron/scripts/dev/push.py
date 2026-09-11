#!/usr/bin/env python3
"""Advance through the priority passes that carry no decision, and stop the
moment one does.

Most of a turn is the engine handing us priority in steps where we have nothing
to do, and each of those used to cost a model round trip — measured last session
at 85-90% of a game's wall clock. This walks them in one command and halts on
anything that commits material: attackers, blockers, targets, a choice, a damage
division. Those are where the games were actually lost, and they stay manual.

  push.py           advance up to 8 steps
  push.py 3         advance at most 3
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
STOP = {'attackers', 'blockers', 'targets', 'chooseN', 'assignDamage', 'mulligan', 'confirm'}
MAX = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8

def state():
    raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(raw.strip().splitlines()[-1])

for i in range(MAX):
    subprocess.run(['bash', os.path.join(HERE, 'hold.sh')])
    st = state()
    if st.get('finished'):
        print(f"FINISHED winner={st['finished'].get('winner')} {st['finished'].get('reason','')}")
        break
    dec = st.get('decision') or {}
    kind = dec.get('kind', 'none')
    ours = st['turn'].get('decisionPlayer') == st['seat'] and kind != 'none'
    if not ours:
        print(f"push: nothing asked of us ({kind})")
        break
    if kind in STOP:
        print(f"push: STOP — {kind}")
        break
    r = subprocess.run(['bash', os.path.join(HERE, 'step.sh')],
                       capture_output=True, text=True, timeout=60)
    line = (r.stdout.strip().splitlines() or [''])[0]
    print(f"  {line}")
    if 'NOT clicking' in line:
        break

subprocess.run(['python3', os.path.join(HERE, 'plan.py')])
