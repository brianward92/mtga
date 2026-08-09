"""mtga/foundation/predict.baseline_predictions: the frozen-eval baselines.

Built on the hand-computed synthetic draft (conftest.curated_draft) with a
real shard, so row alignment between shard and curated parquet is exercised
end to end.
"""

import json
import zlib

import numpy as np
import pytest

from _synth import FMT, SET, VOCAB, hand_draft_rows
from mtga.foundation import evalproto, predict
from mtga.foundation.dataset import PACK_SLOTS, PAD, POOL_SLOTS, shard_dir
from mtga.lands import paths


@pytest.fixture
def shard(curated_draft):
    """Hand-built shard aligned row-for-row with the curated parquet.

    (dataset.build_shard is bypassed: it is exercised on real data, and the
    synthetic vocabulary's embedded-double-quote card is a CSV-header
    torture case, not a shard one.)
    """
    import duckdb

    parquet = paths.curated_path("draft", SET, FMT)
    con = duckdb.connect()
    meta = con.execute(
        f"SELECT draft_id, pack_number, pick_number, pick_index "
        f"FROM '{parquet}' WHERE pick_index >= 0"
    ).df()
    con.close()

    index = {name: i for i, name in enumerate(VOCAB)}
    by_key = {
        (r["draft_id"], r["pick_number"]): r for r in hand_draft_rows(pick_base=0)
    }
    n = len(meta)
    pool_slots = np.full((n, POOL_SLOTS), int(PAD), dtype=np.uint16)
    pool_counts = np.zeros((n, POOL_SLOTS), dtype=np.uint8)
    pack_slots = np.full((n, PACK_SLOTS), int(PAD), dtype=np.uint16)
    pick_pos = np.zeros(n, dtype=np.uint8)
    context = np.zeros((n, 5), dtype=np.uint8)
    split = np.zeros(n, dtype=np.uint16)
    for i, row in meta.iterrows():
        hand = by_key[(row["draft_id"], row["pick_number"])]
        pool = sorted((index[nm], c) for nm, c in hand["pool"].items() if c)
        for j, (slot, count) in enumerate(pool):
            pool_slots[i, j] = slot
            pool_counts[i, j] = count
        pack = sorted(index[nm] for nm, c in hand["pack"].items() if c)
        pack_slots[i, : len(pack)] = pack
        pick_pos[i] = pack.index(int(row["pick_index"]))
        context[i] = [row["pack_number"], row["pick_number"], 33, 5, 0]
        split[i] = zlib.crc32(row["draft_id"].encode()) % 1000

    out = shard_dir(SET, FMT)
    out.mkdir(parents=True, exist_ok=True)
    np.save(out / "pool_slots.npy", pool_slots)
    np.save(out / "pool_counts.npy", pool_counts)
    np.save(out / "pack_slots.npy", pack_slots)
    np.save(out / "pick_pos.npy", pick_pos)
    np.save(out / "context.npy", context)
    np.save(out / "split.npy", split)
    (out / "meta.json").write_text(
        json.dumps(
            {
                "set": SET,
                "format": FMT,
                "rows": n,
                "vocab_size": len(VOCAB),
                "source_etag": "etag-draft-1",
                "picks_per_pack": 14,
                "p1p1_missing": False,
                "val_permille": 50,
            }
        )
    )
    np.savez(
        out / "features.npz",
        features=np.zeros((len(VOCAB), 8), dtype=np.float16),
        rarity_ids=np.zeros(len(VOCAB), dtype=np.uint8),
    )
    return out


def test_random_baseline_contract_and_determinism(shard):
    frame = predict.baseline_predictions(SET, FMT, "random")
    evalproto.validate(frame)
    assert len(frame) == 8  # the unknown-pick row (pick_index -1) is excluded
    assert (frame["target_rank"] >= 1).all()
    assert (frame["target_rank"] <= frame["pack_size"].clip(lower=1)).all()
    np.testing.assert_allclose(
        frame["pick_prob"], 1.0 / frame["pack_size"].clip(lower=1)
    )
    again = predict.baseline_predictions(SET, FMT, "random")
    assert frame.equals(again)  # frozen seed => byte-identical


