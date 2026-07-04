"""mtga/models/registry.py: the five-step model resolution chain.

The make_onnx_version fixture exports Linear(4,4) with zero weights and a
known bias, so vocab slot i always scores bias[i] — rankings are exact.
The DraftFM tier uses make_foundation_version + draftfm_assets with the
stubbed ORT session (see _synth.StubOrtSession).
"""

import pytest

from _synth import FMT, SET
from mtga.models import registry
from mtga.models.draftfm import OnnxDraftFMModel
from mtga.models.heuristic import HeuristicRatingsModel, RarityColorHeuristic


def test_trained_latest_for_exact_format_wins(make_onnx_version, ratings_cache):
    make_onnx_version(SET, FMT, tag="v1", bias=(3.0, 2.0, 1.0, 0.0))
    model = registry.resolve(SET, FMT)
    assert isinstance(model, registry.OnnxEVModel)
    assert model.model_id == f"{SET}/{FMT}/v1"
    assert model.fallback is False  # trained for the format it serves

    # bias makes slot 0 (Lightning Bolt) the top card; alias 301 hits slot 0.
    scores = model.score_pack([104, 301], [])
    assert [s.grp_id for s in scores] == [301, 104]
    assert scores[0].ev == pytest.approx(3.0)
    assert scores[1].ev == pytest.approx(0.0)


def test_trad_draft_borrows_premier_model_flagged_fallback(make_onnx_version):
    make_onnx_version(SET, "PremierDraft", tag="v1")
    model = registry.resolve(SET, "TradDraft")
    assert isinstance(model, registry.OnnxEVModel)
    assert model.model_id == f"{SET}/PremierDraft/v1"
    assert model.fallback is True  # borrowed model must be labeled


def test_exact_format_model_beats_fallback_alias(make_onnx_version):
    make_onnx_version(SET, "PremierDraft", tag="v9")
    make_onnx_version(SET, "TradDraft", tag="v1")
    model = registry.resolve(SET, "TradDraft")
    assert model.model_id == f"{SET}/TradDraft/v1"
    assert model.fallback is False


def test_no_models_falls_back_to_ratings_heuristic(ratings_cache):
    model = registry.resolve(SET, FMT)
    assert isinstance(model, HeuristicRatingsModel)
    assert model.fallback is True
    assert "heuristic" in model.model_id


def test_trad_draft_uses_premier_ratings_cache(ratings_cache):
    # Ratings only exist for PremierDraft; a TradDraft request must borrow
    # them (resolve retries HeuristicRatingsModel with PremierDraft).
    model = registry.resolve(SET, "TradDraft")
    assert isinstance(model, HeuristicRatingsModel)
    assert model.limited_type == "PremierDraft"


def test_bare_card_store_falls_back_to_rarity_floor(card_store):
    model = registry.resolve(SET, FMT)
    assert isinstance(model, RarityColorHeuristic)
    assert model.fallback is True


def test_resolve_caches_then_hot_swaps_on_new_model(
    ratings_cache, make_onnx_version
):
    first = registry.resolve(SET, FMT)
    assert isinstance(first, HeuristicRatingsModel)
    assert registry.resolve(SET, FMT) is first  # cached instance

    # A nightly retrain lands a `latest` symlink: the cache key changes and
    # the next resolve serves the trained model without a restart.
    make_onnx_version(SET, FMT, tag="v1")
    swapped = registry.resolve(SET, FMT)
    assert isinstance(swapped, registry.OnnxEVModel)


# -- the DraftFM zero-shot tier (between per-set-latest and heuristics) ------


def test_foundation_beats_heuristics(ratings_cache, make_foundation_version,
                                     draftfm_assets, stub_ort):
    make_foundation_version(tag="v20260706")
    model = registry.resolve(SET, FMT)
    assert isinstance(model, OnnxDraftFMModel)
    assert model.model_kind == "draftfm-zeroshot"
    assert model.fallback is False  # a real model, distinctly labeled
    assert model.model_id == "_foundation/v20260706"


def test_per_set_latest_beats_foundation(make_onnx_version,
                                         make_foundation_version,
                                         draftfm_assets):
    make_onnx_version(SET, FMT, tag="v1")
    make_foundation_version()
    model = registry.resolve(SET, FMT)
    assert isinstance(model, registry.OnnxEVModel)
    assert model.model_id == f"{SET}/{FMT}/v1"


def test_alias_borrowed_per_set_model_beats_foundation(
    make_onnx_version, make_foundation_version, draftfm_assets
):
    make_onnx_version(SET, "PremierDraft", tag="v1")
    make_foundation_version()
    model = registry.resolve(SET, "TradDraft")
    assert isinstance(model, registry.OnnxEVModel)
    assert model.fallback is True


def test_format_specific_foundation_dir_wins_over_shared(
    ratings_cache, make_foundation_version, draftfm_assets, stub_ort
):
    make_foundation_version(tag="shared")
    make_foundation_version(tag="premier", fmt=FMT)
    model = registry.resolve(SET, FMT)
    assert model.model_id == "_foundation/premier"


def test_foundation_without_set_assets_degrades_to_heuristic(
    ratings_cache, make_foundation_version, stub_ort
):
    make_foundation_version()  # no assets built for SET
    model = registry.resolve(SET, FMT)
    assert isinstance(model, HeuristicRatingsModel)


def test_foundation_export_hot_swaps_without_restart(
    ratings_cache, make_foundation_version, draftfm_assets, stub_ort
):
    first = registry.resolve(SET, FMT)
    assert isinstance(first, HeuristicRatingsModel)
    # A foundation export lands: the cache key includes the foundation
    # `latest` realpath, so the next resolve serves DraftFM.
    make_foundation_version()
    swapped = registry.resolve(SET, FMT)
    assert isinstance(swapped, OnnxDraftFMModel)
