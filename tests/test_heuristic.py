"""mtga/models/heuristic.py: color math and the cold-start ratings scorer.

Quality hand-math for the synthetic ratings (see _synth.ratings_rows):
  rates [.62, .60, .59, .55] -> mean .59; 4 trusted cards (not > 5) -> std .03
  z = [1, 1/3, 0, -4/3]; weight = 5000/5200 = 25/26; prior 0 (all common)
  quality: A 25/26 ~= .9615, B 25/78 ~= .3205, C 0, D -50/39 ~= -1.2821
"""

import pandas as pd
import pytest

from _synth import CARD_A, CARD_B, CARD_C, CARD_D, FMT, SET
from mtga.lands import paths
from mtga.models import heuristic
from mtga.models.heuristic import (
    HeuristicRatingsModel,
    RarityColorHeuristic,
    color_fit,
    pool_color_weights,
)


def test_pool_color_weights_splits_multicolor():
    weights = pool_color_weights([
        {"colors": "WU"},   # split 0.5 / 0.5
        {"colors": "W"},
        {"colors": "WUB"},  # split 1/3 each
        {"colors": ""},     # colorless: contributes nothing
        {"colors": None},
    ])
    assert weights["W"] == pytest.approx(0.5 + 1 + 1 / 3)
    assert weights["U"] == pytest.approx(0.5 + 1 / 3)
    assert weights["B"] == pytest.approx(1 / 3)
    assert weights["R"] == 0.0 and weights["G"] == 0.0


def test_color_fit():
    assert color_fit("", "WU") == 0.7    # colorless: playable anywhere
    assert color_fit(None, "WU") == 0.7
    assert color_fit("W", "WU") == 1.0   # on lane
    assert color_fit("WB", "WU") == 0.5  # half on lane
    assert color_fit("R", "WU") == 0.0   # off lane
    assert color_fit("XR", "WU") == 0.0  # junk letters ignored


def test_ratings_model_empty_pool_is_pure_quality(ratings_cache):
    model = HeuristicRatingsModel(SET, FMT)
    assert model.source == "17lands-site-cache"
    assert model.fallback is True
    assert len(model.cards) == 4  # the mtga_id-less row was skipped

    scores = model.score_pack([104, 101, 103], [])
    # commitment = 0 with an empty pool: ranking is quality alone.
    assert [s.grp_id for s in scores] == [101, 103, 104]
    assert scores[0].ev == pytest.approx(25 / 26)
    assert scores[1].ev == pytest.approx(0.0)
    assert sum(s.prob for s in scores) == pytest.approx(1.0)


def test_ratings_model_committed_pool_prefers_on_lane(ratings_cache):
    model = HeuristicRatingsModel(SET, FMT)
    # 18x grp 104 ("G") saturates commitment; lane = "GW" (W wins the
    # zero-weight tiebreak by WUBRG order).
    pool = [104] * 18
    scores = {s.grp_id: s for s in model.score_pack([101, 102], pool)}
    # A (R, off-lane): 25/26 + 0.8*(0 - .5) = .5615
    # B (W, on-lane): 25/78 + 0.8*(1 - .5) = .7205 -> outranks the better card
    assert scores[101].ev == pytest.approx(25 / 26 - 0.4)
    assert scores[102].ev == pytest.approx(25 / 78 + 0.4)
    assert scores[102].rank == 1
    assert scores[101].rank == 2


def test_ratings_model_unknown_grp_id_ranks_last(ratings_cache):
    model = HeuristicRatingsModel(SET, FMT)
    scores = model.score_pack([999, 101], [])
    assert [s.grp_id for s in scores] == [101, 999]
    assert scores[1].ev is None and scores[1].prob is None


def test_ratings_model_raises_without_any_source(data_root):
    with pytest.raises(FileNotFoundError):
        HeuristicRatingsModel(SET, FMT)


