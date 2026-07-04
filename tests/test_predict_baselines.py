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
    by_key = {(r["draft_id"], r["pick_number"]): r
              for r in hand_draft_rows(pick_base=0)}
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
        pack_slots[i, :len(pack)] = pack
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
    (out / "meta.json").write_text(json.dumps({
        "set": SET, "format": FMT, "rows": n, "vocab_size": len(VOCAB),
        "source_etag": "etag-draft-1", "picks_per_pack": 14,
        "p1p1_missing": False, "val_permille": 50,
    }))
    np.savez(out / "features.npz",
             features=np.zeros((len(VOCAB), 8), dtype=np.float16),
             rarity_ids=np.zeros(len(VOCAB), dtype=np.uint8))
    return out


def test_random_baseline_contract_and_determinism(shard):
    frame = predict.baseline_predictions(SET, FMT, "random")
    evalproto.validate(frame)
    assert len(frame) == 8  # the unknown-pick row (pick_index -1) is excluded
    assert (frame["target_rank"] >= 1).all()
    assert (frame["target_rank"] <= frame["pack_size"].clip(lower=1)).all()
    np.testing.assert_allclose(frame["pick_prob"],
                               1.0 / frame["pack_size"].clip(lower=1))
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
