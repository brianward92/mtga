#!/usr/bin/env python3
"""Build the local card reference the play agent consults during a match.

The DraftFM set bundle already knows every draftable card's cost, colour and
rarity, because that is all the pick model needs. Playing needs the other half:
oracle text, power and toughness, and whether a spell is an instant. "Can this
block that profitably" and "what can they do with two open mana" are unanswerable
without it.

So this merges three sources into one file:

  * Scryfall        oracle text, power/toughness, type line, keywords
  * 17lands         empirical card quality, which beats anybody's opinion
  * the set bundle  which cards are actually in the draftable pool

Written to disk rather than fetched live because it is read under a turn timer,
and because a network hiccup mid-match must not be able to cost a game.

Usage:
    python3 scripts/build_kb_cards.py LCI
"""

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KB = REPO / "docs" / "formats" / "lci"
BUNDLE = Path("/Applications/MTGA Draft Assistant.app/Contents/Resources/draftfm/sets")
UA = "mtga-kb/1.0 (+local knowledge base build)"


def get(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
            print(f"  retry {attempt + 1} after {e}", file=sys.stderr)


def scryfall_set(code):
    """Every card in the set, following Scryfall's pagination."""
    cards, url = (
        [],
        f"https://api.scryfall.com/cards/search?q=e%3A{code.lower()}&unique=prints&order=set",
    )
    while url:
        page = get(url)
        cards.extend(page["data"])
        url = page.get("next_page") if page.get("has_more") else None
        time.sleep(0.1)  # Scryfall asks for 50-100ms between requests.
    return cards


def seventeen_lands(code, fmt):
    """Card performance, with its sample size, because the sample size is the
    story here.

    17lands' public endpoint serves only a recent rolling window. LCI's original
    November 2023 run is no longer in it, so what comes back is the current
    re-run: a few hundred games per card rather than the millions the set
    originally generated, and 17lands suppresses the drawn-based win rates below
    its sample threshold. Passing start_date and end_date changes nothing; three
    different windows returned byte-identical results.

    So the honest thing is to keep every field verbatim, keep the counts beside
    them, and let the reader see that most rates are absent. Returns {} rather
    than failing the build; the reference is worth having regardless."""
    url = f"https://www.17lands.com/card_ratings/data?expansion={code}&format={fmt}"
    try:
        rows = get(url, tries=2)
    except Exception as e:
        print(f"  17lands {fmt} unavailable ({e})", file=sys.stderr)
        return {}
    out = {}
    for row in rows or []:
        name = row.get("name")
        if not name:
            continue
        out[name] = {
            # Win rate of decks that ran the card. The only rate populated at
            # this sample size, and the weakest of the three, but real.
            "winRate": row.get("win_rate"),
            "n": row.get("game_count"),
            # Usually suppressed at this sample size. Kept so the file does not
            # silently become wrong if 17lands backfills the historical data.
            "gihWR": row.get("ever_drawn_win_rate"),
            "gihN": row.get("ever_drawn_game_count"),
            # Average pick number the card was still available at. Lower means
            # drafters took it earlier. Populated even when the rates are not.
            "alsa": row.get("avg_seen"),
            "playRate": row.get("play_rate"),
        }
    return out


def face(card, key, default=None):
    """Read a field that lives on the card, or on its first face if it is a
    double-faced card. Getting this wrong silently drops every DFC's text."""
    if key in card:
        return card[key]
    faces = card.get("card_faces") or []
    return faces[0].get(key, default) if faces else default


def main():
    code = (sys.argv[1] if len(sys.argv) > 1 else "LCI").upper()
    KB.mkdir(parents=True, exist_ok=True)

    print(f"fetching {code} from Scryfall...")
    raw = scryfall_set(code)
    print(f"  {len(raw)} printings")

    pool = set()
    bundle = BUNDLE / code / "cards.json"
    if bundle.exists():
        pool = set(json.loads(bundle.read_text())["cards"].keys())
        print(f"  {len(pool)} cards in the draftable pool per the set bundle")

    print("fetching 17lands ratings...")
    quick = seventeen_lands(code, "QuickDraft")
    premier = seventeen_lands(code, "PremierDraft")
    print(f"  quick={len(quick)} premier={len(premier)}")

    cards, seen = {}, set()
    for c in raw:
        name = c["name"]
        # Alchemy rebalances are printed into the set but are not draftable, and
        # having both "Geological Appraiser" and "A-Geological Appraiser" in a
        # lookup is actively confusing when the answer is needed in seconds.
        if name.startswith("A-"):
            continue
        # Scryfall names a double-faced card "Front // Back"; the set bundle,
        # Arena and every human use the front face alone. Matching on the full
        # string silently drops all 36 of LCI's DFCs from the draftable pool,
        # which is a third of the artifacts and every transforming Cave.
        front = name.split(" // ")[0]
        if name in seen:
            continue
        seen.add(name)
        oracle = face(c, "oracle_text", "") or ""
        if c.get("card_faces") and not c.get("oracle_text"):
            oracle = "\n//\n".join(f.get("oracle_text", "") for f in c["card_faces"])
        cards[name] = {
            "name": name,
            "manaCost": face(c, "mana_cost", "") or "",
            "mv": c.get("cmc"),
            "type": face(c, "type_line", "") or "",
            "power": face(c, "power"),
            "toughness": face(c, "toughness"),
            "oracle": oracle,
            "keywords": c.get("keywords", []),
            "colors": "".join(face(c, "colors", []) or []),
            "rarity": c.get("rarity"),
            "frontName": front,
            "inDraftPool": (front in pool or name in pool) if pool else None,
            "quickDraft": quick.get(name),
            "premierDraft": premier.get(name),
        }

    out = KB / "cards.json"
    out.write_text(
        json.dumps(
            {
                "set": code,
                "buildDate": date.today().isoformat(),
                "scryfallSnapshot": f"set:{code.lower()}@{date.today().isoformat()}",
                "seventeenLandsSnapshot": f"{code} QuickDraft+PremierDraft@{date.today().isoformat()}",
                "builtFrom": ["scryfall", "17lands"],
                "count": len(cards),
                "cards": cards,
            },
            indent=1,
            sort_keys=True,
        )
    )
    print(f"wrote {out} ({len(cards)} cards, {out.stat().st_size // 1024}KB)")

    def has_rate(c):
        return any(
            (c.get(k) or {}).get("winRate") is not None
            for k in ("quickDraft", "premierDraft")
        )

    rated = sum(1 for c in cards.values() if has_rate(c))
    in_pool = sum(1 for c in cards.values() if c["inDraftPool"])
    if pool and in_pool < len(pool):
        missing = sorted(pool - {c["frontName"] for c in cards.values()})
        print(
            f"  WARNING: {len(missing)} bundle cards unmatched: {missing[:5]}",
            file=sys.stderr,
        )
    creatures = sum(1 for c in cards.values() if "Creature" in c["type"])
    instants = sum(1 for c in cards.values() if "Instant" in c["type"])
    print(
        f"  {in_pool} in the draftable pool, {creatures} creatures, "
        f"{instants} instants, {rated} with a usable win rate"
    )
    if rated < len(cards) // 2:
        print(
            "  NOTE: 17lands is serving only the current re-run, so most rates are "
            "suppressed for sample size. Card evaluation should lean on the "
            "written set review, not on these numbers.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
