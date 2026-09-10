#!/usr/bin/env python3
"""Look up cards from the local knowledge base. Built for use mid-match.

Every question this answers has a deadline attached, so it reads one local JSON
file and prints plain text. No network, no imports beyond the standard library.

    scripts/card.py "Bitter Triumph"           one card, in full
    scripts/card.py -s "destroy target"        search oracle text
    scripts/card.py --threat U 2               what 2 open blue mana can do to my attack
    scripts/card.py --top 15                   best cards in the set by win rate
    scripts/card.py --top 15 -c R --commons    best red commons
"""
import argparse
import json
import sys
from pathlib import Path

KB = Path(__file__).resolve().parent.parent / "docs" / "kb"


def load(code="lci"):
    path = KB / f"{code}-cards.json"
    if not path.exists():
        sys.exit(f"no card reference at {path}; run scripts/build_kb_cards.py {code.upper()}")
    return json.loads(path.read_text())["cards"]


# Below this many games a win rate is noise, not evidence. 17lands is currently
# serving only LCI's re-run, so most cards fall under it and print no rate at
# all — which is the correct output. A confident-looking number from 90 games
# would be worse than a blank.
MIN_GAMES = 300


def wr(card):
    """Win rate of decks that played the card, preferring the format being
    played. Returns the rate, its source, and its sample size."""
    for key in ("quickDraft", "premierDraft"):
        data = card.get(key) or {}
        rate, n = data.get("winRate"), data.get("n") or 0
        if rate is not None and n >= MIN_GAMES:
            return rate, key[0].upper(), n
    return None, " ", 0


def alsa(card):
    """Average pick number the card was last seen at. Lower is better. Survives
    small samples far better than a win rate does, so it is the fallback."""
    for key in ("quickDraft", "premierDraft"):
        value = (card.get(key) or {}).get("alsa")
        if value is not None:
            return value
    return None


def line(card, verbose=False):
    rate, src, _ = wr(card)
    seen = alsa(card)
    body = f"{card['power']}/{card['toughness']}" if card.get("power") is not None else ""
    if rate is not None:
        stats = f"{rate * 100:5.1f}%{src}"
    elif seen is not None:
        stats = f"p{seen:4.1f} "        # average pick seen at, the fallback signal
    else:
        stats = "   -   "
    head = f"  {stats}  {card['manaCost']:<10} {card['name']:<32} {card['rarity'][0].upper()}  {body:<6} {card['type']}"
    if not verbose:
        return head
    text = "\n".join("        " + l for l in (card["oracle"] or "").splitlines())
    return head + ("\n" + text if text else "")


def main():
    p = argparse.ArgumentParser(add_help=True)
    p.add_argument("name", nargs="*", help="card name, or part of one")
    p.add_argument("-s", "--search", help="search oracle text")
    p.add_argument("-c", "--colors", help="filter to these colours, e.g. UB")
    p.add_argument("--commons", action="store_true", help="commons only")
    p.add_argument("--instants", action="store_true", help="instant-speed only")
    p.add_argument("--top", type=int, help="best N by win rate")
    p.add_argument("--threat", nargs=2, metavar=("COLORS", "MANA"),
                   help="what the opponent can cast at instant speed with this much open mana")
    p.add_argument("--set", default="lci")
    args = p.parse_args()

    cards = load(args.set)
    pool = [c for c in cards.values() if c.get("inDraftPool") is not False]

    if args.threat:
        colors, mana = args.threat[0].upper(), int(args.threat[1])
        # Instant speed only: a sorcery cannot ruin a block, and treating one as
        # a threat is how you talk yourself out of a good attack.
        hits = [c for c in pool
                if ("Instant" in c["type"] or "Flash" in c.get("keywords", []))
                and (c["mv"] or 0) <= mana
                and (not c["colors"] or all(ch in colors for ch in c["colors"]))]
        # Cheapest first: with two mana open the two-drops are what to fear, and
        # a blank rate must not push a real threat down the list.
        hits.sort(key=lambda c: (c["mv"] or 0, alsa(c) or 9, c["name"]))
        print(f"{len(hits)} instant-speed cards castable off {mana} mana of {colors}:\n")
        for c in hits:
            print(line(c, verbose=True))
        return

    if args.search:
        needle = args.search.lower()
        hits = [c for c in pool if needle in (c["oracle"] or "").lower()]
    elif args.name:
        needle = " ".join(args.name).lower()
        hits = [c for c in pool if needle in c["name"].lower()]
    else:
        hits = list(pool)

    if args.colors:
        want = args.colors.upper()
        hits = [c for c in hits if c["colors"] and all(ch in want for ch in c["colors"])]
    if args.commons:
        hits = [c for c in hits if c["rarity"] == "common"]
    if args.instants:
        hits = [c for c in hits if "Instant" in c["type"] or "Flash" in c.get("keywords", [])]

    if args.top:
        # Rank by win rate where the sample supports it, otherwise by how early
        # drafters take the card. Mixing the two is deliberate: excluding every
        # card without a rate would throw away most of the set.
        scored = [c for c in hits if wr(c)[0] is not None or alsa(c) is not None]
        scored.sort(key=lambda c: (-(wr(c)[0] or 0), alsa(c) or 9))
        hits = scored[: args.top]
    else:
        hits.sort(key=lambda c: ((c["mv"] or 0), c["name"]))

    if not hits:
        print("no match")
        return
    verbose = len(hits) <= 12
    print(f"{len(hits)} card(s)   [win% of decks running it, Q/P = Quick/Premier; "
          f"pN = average pick seen at, lower is better]\n")
    for c in hits:
        print(line(c, verbose=verbose))


if __name__ == "__main__":
    main()
