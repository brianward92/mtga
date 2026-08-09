"""Deck-building advice for a finished limited pool.

Complements the pick model, which scores cards but does not build decks. Three
kinds of advice, in descending order of how confident the data lets us be:

1. **Land split** — from pip weight across the deck's actual spells. Purely
   mechanical and the most reliably useful output: an even split in a deck
   whose pips are 2:1 loses games to color screw for no upside.
2. **Cuts** — the weakest playables, weighted toward observed 17Lands win rate
   over model EV where real data exists, with mana value as a tiebreak.
3. **Synergy notes** — read from oracle text. This is the gap the pick model
   cannot close: it scores cards from features and has no notion that a hybrid
   cost is castable in one color, that landcycling makes an expensive card
   never dead, or that a deck has a noncreature-spell payoff.

Castability is the load-bearing primitive. Hybrid pips are payable from EITHER
half, so `{2}{R/W}` is castable in mono-red — a distinction that decides
whether a card is a playable or a sideboard card.
"""

import re
from collections import Counter

from mtga.foundation.featurize import parse_mana_cost

WUBRG = "WUBRG"
_PIP_RE = re.compile(r"\{([^}]+)\}")
BASIC_FOR_COLOR = {
    "W": "Plains",
    "U": "Island",
    "B": "Swamp",
    "R": "Mountain",
    "G": "Forest",
}


def cost_pip_tokens(mana_cost):
    """Colored pip tokens as sets of payable colors: '{2}{R/W}' -> [{'R','W'}].

    Generic, X, colorless, and snow tokens carry no color requirement and are
    omitted. Phyrexian pips are treated as a color requirement (paying life is
    a real cost, and in limited you usually want the color anyway).
    """
    tokens = []
    for raw in _PIP_RE.findall(mana_cost or ""):
        token = raw.upper().strip()
        if not token or token.isdigit() or token in ("X", "Y", "Z", "C", "S"):
            continue
        colors = {c for c in token.split("/") if c in WUBRG}
        if colors:
            tokens.append(colors)
    return tokens


def is_castable(mana_cost, deck_colors):
    """True if every colored pip can be paid from `deck_colors`.

    An empty/unknown cost is treated as castable: artifacts and lands have no
    colored requirement, and an unknown cost should not silently demote a card.
    """
    colors = set(deck_colors)
    return all(token & colors for token in cost_pip_tokens(mana_cost))


def pip_weights(cards):
    """Colored pip counts across cards. Hybrid pips count for each half.

    Each card is a dict with at least `mana_cost`; `quantity` defaults to 1.
    """
    weights = Counter()
    for card in cards:
        qty = card.get("quantity", 1)
        for token in cost_pip_tokens(card.get("mana_cost")):
            for color in token:
                weights[color] += qty
    return weights


def deck_colors(cards, max_colors=2):
    """The deck's colors, by pip weight. Ties break in WUBRG order."""
    weights = pip_weights(cards)
    ranked = sorted(weights.items(), key=lambda kv: (-kv[1], WUBRG.index(kv[0])))
    return [color for color, _ in ranked[:max_colors]]


def recommend_lands(spells, land_slots, colors=None):
    """Basic-land counts proportional to pip weight, one land per color minimum.

    `spells` are the nonland cards actually in the deck. Largest-remainder
    apportionment, so the counts always sum to exactly `land_slots`.
    """
    colors = list(colors) if colors else deck_colors(spells)
    if not colors or land_slots <= 0:
        return {}

    weights = pip_weights(spells)
    total = sum(weights[c] for c in colors)
    if total <= 0:  # colorless deck: split evenly
        base, extra = divmod(land_slots, len(colors))
        return {
            BASIC_FOR_COLOR[c]: base + (1 if i < extra else 0)
            for i, c in enumerate(colors)
        }

    exact = {c: land_slots * weights[c] / total for c in colors}
    counts = {c: max(1, int(exact[c])) for c in colors}

    # Reconcile to land_slots: hand out remainders, then trim the most generous.
    while sum(counts.values()) < land_slots:
        color = max(colors, key=lambda c: (exact[c] - counts[c], weights[c]))
        counts[color] += 1
    while sum(counts.values()) > land_slots:
        trimmable = [c for c in colors if counts[c] > 1]
        if not trimmable:
            break
        color = min(trimmable, key=lambda c: (exact[c] - counts[c], weights[c]))
        counts[color] -= 1

    return {BASIC_FOR_COLOR[c]: n for c, n in counts.items() if n > 0}


def mana_curve(spells):
    """mana value -> count, for nonland cards."""
    curve = Counter()
    for card in spells:
        mv = int(parse_mana_cost(card.get("mana_cost") or "")["mv"])
        curve[mv] += card.get("quantity", 1)
    return dict(sorted(curve.items()))


# --- synergy -----------------------------------------------------------------

