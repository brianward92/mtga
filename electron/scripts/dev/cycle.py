#!/usr/bin/env python3
"""Run the game forward through one full cycle of routine play.

Ends our turn when there is nothing left to spend, carries through the
opponent's turn, plays our next land and creatures, and walks into combat —
stopping the moment a decision needs judgement: attackers, blockers, a target,
a choice, a damage split, or the game ending.

This is the throughput fix. A turn used to be eight or nine separate commands,
each costing a model round trip, and the round trips were measured at 85-90% of
a game's wall clock. What is automated here is only the part with no decision
in it; every choice that can lose a game is still handed back.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
STOP = {'attackers', 'blockers', 'targets', 'chooseN', 'assignDamage', 'mulligan', 'confirm'}
ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 3

def sh(script, *args, t=180):
    return subprocess.run(['bash', os.path.join(HERE, script), *args],
                          capture_output=True, text=True, timeout=t).stdout

def py(script, *args, t=300):
    return subprocess.run(['python3', os.path.join(HERE, script), *args],
                          capture_output=True, text=True, timeout=t).stdout

def state():
    raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(raw.strip().splitlines()[-1])

for rnd in range(ROUNDS):
    sh('hold.sh')
    st = state()
    if st.get('finished'):
        print(f"cycle: FINISHED winner={st['finished'].get('winner')} {st['finished'].get('reason','')}")
        break
    t, me = st['turn'], st['seat']
    dec = st.get('decision') or {}
    kind = dec.get('kind', 'none')
    ours = t.get('decisionPlayer') == me and kind != 'none'
    phase, active = t.get('phase'), t.get('activePlayer')

    if ours and kind in STOP:
        print(f"cycle: STOP — {kind}")
        break

    if active == me and phase == 'Phase_Main1' and ours:
        print(f"--- our turn {t.get('turnNumber')}: developing")
        out = py('turn.py')
        for line in out.splitlines():
            if line.startswith(('land:', 'cast:')) or 'not in hand' in line or 'backing out' in line:
                print('   ' + line.strip())
        sh('step.sh', 'Next')            # into combat; triggers stop us next round
        continue

    if active == me and phase in ('Phase_Main2', 'Phase_Ending') and ours:
        print(f"--- our turn {t.get('turnNumber')}: nothing left, ending")
        sh('step.sh', 'End Turn')
        continue

    out = py('go.py', '10')
    tail = [l for l in out.splitlines() if l.startswith('go:')]
    print('   ' + (tail[-1] if tail else 'go: (no line)'))
    if tail and 'FINISHED' in tail[-1]:
        break

py('plan.py')
