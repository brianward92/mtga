"""Name normalization for 17Lands <-> Scryfall joins (join layer, not data rewriting).

The rule, encoded once: normalize unicode (NFC) + casefold + strip on every
join. casefold alone fixes "Sol'kanar the Tainted" (DMU) — the only case
mismatch across 9k+ names. 17Lands ASCII-mangles non-ASCII names (e.g. TMT's
"Bespoke B?"); the irreducible aliases live in ALIASES_17L with keys already
norm()ed. Never auto-match '?' forms — a mangled name can't round-trip, so
new aliases are added here by hand (diagnostic passes may *suggest* them).
"""

import unicodedata


def norm(name):
    return unicodedata.normalize("NFC", name).casefold().strip()


# 17Lands ASCII-mangles non-ASCII; irreducible aliases live here (keys already norm()ed).
ALIASES_17L = {
    "bespoke b?": norm("Bespoke Bō"),  # TMT
    # HBG Alchemy rebalances Scryfall never minted as separate "A-" cards;
    # the base card's features are the best available proxy (2 of 8,850).
    "a-baba lysaga, night witch": norm("Baba Lysaga, Night Witch"),
    "a-monster manual": norm("Monster Manual // Zoological Study"),
}


def norm_17lands(name):
    n = norm(name)
    return ALIASES_17L.get(n, n)
