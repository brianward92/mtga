#!/usr/bin/env python3
"""Generate the combat reference for a set, computed from card data.

Deliberately generated rather than written. Everything in this file is a fact
about the card pool, and a fact about the card pool should never be recalled or
researched when it can be derived: a wrong power and toughness or a missed
deathtouch creature is a lost game, and prose written from memory is exactly
where those errors come from. If the card file is right, this file is right.

    python3 scripts/build_kb_combat.py LCI
"""

import json
import re
import sys
import hashlib
from datetime import date
from collections import defaultdict
from pathlib import Path

KB = Path(__file__).resolve().parent.parent / "docs" / "formats" / "lci"

# Keywords that change whether a block is legal or survivable. Ordered by how
# often they decide a combat, not alphabetically.
COMBAT_KEYWORDS = [
    "Flying",
    "Reach",
    "Menace",
    "Trample",
    "Deathtouch",
    "First strike",
    "Double strike",
    "Lifelink",
    "Vigilance",
    "Ward",
    "Hexproof",
    "Indestructible",
    "Protection",
    "Defender",
    "Flash",
]

# Effects that remove or shrink a creature. Matched against oracle text, so the
# patterns have to tolerate reminder text and templating variations.
REMOVAL = [
    ("destroy", re.compile(r"destroy target (creature|permanent)", re.I)),
    (
        "damage",
        re.compile(r"deals? (\d+|X) damage to target (creature|any target)", re.I),
    ),
    ("shrink", re.compile(r"gets? -\d+/-\d+", re.I)),
    ("exile", re.compile(r"exile target (creature|permanent)", re.I)),
    (
        "bounce",
        re.compile(
            r"return target (creature|permanent).{0,40}to (its|their) owner's hand",
            re.I,
        ),
    ),
    ("tap", re.compile(r"tap target creature", re.I)),
    ("sacrifice", re.compile(r"sacrifices? a creature", re.I)),
    ("fight", re.compile(r"\bfights?\b", re.I)),
]

PUMP = re.compile(r"gets? \+\d+/\+\d+", re.I)


def is_instant_speed(card):
    """Can this be cast during combat? Only these can ruin a block."""
    return "Instant" in card["type"] or "Flash" in (card.get("keywords") or [])


def colour_of(card):
    return card["colors"] or "C"


def table(rows, headers):
    widths = [
        max(len(str(r[i])) for r in ([headers] + rows)) for i in range(len(headers))
    ]
    out = [
        "| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)) + " |",
        "|" + "|".join("-" * (w + 2) for w in widths) + "|",
    ]
    for r in rows:
        out.append(
            "| " + " | ".join(str(c).ljust(widths[i]) for i, c in enumerate(r)) + " |"
        )
    return "\n".join(out)


