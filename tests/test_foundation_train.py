"""End-to-end smoke of the DraftFM training mechanics on CPU.

Builds a synthetic shard directly on disk (bypassing ETL) with a planted
signal — one 'bomb' card that skilled players always take — and checks the
model learns it in a few dozen steps, plus core dataset invariants.
"""

import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from mtga.foundation import dataset
from mtga.foundation.dataset import PAD, POOL_SLOTS, PACK_SLOTS
from mtga.foundation.train import TrainConfig, load_shards, train

VOCAB = 24
FEAT = 32
BOMB = 3
ROWS = 4096


@pytest.fixture
def synthetic_shard(data_root):
    rng = np.random.default_rng(11)
    out = dataset.shard_dir("TST", "PremierDraft")
    out.mkdir(parents=True, exist_ok=True)

    pool_slots = np.full((ROWS, POOL_SLOTS), int(PAD), dtype=np.uint16)
    pool_counts = np.zeros((ROWS, POOL_SLOTS), dtype=np.uint8)
    pack_slots = np.full((ROWS, PACK_SLOTS), int(PAD), dtype=np.uint16)
    pick_pos = np.zeros(ROWS, dtype=np.uint8)
    context = np.zeros((ROWS, 5), dtype=np.uint8)
    split = np.zeros(ROWS, dtype=np.uint16)

    for i in range(ROWS):
        n_pool = rng.integers(0, 6)
        pool = rng.choice(VOCAB, size=n_pool, replace=False)
        pool_slots[i, :n_pool] = pool
        pool_counts[i, :n_pool] = 1
        pack = rng.choice(VOCAB, size=5, replace=False)
        if BOMB not in pack:
            pack[0] = BOMB
        pack_slots[i, :5] = np.sort(pack)
        # Signal: the pick is always the bomb.
        pick_pos[i] = int(np.flatnonzero(np.sort(pack) == BOMB)[0])
        context[i] = [rng.integers(0, 3), rng.integers(0, 14), 33, 5, 0]
        split[i] = i % 1000  # ~5% val via < 50

    np.save(out / "pool_slots.npy", pool_slots)
    np.save(out / "pool_counts.npy", pool_counts)
    np.save(out / "pack_slots.npy", pack_slots)
    np.save(out / "pick_pos.npy", pick_pos)
    np.save(out / "context.npy", context)
    np.save(out / "split.npy", split)
    (out / "meta.json").write_text(json.dumps({
        "set": "TST", "format": "PremierDraft", "rows": ROWS,
        "vocab_size": VOCAB, "source_etag": "tst", "picks_per_pack": 14,
        "p1p1_missing": False, "val_permille": 50,
    }))

    features = rng.normal(size=(VOCAB, FEAT)).astype(np.float16)
    rarity_ids = rng.integers(0, 5, size=VOCAB).astype(np.uint8)
    np.savez(out / "features.npz", features=features, rarity_ids=rarity_ids,
             names=np.array([f"c{i}" for i in range(VOCAB)], dtype=object),
             manifest_hash="tst")
    return out


def test_shard_loads_and_splits(synthetic_shard):
    shards = load_shards([("TST", "PremierDraft")])
    shard = shards[0]
    assert shard.features.shape == (VOCAB, FEAT)
    assert len(shard.train_idx) + len(shard.val_idx) == ROWS
    assert 0.03 < len(shard.val_idx) / ROWS < 0.07
    batch = shard.gather(shard.train_idx[:8])
    assert batch["pack_slots"].shape == (8, PACK_SLOTS)
    # pick position always indexes a real (non-PAD) slot
    picks = batch["pack_slots"][np.arange(8), batch["pick_pos"]]
    assert (picks != int(PAD)).all()


def test_train_learns_planted_signal(synthetic_shard):
    config = TrainConfig(
        name="smoke", sets=[("TST", "PremierDraft")], seed=17, batch_size=256,
        lr=3e-3, max_steps=120, d_model=32, val_every=60, patience=10,
        device="cpu", parity_check=False, warmup_steps=10,
    )
    record = train(config)
    # 'Always take the bomb' is trivially learnable; random = 1/5.
    assert record["best_val_top1"] > 0.9
    assert record["n_params"] > 0
    # Ledger row exists for the run
    from mtga.foundation.runlog import LEDGER
    lines = [json.loads(l) for l in open(LEDGER)]
    assert any(l["run_id"] == record["run_id"] for l in lines)
