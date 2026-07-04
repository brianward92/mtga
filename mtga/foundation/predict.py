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
