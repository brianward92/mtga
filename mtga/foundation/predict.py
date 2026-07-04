"""Produce predictions parquets (the evalproto contract) from models.

The frozen eval never re-runs a model during analysis: each model gets one
inference pass over the eval picks, cached as a parquet, and every table in
the paper is derived from those files.
"""

import numpy as np
import pandas as pd

from mtga.lands import paths
from mtga.models.draftnet import POOL_CAP, load_pick_arrays, split_by_draft

BATCH = 8192


def _pick_meta(set_code, limited_type):
    """Per-pick metadata from the curated parquet, in shard row order.

    Shards are built from the same parquet with the same filter and
    insertion-order-preserving scan, so row i here is row i of the shard.
    """
    import duckdb

    parquet = paths.curated_path("draft", set_code, limited_type)
    con = duckdb.connect()
    frame = con.execute(
        f"""
        SELECT draft_id, pack_number, pick_number,
               user_game_win_rate_bucket, user_n_games_bucket
        FROM '{parquet}' WHERE pick_index >= 0
        """
    ).df()
    con.close()
    return frame


def foundation_predictions(model, set_code, limited_type, device="cpu",
                           condition_wr_id=None, condition_games_id=None,
                           batch_size=BATCH):
    """Predictions parquet rows for a DraftFM model on one (set, format).

    Zero-shot evaluation: the shard may cover a set the model never trained
    on. condition_wr_id/games_id override the skill conditioning
    ("deployment mode"); None uses each drafter's true bucket ("human mode").
    """
    import torch

    from mtga.foundation.dataset import PAD, Shard, shard_dir
    from mtga.foundation.train import make_batch

    d = shard_dir(set_code, limited_type)
    assets = np.load(d / "features.npz")
    matrix = assets["features"].astype(np.float32)
    # Match the model's expected feature width (no-text ablations use 391).
    expected = model.card_encoder.net[0].normalized_shape[0]
    if matrix.shape[1] != expected:
        matrix = matrix[:, :expected]
    features = torch.from_numpy(matrix)
    shard = Shard(set_code, limited_type, features)
    shard.rarity_ids = torch.from_numpy(assets["rarity_ids"].astype(np.int64))
    shard.set_scalars = torch.tensor([
        shard.meta["vocab_size"] / 400.0,
        float(shard.meta.get("picks_per_pack") == 13),
        float(shard.meta.get("picks_per_pack") == 14),
        float(shard.meta.get("picks_per_pack") == 15),
    ])
    meta = _pick_meta(set_code, limited_type)
    if len(meta) != shard.meta["rows"]:
        raise RuntimeError(
            f"shard/parquet row mismatch: {shard.meta['rows']} vs {len(meta)}")

    model = model.to(device).eval()
    feats = shard.features.to(device)
    rars = shard.rarity_ids.to(device)
    n = shard.meta["rows"]
    ranks = np.empty(n, dtype=np.int32)
    pick_probs = np.empty(n, dtype=np.float32)
    top_probs = np.empty(n, dtype=np.float32)
    sizes = np.empty(n, dtype=np.int32)

    with torch.no_grad():
        table, summary = model.encode_set(feats, rars)
        for start in range(0, n, batch_size):
            rows = np.arange(start, min(start + batch_size, n))
            batch = make_batch(shard, rows, device)
            if condition_wr_id is not None:
                batch["wr_id"] = torch.full_like(batch["wr_id"], condition_wr_id)
            if condition_games_id is not None:
                batch["games_id"] = torch.full_like(batch["games_id"],
                                                    condition_games_id)
            logits = model(table, summary, batch)
            valid = torch.isfinite(logits)
            probs = torch.softmax(logits, dim=1)
            target = batch["pick_pos"]
            target_logit = logits.gather(1, target.unsqueeze(1))
            rank = (logits > target_logit).sum(dim=1) + 1
            ranks[rows] = rank.cpu().numpy()
            pick_probs[rows] = probs.gather(1, target.unsqueeze(1)).squeeze(1).cpu().numpy()
            top_probs[rows] = probs.max(dim=1).values.cpu().numpy()
            sizes[rows] = valid.sum(dim=1).cpu().numpy()

    return pd.DataFrame({
        "draft_id": meta["draft_id"],
        "pack_number": meta["pack_number"].astype(int),
        "pick_number": meta["pick_number"].astype(int),
        "pack_size": sizes,
        "wr_bucket": meta["user_game_win_rate_bucket"].astype(float),
        "n_games_bucket": meta["user_n_games_bucket"].astype(int),
        "target_rank": ranks,
        "pick_prob": pick_probs,
        "top_prob": top_probs,
    })


def _softmax(logits):
    peak = logits.max(axis=-1, keepdims=True)
    exps = np.exp(logits - peak)
    return exps / exps.sum(axis=-1, keepdims=True)


def per_set_model_predictions(set_code, limited_type, version="latest",
                              split="val", min_wr_bucket=0.55,
                              min_games_bucket=100):
    """Predictions parquet rows for a trained per-set ONNX model.

    split: "val" (the model's held-out drafts), "train", or "all".
    The skill filters must match the ones the model was evaluated with when
    reproducing published numbers (the 70.2% anchor uses the defaults).
    """
    import onnxruntime

    model_dir = paths.MODELS_DIR / set_code / limited_type / version
    session = onnxruntime.InferenceSession(
        str(model_dir / "model.onnx"), providers=["CPUExecutionProvider"]
    )

    pool, pack, picks, meta, vocab = load_pick_arrays(
        set_code, limited_type, min_wr_bucket, min_games_bucket
    )
    train_mask, val_mask = split_by_draft(meta["draft_id"])
    keep = {"val": val_mask, "train": train_mask,
            "all": np.ones(len(picks), dtype=bool)}[split]
    pool, pack, picks = pool[keep], pack[keep], picks[keep]
    meta = meta[keep].reset_index(drop=True)

    rows = []
    for start in range(0, len(picks), BATCH):
        stop = min(start + BATCH, len(picks))
        pools = np.minimum(pool[start:stop], POOL_CAP).astype(np.float32)
        logits = session.run(["scores"], {"pool": pools})[0]
        packs = pack[start:stop]
        for i in range(stop - start):
            candidates = np.flatnonzero(packs[i] > 0)
            target = picks[start + i]
            cand_logits = logits[i, candidates]
            order = candidates[np.argsort(-cand_logits, kind="stable")]
            rank = int(np.flatnonzero(order == target)[0]) + 1
            probs = _softmax(cand_logits)
            target_pos = int(np.flatnonzero(candidates == target)[0])
            rows.append((rank, float(probs[target_pos]), float(probs.max()),
                         len(candidates)))

    ranks, pick_probs, top_probs, sizes = map(np.array, zip(*rows))
    return pd.DataFrame({
        "draft_id": meta["draft_id"],
        "pack_number": meta["pack_number"].astype(int),
        "pick_number": meta["pick_number"].astype(int),
        "pack_size": sizes,
        "wr_bucket": meta["user_game_win_rate_bucket"].astype(float),
        "n_games_bucket": meta["user_n_games_bucket"].astype(int),
        "target_rank": ranks,
        "pick_prob": pick_probs,
        "top_prob": top_probs,
    })