_SYNERGY_RULES = (
    (
        "landcycling",
        re.compile(r"\blandcycling\b", re.I),
        "cycles for a land, so extra copies are never dead draws",
    ),
    (
        "noncreature_payoff",
        re.compile(r"whenever you cast a noncreature spell", re.I),
        "pays off noncreature spells",
    ),
    (
        "artifact_payoff",
        re.compile(
            r"for each (?:other )?artifact you control|"
            r"artifact entered the battlefield",
            re.I,
        ),
        "scales with your artifact count",
    ),
    (
        "cost_reduction",
        re.compile(r"spells? you cast .*cost \{?[X0-9]", re.I),
        "reduces your spell costs",
    ),
    ("card_draw", re.compile(r"\bdraw (?:a|two|three) card", re.I), "draws cards"),
    (
        "removal",
        re.compile(
            r"\bdestroy target\b|\bexile target\b|"
            r"deals \d+ damage to (?:any target|target creature)",
            re.I,
        ),
        "removal",
    ),
)


def synergy_tags(oracle_text, type_line=""):
    """Rule keys matched by a card's text (order follows _SYNERGY_RULES)."""
    blob = f"{oracle_text or ''}\n{type_line or ''}"
    return [key for key, pattern, _ in _SYNERGY_RULES if pattern.search(blob)]


def synergy_notes(cards):
    """Deck-level synergy summary: rule key -> {reason, cards}.

    Only reports a theme when at least two cards share it, or when a single
    card's text is individually decision-relevant (landcycling).
    """
    hits = {}
    for card in cards:
        for key in synergy_tags(card.get("oracle_text"), card.get("type_line")):
            hits.setdefault(key, []).append(card.get("name"))

    reasons = {key: reason for key, _, reason in _SYNERGY_RULES}
    always_report = {"landcycling"}
    return {
        key: {"reason": reasons[key], "cards": names}
        for key, names in hits.items()
        if len(names) >= 2 or key in always_report
    }


# --- cuts --------------------------------------------------------------------


def cut_candidates(spells, target, alsa_late=6.5):
    """Weakest `len(spells) - target` playables, weakest first.

    Ranked on observed win rate when present, else the card's ALSA (how late
    the table lets it go) as a proxy, with high mana value breaking ties. Cards
    whose text makes them structurally fine (landcycling) are protected: mana
    value alone is a bad reason to cut a card that can be a land.
    """
    overage = sum(c.get("quantity", 1) for c in spells) - target
    if overage <= 0:
        return []

    def weakness(card):
        gih = card.get("gih_wr")
        alsa = card.get("alsa")
        protected = "landcycling" in synergy_tags(
            card.get("oracle_text"), card.get("type_line")
        )
        # Lower sorts first = cut first.
        if isinstance(gih, (int, float)):
            score = gih
        elif isinstance(alsa, (int, float)):
            # Map ALSA onto a win-rate-ish scale: later = weaker.
            score = 0.55 - max(0.0, alsa - alsa_late) * 0.01
        else:
            score = 0.53
        mv = int(parse_mana_cost(card.get("mana_cost") or "")["mv"])
        return (1 if protected else 0, score, -mv)

    ranked = sorted(spells, key=weakness)
    cuts, remaining = [], overage
    for card in ranked:
        if remaining <= 0:
            break
        take = min(card.get("quantity", 1), remaining)
        cuts.append({**card, "cut_quantity": take})
        remaining -= take
    return cuts


# --- top-level ---------------------------------------------------------------


def advise(cards, deck_size=40, land_slots=17, colors=None):
    """Full advice for a submitted deck.

    `cards` are the deck's cards as dicts: name, mana_cost, type_line,
    oracle_text, optional gih_wr / alsa / quantity. Lands in the list are
    detected from their type line and excluded from spell math, but nonbasic
    lands still count toward the land total.
    """
    spells, nonbasic_lands = [], []
    for card in cards:
        tline = card.get("type_line") or ""
        if "Land" in tline:
            if "Basic" not in tline:
                nonbasic_lands.append(card)
        else:
            spells.append(card)

    resolved = list(colors) if colors else deck_colors(spells)
    playables = [c for c in spells if is_castable(c.get("mana_cost"), resolved)]
    uncastable = [c for c in spells if c not in playables]

    nonbasic_count = sum(c.get("quantity", 1) for c in nonbasic_lands)
    basic_slots = max(0, land_slots - nonbasic_count)
    spell_target = deck_size - land_slots

    return {
        "colors": resolved,
        "pip_weights": dict(pip_weights(playables)),
        "spell_count": sum(c.get("quantity", 1) for c in playables),
        "spell_target": spell_target,
        "curve": mana_curve(playables),
        "lands": recommend_lands(playables, basic_slots, resolved),
        "nonbasic_lands": [c.get("name") for c in nonbasic_lands],
        "uncastable": [c.get("name") for c in uncastable],
        "cuts": cut_candidates(playables, spell_target),
        "synergies": synergy_notes(playables),
    }
