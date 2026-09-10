#!/usr/bin/env python3
"""Check every card name in the knowledge base against the real card list.

The knowledge base is written by language models, and the failure mode that
matters is not an omission but a confident invention: a card that does not exist,
cited with a mana cost, trusted mid-game when there is no time to check. This is
the mechanical defence. It resolves every card-shaped name in docs/kb/*.md
against the generated card file, and asks Scryfall about whatever is left.

Run it after any knowledge base edit.

    python3 scripts/check_kb_cards.py          # exits non-zero if anything is unresolved
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

KB = Path(__file__).resolve().parent.parent / "docs" / "kb"
UA = {"User-Agent": "mtga-kb/1.0", "Accept": "application/json"}

# A name is only treated as a card claim when a mana cost or a rarity marker
# follows it. Prose is full of Title Case that is not a card, and flagging all of
# it buries the one real error in ninety false ones.
NAME = re.compile(r"\b([A-Z][A-Za-z'\-]+(?: (?:of|the|to|a|an|in|on|and|de|del|for)? ?[A-Z][A-Za-z'\-]+){1,4})\b")
IS_CLAIM = (re.compile(r"\{[0-9WUBRGCX]"), re.compile(r"\((C|U|R|M)\)"))


def known_names(set_code="lci"):
    """Every string a writer might reasonably use for a card in this set.

    Three variations matter, all of them learned from false positives:
    a double-faced card is written by its front name; a legendary creature's
    "Malcolm, Alluring Scoundrel" is written as either half; and plurals and
    possessives appear constantly in prose."""
    cards = json.loads((KB / f"{set_code}-cards.json").read_text())["cards"]
    names = set()
    for full, card in cards.items():
        for variant in {full, card.get("frontName") or full}:
            for part in variant.split(" // "):
                part = part.strip()
                names |= {part.lower(), part.lower() + "s", part.lower().rstrip("s")}
                if "," in part:
                    before, after = part.split(",", 1)
                    names.add(before.strip().lower())
                    names.add(after.strip().lower())
                    names.add(after.strip().lower().removeprefix("the ").strip())
    return names


def in_scryfall_set(name, set_code):
    try:
        url = "https://api.scryfall.com/cards/named?fuzzy=" + urllib.parse.quote(name)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            return json.load(r).get("set", "").upper() == set_code.upper()
    except Exception:
        return False


def main():
    set_code = sys.argv[1].lower() if len(sys.argv) > 1 else "lci"
    known = known_names(set_code)
    unresolved, claims = {}, 0

    for path in sorted(KB.glob("*.md")):
        text = path.read_text()
        for match in NAME.finditer(text):
            raw = match.group(1).strip()
            tail = text[match.end():match.end() + 40]
            if not any(p.search(tail) for p in IS_CLAIM):
                continue
            claims += 1
            variants = {raw, re.sub(r"'s\b", "", raw).strip(), raw.rstrip("s"), raw + "s"}
            if not any(v.lower() in known for v in variants):
                unresolved.setdefault(raw, set()).add(path.name)

    print(f"{claims} card-name claims across {len(list(KB.glob('*.md')))} files")
    if not unresolved:
        print("all resolve to real cards in the set")
        return 0

    print(f"{len(unresolved)} unresolved locally; asking Scryfall")
    bad = []
    for name in sorted(unresolved):
        if not in_scryfall_set(name, set_code):
            bad.append((name, sorted(unresolved[name])))
        time.sleep(0.11)

    if not bad:
        print("all resolve to real cards in the set")
        return 0
    # Almost every one of these is prose the regex caught, not an invented card.
    # It still has to be read, because the one that is not prose is the one that
    # loses a game.
    print(f"\n{len(bad)} name(s) not found in {set_code.upper()} — read each one in context:")
    for name, files in bad:
        print(f"  {name:34} {', '.join(files)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
