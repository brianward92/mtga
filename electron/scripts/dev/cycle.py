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

stuck = 0
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

    if ours and kind == 'chooseN':
        # A cleanup discard is not a decision worth a model round trip, and it
        # arrives every single turn once the hand is full. Anything else that
        # asks us to choose N still stops.
        screen = subprocess.run(['macctl', 'read', 'MTGA'], capture_output=True,
                                text=True, timeout=25).stdout
        if 'iscard' in screen:
            print("--- cleanup discard")
            out = sh('discard.sh')
            print('   ' + (out.strip().splitlines() or ['(no output)'])[-1])
            continue

    if ours and kind in STOP:
        print(f"cycle: STOP — {kind}")
        break

    if active == me and phase == 'Phase_Main1' and not ours:
        # Our main phase, priority not handed over yet. Wait for it rather than
        # advancing past the only window in which a land can be played.
        sh('await.sh', '20')
        continue

    if active == me and phase == 'Phase_Main1' and ours:
        print(f"--- our turn {t.get('turnNumber')}: developing")
        out = py('turn.py')
        for line in out.splitlines():
            if line.startswith(('land:', 'cast:')) or 'not in hand' in line or 'backing out' in line:
                print('   ' + line.strip())
        sh('step.sh', 'Next')            # into combat; triggers stop us next round
        continue

    if active == me and phase in ('Phase_Main2', 'Phase_Ending') and ours:
        # "End Turn" is the label in second main, but by the end step the button
        # says whatever the engine is waiting on — "Resolve" with something on
        # the stack. Asking for End Turn there refuses forever, and the loop
        # span in place printing the same line.
        print(f"--- our turn {t.get('turnNumber')}: nothing left, ending ({phase})")
        out = sh('step.sh', 'End Turn') if phase == 'Phase_Main2' else ''
        if not out or 'NOT clicking' in out:
            # Second main does not always say "End Turn": with something still
            # resolving it reads "Next / To End", and insisting on the words
            # stalled the loop in place. A plain advance is the same click.
            out = sh('step.sh')
        if 'NOT clicking' in out:
            print('   ' + out.strip().splitlines()[0])
            stuck += 1
            if stuck >= 2:
                print('cycle: stuck on the step button — stopping')
                break
        continue

    out = py('go.py', '10')
    tail = [l for l in out.splitlines() if l.startswith('go:')]
    print('   ' + (tail[-1] if tail else 'go: (no line)'))
    if tail and 'FINISHED' in tail[-1]:
        break

py('plan.py')
