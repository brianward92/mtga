#!/usr/bin/env python3
"""Say what we hold, what the engine will let us do with it, and what is across
the table — by name.

The state parser knows instance ids and the engine knows legality, but neither
knows that grpId 89123 is "Luminarch Aspirant". Arena's own card database does,
and it covers every set, which the per-set draft bundles do not. Joining the
three is what turns "Cast#165 is legal" into "you may cast Brave the Elements".
"""
import glob, json, os, shutil, sqlite3, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))

CACHE = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'mtga-carddb-snapshot.sqlite')

def card_names():
    """Resolve grpId -> (name, types), from a COPY of Arena's card database.

    Never open the live file. Arena keeps that database open while it runs, and
    this helper was opening it read-write on every single call — once per plan,
    per turn, per push. Arena then died with SIGSEGV inside sqlite3_step, in its
    own query path, mid-match. Whether or not the two facts are cause and
    effect, reading a running application's database out from under it is not
    something to keep doing to find out: snapshot it once and read the snapshot.
    """
    pats = [os.path.expanduser('~/Library/Application Support/com.wizards.mtga/Downloads/Raw/Raw_CardDatabase_*.mtga'),
            '/Users/Shared/Epic Games/MagicTheGathering/**/Raw_CardDatabase_*.mtga']
    files = [f for p in pats for f in glob.glob(p, recursive=True)]
    if not files: return {}
    live = max(files, key=os.path.getmtime)
    if not os.path.exists(CACHE) or os.path.getmtime(CACHE) < os.path.getmtime(live):
        shutil.copyfile(live, CACHE)
    db = sqlite3.connect(f'file:{CACHE}?mode=ro', uri=True)
    tabs = [r[0] for r in db.execute("select name from sqlite_master where type='table'")]
    loc = next((t for t in tabs if 'enus' in t.lower()), None)
    if not loc: return {}
    cols = [r[1] for r in db.execute(f"pragma table_info({loc})")]
    txt = 'Loc' if 'Loc' in cols else cols[-1]
    out = {}
    for g, n, types in db.execute(
            f"select c.GrpId, l.{txt}, c.Types from Cards c join {loc} l on l.LocId=c.TitleId"):
        out.setdefault(g, (n, types or ''))
    return out

def main():
    raw = subprocess.run(['npx', 'tsx', os.path.join(HERE, 'match.ts'), '--json'],
                         capture_output=True, text=True, timeout=60).stdout
    st = json.loads(raw.strip().splitlines()[-1])
    names = card_names()
    nm = lambda g: names.get(g, (f'grp{g}', ''))[0]

    t = st['turn']; me = st['seat']; them = 2 if me == 1 else 1
    mine_turn = t.get('activePlayer') == me
    print(f"turn {t.get('turnNumber')} {t.get('phase','')} {t.get('step','')} "
          f"({'OUR turn' if mine_turn else 'THEIR turn'})  life {st['life'].get(str(me))}-{st['life'].get(str(them))}")
    if st['finished']:
        print(f"FINISHED winner={st['finished'].get('winner')} {st['finished'].get('reason','')}")

    dec = st['decision'] or {}
    legal = {}
    for a in dec.get('actions', []):
        legal.setdefault(a.get('instanceId'), set()).add(a.get('actionType', '').replace('ActionType_', ''))

    print("hand:")
    for o in st['hand']:
        acts = ','.join(sorted(legal.get(o['instanceId'], []))) or '-'
        kind = (o.get('cardTypes') or ['?'])[0].replace('CardType_', '')
        mark = '>>' if acts != '-' else '  '
        print(f"  {mark} #{o['instanceId']:<4} {nm(o.get('grpId')):28s} {kind:10s} {acts}")

    for label, bf in (('mine ', st['myBattlefield']), ('theirs', st['theirBattlefield'])):
        cs = [o for o in bf if 'CardType_Creature' in (o.get('cardTypes') or [])]
        lands = [o for o in bf if 'CardType_Land' in (o.get('cardTypes') or [])]
        print(f"{label}: {len(lands)} land ({sum(1 for l in lands if not l['isTapped'])} untapped) · "
              f"{len(cs)} creature(s)")
        for c in cs:
            flags = ' '.join(f for f, v in (('tapped', c['isTapped']), ('sick', c['sick'])) if v)
            print(f"      #{c['instanceId']:<4} {nm(c.get('grpId')):28s} {c.get('power')}/{c.get('toughness')} {flags}")
    print(f"decision: {dec.get('kind', 'none')}" + ("  <-- OURS" if dec and t.get('decisionPlayer') == me else ""))

# Importing this module should cost nothing: turn.py wants card_names(), not a
# printed board.
if __name__ == '__main__':
    main()
