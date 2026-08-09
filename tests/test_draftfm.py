"""mtga/models/draftfm.py: DraftFM ONNX serving over stubbed ORT sessions.

The stub (see _synth.StubOrtSession) makes every graph's math transparent:
identity card encoder over diag features (card values 3, 2, 1, 0 for
A, B, C, D), mean-pool set encoder, and a scorer that sums each candidate's
embedding — so rankings, probabilities, and every scorer input can be
asserted exactly.
"""

import math

import numpy as np
import pytest

from _synth import (
    ALIASES_A,
    DRAFTFM_NULL,
    FMT,
    GRP,
    SET,
    CARD_B,
    CARD_C,
    CARD_D,
    StubOrtSession,
)
from mtga.models import draftfm
from mtga.models.draftfm import OnnxDraftFMModel

A_ALT, A_OUT = ALIASES_A[1], ALIASES_A[2]
B, C, D = GRP[CARD_B], GRP[CARD_C], GRP[CARD_D]


@pytest.fixture
def model(stub_ort, make_foundation_version, draftfm_assets):
    return OnnxDraftFMModel(make_foundation_version(), SET, FMT)


def test_load_caches_table_and_summary(model):
    # Identity card encoder: table == the fp32 feature matrix.
    assert model.table.shape == (4, 4)
    assert model.table[0, 0] == pytest.approx(3.0)
    # Mean-pool set encoder over the diag features.
    np.testing.assert_allclose(model.set_summary, [0.75, 0.5, 0.25, 0.0])
    assert model.model_id == "_foundation/v1"
    assert model.model_kind == "draftfm-zeroshot"
    assert model.fallback is False


def test_score_pack_ranks_by_model_logit(model):
    # Alias 301 resolves to Lightning Bolt's row (value 3); D scores 0.
    scores = model.score_pack([D, A_OUT], [])
    assert [s.grp_id for s in scores] == [A_OUT, D]
    assert scores[0].ev == pytest.approx(3.0)
    assert scores[1].ev == pytest.approx(0.0)
    assert [s.rank for s in scores] == [1, 2]
    # Probabilities are softmax over the pack logits.
    assert scores[0].prob == pytest.approx(math.exp(3.0) / (math.exp(3.0) + 1.0))
    assert scores[0].prob + scores[1].prob == pytest.approx(1.0)


def test_empty_pool_injects_learned_null_token(model):
    model.score_pack([B, C], [])
    feeds = StubOrtSession.last_scorer_feeds
    np.testing.assert_allclose(feeds["pool_emb"], np.full((1, 1, 4), DRAFTFM_NULL))
    assert feeds["pool_counts"].tolist() == [[0]]
    assert feeds["pool_mask"].tolist() == [[False]]


def test_pool_aliases_merge_and_counts_cap(model):
    # 10 boosters copies + 1 alt art of the same card: one distinct slot,
    # count capped at the training-time POOL_COUNT_CAP.
    model.score_pack([B], [GRP["Lightning Bolt"]] * 10 + [A_ALT])
    feeds = StubOrtSession.last_scorer_feeds
    assert feeds["pool_counts"].tolist() == [[draftfm.POOL_COUNT_CAP]]
    np.testing.assert_allclose(feeds["pool_emb"][0, 0], model.table[0])
    assert feeds["pool_mask"].tolist() == [[False]]


def test_scorer_conditioning_and_position_inputs(model):
    model.score_pack([B, C], [D], pack_number=1, pick_number=3)
    feeds = StubOrtSession.last_scorer_feeds
    assert feeds["wr_id"].tolist() == [33]
    assert feeds["games_id"].tolist() == [6]
    assert feeds["format_id"].tolist() == [0]  # PremierDraft
    ppp = 14.0
    np.testing.assert_allclose(
        feeds["position"][0],
        [
            0.0,
            1.0,
            0.0,
            3 / ppp,
            (ppp - 1 - 3) / ppp,
            (ppp + 3) / 45.0,
            (ppp + 3) / (3 * ppp),
        ],
        rtol=1e-6,
    )
    np.testing.assert_allclose(feeds["set_scalars"][0], [4 / 400.0, 0.0, 1.0, 0.0])
    np.testing.assert_allclose(feeds["set_summary"], model.set_summary)


def test_position_defaults_derive_from_pool_size(model):
    # 15 pool cards, no pack/pick numbers: pack 1 pick 1 under 14 picks/pack.
    model.score_pack([B], [C] * 15)
    feeds = StubOrtSession.last_scorer_feeds
    assert feeds["position"][0][1] == pytest.approx(1.0)  # pack_number == 1
    assert feeds["position"][0][3] == pytest.approx(1 / 14)  # pick_number 1


def test_unknown_grp_ids_rank_last_via_rank_scores(model):
    scores = model.score_pack([D, 999, A_OUT], [])
    by_grp = {s.grp_id: s for s in scores}
    assert by_grp[999].ev is None
    assert by_grp[999].prob is None
    assert by_grp[999].rank == 3
    assert by_grp[A_OUT].rank == 1
    assert by_grp[D].rank == 2
    # Probabilities renormalize over the known candidates only.
    assert by_grp[A_OUT].prob + by_grp[D].prob == pytest.approx(1.0)


def test_all_unknown_pack_never_runs_the_scorer(model):
    StubOrtSession.last_scorer_feeds = None
    scores = model.score_pack([777, 888], [])
    assert [s.ev for s in scores] == [None, None]
    assert StubOrtSession.last_scorer_feeds is None


def test_p1p1_table_sized_pack(model):
    # DataHub.p1p1 scores the whole set as one pack (dynamic pack axis).
    scores = model.score_pack(sorted(GRP.values()), [])
    assert [s.grp_id for s in scores] == [101, 102, 103, 104]
    assert StubOrtSession.last_scorer_feeds["pack_emb"].shape == (1, 4, 4)


def test_manifest_hash_mismatch_refused(stub_ort, make_foundation_version, data_root):
    import _synth

    _synth.write_draftfm_assets(manifest_hash="different-hash")
    with pytest.raises(ValueError, match="manifest mismatch"):
        OnnxDraftFMModel(make_foundation_version(), SET, FMT)


def test_missing_assets_raise_with_pointer(
    stub_ort, make_foundation_version, data_root
):
    with pytest.raises(FileNotFoundError, match="build_set_assets"):
        OnnxDraftFMModel(make_foundation_version(), SET, FMT)


def test_set_ctx_false_export_has_no_summary(
    stub_ort, make_foundation_version, draftfm_assets
):
    # set_ctx=False exports omit set_encoder.onnx entirely (not a zeroed
    # summary) -- serving must not load it or feed set_summary to the scorer.
    m = OnnxDraftFMModel(make_foundation_version(set_ctx=False), SET, FMT)
    assert m.set_summary is None

    m.score_pack([D, A_OUT], [])
    feeds = StubOrtSession.last_scorer_feeds
    assert "set_summary" not in feeds


def test_position_features_match_torch_reference():
    torch = pytest.importorskip("torch")

    from mtga.foundation.model import position_features as torch_position

    for ppp in (13, 14, 15):
        for pack_number in range(3):
            for pick_number in range(ppp):
                context = torch.tensor([[pack_number, pick_number, 0, 0, 0]])
                want = torch_position(context, ppp).numpy()
                got = draftfm.position_features(pack_number, pick_number, ppp)
                np.testing.assert_allclose(got, want, rtol=1e-6, atol=1e-7)
