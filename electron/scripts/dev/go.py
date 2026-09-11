#!/usr/bin/env python3
"""Carry the game forward until something actually needs deciding.

await.sh waits for one decision and push.py answers the empty ones; on their
own they still cost a model round trip per priority pass, and an opponent's
turn is half a dozen of those. This alternates the two until the game reaches a
point worth a human thought: our own main phase, a combat decision, or the end.

Stops on: our Main1 (time to build), attackers/blockers/targets/chooseN/
assignDamage/mulligan/confirm (time to think), or the game finishing.

  go.py            up to 12 cycles
  go.py 4          at most 4
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STOP = {'attackers', 'blockers', 'targets', 'chooseN', 'assignDamage', 'mulligan', 'confirm'}
CYCLES = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 12

def state():
    raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(raw.strip().splitlines()[-1])

def hold(): subprocess.run(['bash', os.path.join(HERE, 'hold.sh')])

reason = 'ran out of cycles'
for i in range(CYCLES):
    hold()
    st = state()
    if st.get('finished'):
        reason = f"FINISHED winner={st['finished'].get('winner')} {st['finished'].get('reason','')}"
        break
    t = st['turn']; me = st['seat']
    dec = st.get('decision') or {}
    kind = dec.get('kind', 'none')
    ours = t.get('decisionPlayer') == me and kind != 'none'

    if ours and kind in STOP:
        reason = f"decision: {kind}"
        break
    if ours and kind == 'actions' and t.get('activePlayer') == me and t.get('phase') == 'Phase_Main1':
        reason = 'our main phase'
        break
    if ours:
        r = subprocess.run(['bash', os.path.join(HERE, 'step.sh')],
                           capture_output=True, text=True, timeout=60)
        line = (r.stdout.strip().splitlines() or [''])[0]
        if 'NOT clicking' in line:
            # "Opponent's Turn" (or a blank button) is not a refusal to act, it
            # is the engine telling us there is nothing to click yet: the log
            # still shows priority with us while the client has already moved
            # on. Waiting is the correct answer, not stopping.
            if "Opponent" in line or "NOT clicking ''" in line:
                subprocess.run(['bash', os.path.join(HERE, 'await.sh'), '30'],
                               capture_output=True, text=True, timeout=90)
                continue
            reason = f'step refused: {line}'
            break
        continue
    # Nothing asked of us: wait for the engine, briefly.
    subprocess.run(['bash', os.path.join(HERE, 'await.sh'), '45'],
                   capture_output=True, text=True, timeout=120)

print(f"go: stopped — {reason}")
subprocess.run(['python3', os.path.join(HERE, 'plan.py')])
