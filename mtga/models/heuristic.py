"""EV v0: the cold-start heuristic scorer.

Works from day 1 of any set: card quality comes from our own shrunk GIH WR
metrics when curated data exists, else from the cached 17Lands card_ratings
JSON (which is live within a day of set release and carries mtga_id — the
grpId bridge for sets cards.csv hasn't picked up yet). On top of the quality
z-score: a pool-color-fit bonus that scales with draft progression, and a
small early-pick rarity prior.

This file is meant to be edited — it is the "here's an idea to improve the
EV" playground. Anything smarter should become a new model class and beat the
incumbent in the backtest before promotion.
"""

import json

import numpy as np

from mtga.lands import paths
from mtga.models.base import rank_scores

MIN_GIH_GAMES = 200
COLOR_BONUS_MAX = 0.8  # z-units at full commitment for an on-lane card
RARITY_PRIOR = {"mythic": 0.5, "rare": 0.35, "uncommon": 0.1, "common": 0.0}
COMMITMENT_PICKS = 18  # pool size at which color commitment saturates


def _text(value):
    """Parquet string field with nulls flattened to '' (NaN is truthy, so
    `value or ""` silently keeps the float and crashes color parsing —
    colorless cards carry NaN color_identity in the card store)."""
    return value if isinstance(value, str) else ""


def _load_from_metrics(set_code, limited_type):
    dated = paths.metrics_cards_path(set_code, limited_type, "x")
    link = paths.latest_symlink(dated, prefix="cards_")
    if not link.exists():
        return None
    import pandas as pd

    from mtga.lands import cardstore

    frame = pd.read_parquet(link)
    frame = frame[frame["grp_id"].notna()]
    # Key every alias grpId (alt arts, bonus-sheet printings) to the same
    # record — real packs carry whichever printing's id Arena chose.
    _, aliases, _ = cardstore.name_resolution(set_code)
    cards = {}
    for row in frame.itertuples():
        record = {
            "name": row.name,
            "colors": _text(row.color_identity),
            "rarity": _text(row.rarity) or "common",
            "wr": row.gih_wr_shrunk,
            "n": int(row.gih_games) if row.gih_games == row.gih_games else 0,
        }
        for grp_id in aliases.get(row.name, [int(row.grp_id)]):
            cards.setdefault(grp_id, record)
    return cards or None


def _load_from_ratings(set_code, limited_type):
    link = paths.latest_symlink(
        paths.card_ratings_path(set_code, limited_type, "x")
    )
    if not link.exists():
        return None
    with open(link) as file:
        payload = json.load(file)
    cards = {}
    for row in payload:
        if not row.get("mtga_id"):
            continue
        cards[int(row["mtga_id"])] = {
            "name": row.get("name"),
            "colors": row.get("color") or "",
            "rarity": (row.get("rarity") or "common").lower(),
            "wr": row.get("ever_drawn_win_rate"),
            "n": row.get("ever_drawn_game_count") or 0,
        }
    return cards or None


def _quality_z(cards):
    """Per-card quality z-score with small-sample blend toward the rarity prior."""
    rates = np.array(
        [c["wr"] if c["wr"] is not None else np.nan for c in cards.values()],
        dtype=np.float64,
    )
    trusted = ~np.isnan(rates)
    trusted &= np.array([c["n"] >= MIN_GIH_GAMES for c in cards.values()])
    mean = np.nanmean(rates[trusted]) if trusted.any() else 0.55
    std = np.nanstd(rates[trusted]) if trusted.sum() > 5 else 0.03
    std = max(std, 1e-3)

    quality = {}
    for (grp_id, card), rate in zip(cards.items(), rates):
        prior = RARITY_PRIOR.get(card["rarity"], 0.0)
        if np.isnan(rate):
            quality[grp_id] = prior
        else:
            z = (rate - mean) / std
            weight = card["n"] / (card["n"] + MIN_GIH_GAMES)
            quality[grp_id] = weight * z + (1 - weight) * prior
    return quality


def pool_color_weights(pool_cards):
    """Weighted color counts over the pool, using each card's quality-free colors."""
    weights = {c: 0.0 for c in "WUBRG"}
    for card in pool_cards:
        colors = [c for c in (card.get("colors") or "") if c in weights]
        for c in colors:
            weights[c] += 1.0 / len(colors)
    return weights


def color_fit(card_colors, lane):
    colors = [c for c in (card_colors or "") if c in "WUBRG"]
    if not colors:
        return 0.7  # colorless / lands: playable anywhere, never "on lane"
    return sum(1 for c in colors if c in lane) / len(colors)


class HeuristicRatingsModel:
    model_kind = "heuristic-ratings"
    fallback = True

    def __init__(self, set_code, limited_type):
        self.set_code = set_code
        self.limited_type = limited_type
        cards = _load_from_metrics(set_code, limited_type)
        source = "own-metrics"
        if cards is None:
            cards = _load_from_ratings(set_code, limited_type)
            source = "17lands-site-cache"
        if cards is None:
            raise FileNotFoundError(
                f"no metrics or cached ratings for {set_code} {limited_type}"
            )
        self.cards = cards
        self.source = source
        self.quality = _quality_z(cards)
        self.model_id = f"{set_code}/{limited_type}/heuristic-{source}"

    def score_pack(self, pack_grp_ids, pool_grp_ids, pack_number=None, pick_number=None):
        pool_cards = [self.cards[g] for g in pool_grp_ids if g in self.cards]
        weights = pool_color_weights(pool_cards)
        lane = "".join(sorted(weights, key=weights.get, reverse=True)[:2])
        commitment = min(1.0, len(pool_grp_ids) / COMMITMENT_PICKS)

        evs = []
        for grp_id in pack_grp_ids:
            card = self.cards.get(grp_id)
            if card is None:
                evs.append(None)
                continue
            ev = self.quality[grp_id]
            ev += COLOR_BONUS_MAX * commitment * (color_fit(card["colors"], lane) - 0.5)
            evs.append(float(ev))
        return rank_scores(pack_grp_ids, evs)


class RarityColorHeuristic:
    """Absolute floor: rarity prior + color fit from the card store alone."""

    model_kind = "heuristic-rarity"
    fallback = True

    def __init__(self, set_code):
        from mtga.lands import cardstore

        store = cardstore.load_card_store()
        in_set = store[store["expansion"] == set_code]
        self.cards = {
            int(row.grp_id): {
                "colors": _text(row.color_identity),
                "rarity": (_text(row.rarity) or "common").lower(),
            }
            for row in in_set.itertuples()
        }
        self.model_id = f"{set_code}/*/heuristic-rarity"

    def score_pack(self, pack_grp_ids, pool_grp_ids, pack_number=None, pick_number=None):
        pool_cards = [self.cards[g] for g in pool_grp_ids if g in self.cards]
        weights = pool_color_weights(pool_cards)
        lane = "".join(sorted(weights, key=weights.get, reverse=True)[:2])
        commitment = min(1.0, len(pool_grp_ids) / COMMITMENT_PICKS)

        evs = []
        for grp_id in pack_grp_ids:
            card = self.cards.get(grp_id)
            if card is None:
                evs.append(None)
                continue
            ev = RARITY_PRIOR.get(card["rarity"], 0.0)
            ev += COLOR_BONUS_MAX * commitment * (color_fit(card["colors"], lane) - 0.5)
            evs.append(float(ev))
        return rank_scores(pack_grp_ids, evs)