@pytest.fixture
def metrics_cache(card_store):
    """Own-metrics parquet (+ latest symlink) with the same numbers as the
    ratings fixture, so the quality hand-math above carries over."""
    frame = pd.DataFrame({
        "name": [CARD_A, CARD_B, CARD_C, CARD_D, "No Grp"],
        "grp_id": [101.0, 102.0, 103.0, 104.0, None],
        "color_identity": ["R", "W", "U", "G", "W"],
        "rarity": ["common"] * 5,
        "gih_wr_shrunk": [0.62, 0.60, 0.59, 0.55, 0.50],
        "gih_games": [5000.0, 5000.0, 5000.0, 5000.0, 10.0],
    })
    dated = paths.metrics_cards_path(SET, FMT, "2026-01-01")
    dated.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(dated, index=False)
    paths.repoint_latest(dated, prefix="cards_")
    return dated


def test_metrics_model_preferred_and_aliases_share_record(
    metrics_cache, ratings_cache
):
    model = HeuristicRatingsModel(SET, FMT)
    assert model.source == "own-metrics"  # metrics beat the site cache
    # Every alias grpId of Lightning Bolt keys the same record: real packs
    # carry whichever printing's id Arena chose.
    assert model.cards[101] is model.cards[201] is model.cards[301]
    assert 999 not in model.cards
    # grp_id-less rows were dropped, aliases added 201/301.
    assert set(model.cards) == {101, 201, 301, 102, 103, 104}

    # Quality math differs from the ratings path: the alias grpIds put card
    # A's record in the population 3 times, so over rates
    # [.62, .62, .62, .60, .59, .55]: mean .60; 6 trusted (> 5) -> real std
    # sqrt(0.0038/6); z_A = .02/std; z_B = 0.
    std = (0.0038 / 6) ** 0.5
    scores = {s.grp_id: s for s in model.score_pack([301, 102], [104] * 18)}
    assert scores[301].ev == pytest.approx(25 / 26 * (0.02 / std) - 0.4)
    assert scores[102].ev == pytest.approx(0.4)  # z 0, on-lane bonus only
    assert scores[102].rank == 1


def test_rarity_color_heuristic_floor(card_store):
    model = RarityColorHeuristic(SET)
    assert model.model_id == f"{SET}/*/heuristic-rarity"

    # Empty pool: pure rarity prior (rare .35 > common 0).
    scores = model.score_pack([103, 104], [])
    assert [s.grp_id for s in scores] == [103, 104]
    assert scores[0].ev == pytest.approx(heuristic.RARITY_PRIOR["rare"])
    assert scores[1].ev == pytest.approx(0.0)

    # Committed G pool -> lane GW: on-lane uncommon (W, .1+.4) beats
    # off-lane rare (U, .35-.4).
    scores = {s.grp_id: s for s in model.score_pack([102, 103], [104] * 18)}
    assert scores[102].ev == pytest.approx(0.5)
    assert scores[103].ev == pytest.approx(-0.05)
    assert scores[102].rank == 1

    # Unknown grpId degrades to ev None, never a KeyError.
    assert model.score_pack([999], [])[0].ev is None


def test_rarity_heuristic_survives_null_store_fields(card_store):
    """Colorless cards carry NaN color_identity in the real card store
    (2,961 of ~25k rows); NaN is truthy so `x or ''` must not be trusted."""
    import numpy as np
    import pandas as pd

    from mtga.lands import paths

    store = pd.read_parquet(paths.CARD_STORE_PARQUET)
    store.loc[store["grp_id"] == 104, ["color_identity", "rarity"]] = np.nan
    store.to_parquet(paths.CARD_STORE_PARQUET, index=False)

    model = RarityColorHeuristic(SET)
    assert model.cards[104] == {"colors": "", "rarity": "common"}
    # Scores both as pack candidate and as pool context without crashing.
    scores = model.score_pack([103, 104], [104, 104], 0, 2)
    assert all(s.ev is not None for s in scores)