def main():
    code = (sys.argv[1] if len(sys.argv) > 1 else "LCI").lower()
    card_path = KB / "cards.json"
    card_bytes = card_path.read_bytes()
    data = json.loads(card_bytes)
    cards = [c for c in data["cards"].values() if c.get("inDraftPool") is not False]
    creatures = [c for c in cards if "Creature" in c["type"]]

    parts = [
        f"# {code.upper()} combat reference",
        "",
        "> Use this when: deciding whether to attack or block, or working out what "
        "the opponent's open mana threatens.",
        "",
        "**Generated from `cards.json` by `scripts/build_kb_combat.py` on "
        + date.today().isoformat()
        + "; source SHA-256 `"
        + hashlib.sha256(card_bytes).hexdigest()
        + "`. "
        "Do not edit by hand.** Every number here is computed from the card pool, so it "
        "cannot drift from reality the way a written list does. Regenerate after any card "
        "file rebuild.",
        "",
        f"Draftable pool: **{len(cards)} cards**, of which **{len(creatures)} are creatures**.",
        "",
    ]

    # --- Evasion and combat keywords -------------------------------------
    parts += [
        "## Who has what",
        "",
        "Counts of draftable cards carrying each combat-relevant keyword, "
        'split by colour. This is the answer to "can anything in their colours '
        'block my flier" and "how likely is that blocker to have deathtouch".',
        "",
    ]
    rows = []
    for kw in COMBAT_KEYWORDS:
        by_colour = defaultdict(int)
        for c in cards:
            text = c["oracle"] or ""
            if kw in (c.get("keywords") or []) or re.search(
                rf"\b{re.escape(kw)}\b", text
            ):
                by_colour[colour_of(c)] += 1
        if not by_colour:
            continue
        total = sum(by_colour.values())
        rows.append(
            [kw, total]
            + [by_colour.get(x, 0) for x in "WUBRG"]
            + [by_colour.get("C", 0)]
        )
    parts += [table(rows, ["Keyword", "All", "W", "U", "B", "R", "G", "C"]), ""]

    # --- Creature bodies by cost -----------------------------------------
    parts += [
        "## What a creature costs",
        "",
        "The bodies actually in the format at each mana value. Use it to judge "
        "whether a trade is fair and what is likely to be on the other side of "
        "an unknown blocker.",
        "",
    ]
    rows = []
    for mv in range(0, 9):
        at = [c for c in creatures if (c["mv"] or 0) == mv]
        if not at:
            continue
        sizes = defaultdict(int)
        for c in at:
            try:
                sizes[f"{c['power']}/{c['toughness']}"] += 1
            except (KeyError, TypeError):
                pass
        common = sorted(sizes.items(), key=lambda kv: -kv[1])[:4]
        rows.append([mv, len(at), ", ".join(f"{s} x{n}" for s, n in common)])
    parts += [table(rows, ["MV", "Count", "Most common bodies"]), ""]

    # --- Instant-speed threats by cost -----------------------------------
    parts += [
        "## What open mana threatens",
        "",
        "Instant-speed only, because a sorcery cannot ruin a block and treating "
        "one as a threat is how you talk yourself out of a good attack. "
        "Read the row for the opponent's untapped mana.",
        "",
    ]
    rows = []
    for mv in range(0, 7):
        at = [c for c in cards if is_instant_speed(c) and (c["mv"] or 0) == mv]
        if not at:
            continue
        kills = [c for c in at if any(p.search(c["oracle"] or "") for _, p in REMOVAL)]
        pumps = [c for c in at if PUMP.search(c["oracle"] or "")]
        colours = "".join(sorted({colour_of(c) for c in at}))
        rows.append([mv, len(at), len(kills), len(pumps), colours])
    parts += [table(rows, ["Mana", "Instants", "Can kill", "Can pump", "Colours"]), ""]

    # --- The actual list, by colour --------------------------------------
    parts += [
        "## Every instant-speed card, by colour",
        "",
        'The full list, since "how many" is only useful up to the point where '
        'you need to know "which". Sorted by cost.',
        "",
    ]
    by_colour = defaultdict(list)
    for c in cards:
        if is_instant_speed(c):
            by_colour[colour_of(c)].append(c)
    for colour in ["W", "U", "B", "R", "G", "C"]:
        group = sorted(
            by_colour.get(colour, []), key=lambda c: (c["mv"] or 0, c["name"])
        )
        if not group:
            continue
        parts += [f"### {colour}", ""]
        rows = []
        for c in group:
            effect = (c["oracle"] or "").split("\n")[0]
            rows.append([c["manaCost"], c["name"], c["rarity"][0].upper(), effect])
        parts += [table(rows, ["Cost", "Name", "R", "Effect"]), ""]

    # --- Removal census ---------------------------------------------------
    parts += [
        "## Removal, at any speed",
        "",
        "Everything that answers a creature, including sorcery speed. Sorceries "
        "do not affect a block, but they do affect whether it is worth committing "
        "another creature to the board.",
        "",
    ]
    rows = []
    for kind, pattern in REMOVAL:
        hits = [c for c in cards if pattern.search(c["oracle"] or "")]
        if not hits:
            continue
        fast = sum(1 for c in hits if is_instant_speed(c))
        cheap = sorted(hits, key=lambda c: (c["mv"] or 0))[:3]
        rows.append(
            [
                kind,
                len(hits),
                fast,
                ", ".join(f"{c['name']} {c['manaCost']}" for c in cheap),
            ]
        )
    parts += [table(rows, ["Effect", "Count", "At instant speed", "Cheapest"]), ""]

    out = KB / "combat-reference.md"
    out.write_text("\n".join(parts) + "\n")
    print(f"wrote {out} ({len(parts)} blocks, {out.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
