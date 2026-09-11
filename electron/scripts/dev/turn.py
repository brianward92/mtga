#!/usr/bin/env python3
"""Do the boring half of our main phase: play a land, cast the creatures the
engine says we can afford, and stop.

Combat is deliberately NOT automated. Every game lost so far in this project
was lost in combat by a helper acting on its own — a block drag that landed on
nothing, an auto-submitted attack of three creatures that was meant to be one.
So this plays out the part with no decision in it (a land drop is free, an
unspent creature is waste) and hands back a named board for the part that has
one.

Casting order is most-expensive-first, re-reading legality after each cast,
because the engine's own legal-action list is the only honest account of what
we can still afford once mana is spent.

  turn.py            play a land, cast affordable creatures
  turn.py --dry      say what it would do
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from plan import card_names  # noqa: E402

DRY = '--dry' in sys.argv
NAMES = card_names()
name_of = lambda g: NAMES.get(g, (f'grp{g}', ''))[0]

def state():
    raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(raw.strip().splitlines()[-1])

def legal_by_instance(st):
    out = {}
    for a in (st.get('decision') or {}).get('actions', []):
        out.setdefault(a.get('instanceId'), []).append(a)
    return out

def cost_of(actions):
    """How much the engine says this costs, as a count of mana symbols."""
    n = 0
    for a in actions:
        for m in a.get('manaCost') or []:
            n += int(m.get('count', 1))
    return n

def mana_available(st):
    """How much we can actually pay, counted from the engine's own mana actions.

    The legal-action list is NOT an affordability list: Arena keeps offering
    Cast for cards we cannot pay for. Acting on that offer double-clicks the
    card, Arena picks it up waiting for mana that will never come, and the game
    sits in a modal with a Cancel button while the parser reports the useless
    "decision: other". Counting the distinct permanents that can still make
    mana is the engine's own answer to "what can we afford".
    """
    untapped = {o['instanceId'] for o in st['myBattlefield'] if not o['isTapped']}
    srcs = set()
    for a in (st.get('decision') or {}).get('actions', []):
        if a.get('actionType') == 'ActionType_Activate_Mana':
            srcs.add(a.get('instanceId'))
    # Intersect with what is actually untapped. The engine lists a mana ability
    # for a land it has already tapped, so counting the offers alone said we had
    # three mana with three tapped lands — and every cast attempted on that
    # basis got picked up and stranded behind a Cancel.
    srcs &= untapped
    if srcs:
        return len(srcs)
    return sum(1 for o in st['myBattlefield']
               if 'CardType_Land' in (o.get('cardTypes') or []) and o['instanceId'] in untapped)

def unstick():
    """If a cast got picked up and stranded, put it back — wherever Cancel is.

    Arena parks Cancel next to whatever it is waiting for, so it is NOT at a
    fixed spot: it sat at 1337,697 the first time and at 793,646 the next.
    Clicking the remembered coordinate did nothing, the cast stayed picked up,
    and every later play in the game reported "not in hand" because the hand was
    not what the client was showing. Find the button, then click it.
    """
    out = subprocess.run(['macctl', 'read', 'MTGA', '--boxes'],
                         capture_output=True, text=True, timeout=25).stdout
    try:
        boxes = json.loads(out).get('boxes', [])
    except Exception:
        return False
    hit = next((b for b in boxes if 'ancel' in b.get('text', '')), None)
    if not hit:
        return False
    print(f"     (backing out a stranded cast: Cancel at {hit['at']})")
    subprocess.run(['bash', os.path.join(HERE, 'click-at.sh'),
                    str(hit['at'][0]), str(hit['at'][1])], timeout=40)
    return True

def play(nm):
    print(f"  -> {nm}")
    if DRY: return True
    r = subprocess.run(['bash', os.path.join(HERE, 'play-card.sh'), nm],
                       capture_output=True, text=True, timeout=90)
    sys.stdout.write('     ' + (r.stdout.strip().splitlines() or [''])[0] + '\n')
    return 'is not in hand' not in r.stdout

st = state()
t = st['turn']; me = st['seat']
if t.get('activePlayer') != me or t.get('phase') not in ('Phase_Main1', 'Phase_Main2'):
    print(f"turn.py: not our main phase ({t.get('phase')}, active={t.get('activePlayer')}) — doing nothing")
    sys.exit(0)

# One land, because the rules allow one and skipping it is how a game is lost
# slowly rather than quickly.
legal = legal_by_instance(st)
land = next((o for o in st['hand']
             if 'CardType_Land' in (o.get('cardTypes') or [])
             and any(a['actionType'] == 'ActionType_Play' for a in legal.get(o['instanceId'], []))), None)
if land:
    print(f"land: {name_of(land.get('grpId'))}")
    play(name_of(land.get('grpId')))
else:
    print("land: none playable (already dropped, or none in hand)")

# Then creatures, dearest first, re-checking after each one.
tried: set[str] = set()
spent = None
while True:
    # Let the client catch up before asking what we can afford. Arena reports
    # the lands it has just tapped a beat late, so a state read taken straight
    # after a cast still shows the mana as available, and the next cast gets
    # picked up and stranded behind a Cancel.
    time.sleep(1.1)
    st = state()
    # Re-check the phase every pass, not just once at the top. Arena advances
    # on its own when we have nothing to do, so a loop that started in the main
    # phase can find itself in "Choose attackers" — where a creature cannot be
    # cast at all. The cast is then picked up, stranded behind a Cancel, and the
    # card that was meant to win the game sat in hand for four turns.
    ph = st['turn'].get('phase')
    if st['turn'].get('activePlayer') != me or ph not in ('Phase_Main1', 'Phase_Main2'):
        print(f"turn.py: phase moved to {ph} — stopping")
        break
    legal = legal_by_instance(st)
    # Trust our own arithmetic over a re-read. Arena reports the lands it just
    # tapped a beat late, so re-deriving available mana after every cast said we
    # could still afford two more one-drops with an empty board of tapped lands
    # — and it duly "cast" three creatures of which exactly one resolved.
    # Measure once, then subtract what we spend.
    have = mana_available(st) if spent is None else max(0, spent)
    cands = []
    for o in st['hand']:
        acts = [a for a in legal.get(o['instanceId'], []) if a['actionType'] == 'ActionType_Cast']
        if acts and 'CardType_Creature' in (o.get('cardTypes') or []):
            c = cost_of(acts)
            if c <= have:
                cands.append((c, name_of(o.get('grpId'))))
    if not cands:
        break
    cands.sort(reverse=True)
    # The engine's legal-action list is not an affordability list: Arena keeps
    # offering Cast for a card we cannot pay for, and the client greys that card
    # out, and a greyed name is what Vision fails to read. So "not in hand"
    # usually means "cannot actually afford it" — skip to the next candidate
    # rather than abandoning the rest of the turn, which is what the first
    # version did, leaving mana unspent every turn it happened.
    progressed = False
    for cost, nm in cands:
        if nm in tried or cost > have:
            continue
        print(f"cast: {nm} for {cost} (of {have} mana)")
        tried.add(nm)
        if DRY:
            progressed = False
            break
        if play(nm):
            if unstick():
                continue
            spent = have - cost
            progressed = True
            break
        unstick()
    if not progressed:
        break

subprocess.run(['python3', os.path.join(HERE, 'plan.py')])