def test_rarity_baseline_scores_via_grp_ids(shard, card_store):
    frame = predict.baseline_predictions(SET, FMT, "rarity")
    evalproto.validate(frame)

    # d1 P1P1: pack {A,B,C,D}, empty pool, so ev = rarity prior alone
    # (A common 0, B uncommon .1, C rare .35, D common 0) -> C > B > A > D
    # by stable vocab order; the human took A => target_rank 3.
    p1p1 = frame[(frame["draft_id"] == "d1") & (frame["pick_number"] == 0)]
    assert p1p1["target_rank"].item() == 3
    assert p1p1["pack_size"].item() == 4

    # Forced last pick of d1: only D left.
    forced = frame[(frame["draft_id"] == "d1") & (frame["pick_number"] == 3)]
    assert forced["pack_size"].item() == 1
    assert forced["target_rank"].item() == 1
    assert forced["pick_prob"].item() == pytest.approx(1.0)

    again = predict.baseline_predictions(SET, FMT, "rarity")
    assert frame.equals(again)


def test_unknown_kind_is_refused(shard):
    with pytest.raises(ValueError, match="unknown baseline kind"):
        predict.baseline_predictions(SET, FMT, "alsa")


# -- temperature scaling (foundation_predictions) ----------------------------
# eval-protocol-v1's dev-only calibration decision (docs/eval_protocol.md
# section 3): a post-hoc softmax temperature applied to a DraftFM model's
# logits. These tests exercise the actual code path scripts/
# fit_dev_temperature.py depends on, hermetically (a tiny real DraftFM
# instance, not a checkpoint) -- the two properties that must hold for a
# temperature-scaled number to be trustworthy: target_rank is exactly
# invariant to T (a monotonic rescale can't change the argmax), and T only
# ever flattens or sharpens the distribution, never a random perturbation.


@pytest.fixture
def tiny_draftfm(shard):
    """A real (untrained, tiny) DraftFM instance matching the shard's
    8-wide synthetic feature vectors, small enough to score instantly."""
    torch = pytest.importorskip("torch")
    from mtga.foundation.model import DraftFM

    torch.manual_seed(0)
    model = DraftFM(feat_dim=8, d=16, dropout=0.0, set_ctx=False)
    model.eval()
    return model


def test_temperature_rejects_nonpositive(shard, tiny_draftfm):
    for bad in (0.0, -1.0, -0.001):
        with pytest.raises(ValueError, match="temperature must be > 0"):
            predict.foundation_predictions(tiny_draftfm, SET, FMT, temperature=bad)


def test_temperature_preserves_target_rank(shard, tiny_draftfm):
    """Dividing logits by a positive constant is monotonic: WHICH candidate
    is the human's rank cannot change, only the reported confidence."""
    base = predict.foundation_predictions(tiny_draftfm, SET, FMT, temperature=1.0)
    for t in (0.3, 0.7, 2.5, 5.0):
        scaled = predict.foundation_predictions(tiny_draftfm, SET, FMT, temperature=t)
        assert (
            scaled["target_rank"].to_numpy() == base["target_rank"].to_numpy()
        ).all(), (
            f"target_rank changed at T={t}: temperature scaling must be "
            "rank-invariant by construction"
        )


def test_temperature_monotonically_reshapes_confidence(shard, tiny_draftfm):
    """For the same logits, top_prob(T) is monotonically non-increasing in
    T for T >= 1 (higher temperature flattens softmax toward uniform) and
    non-decreasing for T <= 1 (lower temperature sharpens it) -- a
    mathematical certainty for any positive-logit rescale, so a violation
    means the implementation isn't actually doing temperature scaling."""
    ts = [0.3, 0.7, 1.0, 1.5, 3.0]
    frames = {
        t: predict.foundation_predictions(tiny_draftfm, SET, FMT, temperature=t)
        for t in ts
    }
    top_prob_means = [frames[t]["top_prob"].mean() for t in ts]
    for a, b in zip(top_prob_means, top_prob_means[1:]):
        assert (
            a >= b - 1e-6
        ), f"mean top_prob must be non-increasing as T grows: {top_prob_means}"
