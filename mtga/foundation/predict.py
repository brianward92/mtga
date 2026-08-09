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
# bge-small-en-v1.5 text-embedding width. A no-text model (structured-only,
# 391-d) scored on a full structured+text (775-d) feature table legitimately
# drops exactly this trailing block; any OTHER width delta means the shard was
# featurized through a different manifest than the model trained on (T2.5).
TEXT_EMB_DIM = 384


def _pick_meta(set_code, limited_type):
    """Per-pick metadata from the curated parquet, in shard row order.

    Shards are built from the same parquet with the same filter and
    insertion-order-preserving scan, so row i here is row i of the shard.
    """
    import duckdb

    parquet = paths.curated_path("draft", set_code, limited_type)
    con = duckdb.connect()
    frame = con.execute(f"""
        SELECT draft_id, pack_number, pick_number,
               user_game_win_rate_bucket, user_n_games_bucket
        FROM '{parquet}' WHERE pick_index >= 0
        """).df()
    con.close()
    return frame


def foundation_predictions(
    model,
    set_code,
    limited_type,
    device="cpu",
    condition_wr_id=None,
    condition_games_id=None,
    batch_size=BATCH,
    temperature=1.0,
):
    """Predictions parquet rows for a DraftFM model on one (set, format).

    Zero-shot evaluation: the shard may cover a set the model never trained
    on. condition_wr_id/games_id override the skill conditioning
    ("deployment mode"); None uses each drafter's true bucket ("human mode").

    temperature: post-hoc scale applied to logits before the softmax
    (dividing all real-slot logits by a positive constant, per
    eval_protocol.md's "optional temperature fit on dev only"). Rank is
    computed from the unscaled logits, so temperature != 1.0 changes
    pick_prob/top_prob but never target_rank (monotonic rescale).
    """
    if not (temperature > 0):
        raise ValueError(f"temperature must be > 0, got {temperature!r}")

    import torch

    from mtga.foundation.dataset import PAD, Shard, shard_dir
    from mtga.foundation.train import make_batch

    d = shard_dir(set_code, limited_type)
    assets = np.load(d / "features.npz")
    matrix = assets["features"].astype(np.float32)
    # Match the model's expected feature width (no-text ablations use 391).
    # Sized from the input-LayerNorm weight: ManualLayerNorm (post-M4-Max
    # fix) has no normalized_shape attribute.
    expected = model.card_encoder.net[0].weight.shape[0]
    if matrix.shape[1] != expected:
        # The ONLY legitimate mismatch: a no-text (structured-only) model
        # scored on a structured+text table -> drop the trailing text block.
        # Any other width delta means the eval shard went through a different
        # featurizer manifest than the model trained on; silently truncating
        # would score a *wrong feature space*, so refuse instead (T2.5).
        if matrix.shape[1] - expected == TEXT_EMB_DIM:
            matrix = matrix[:, :expected]
        else:
            raise ValueError(
                f"feature width {matrix.shape[1]} != model's expected "
                f"{expected}, and the difference is not the {TEXT_EMB_DIM}-d "
                f"text block: the shard for {set_code}.{limited_type} was "
                f"featurized through a different manifest than this model "
                f"trained on. Refusing to score a mismatched feature space"
            )
    features = torch.from_numpy(matrix)
    shard = Shard(set_code, limited_type, features)
    shard.rarity_ids = torch.from_numpy(assets["rarity_ids"].astype(np.int64))
    shard.set_scalars = torch.tensor(
        [
            shard.meta["vocab_size"] / 400.0,
            float(shard.meta.get("picks_per_pack") == 13),
            float(shard.meta.get("picks_per_pack") == 14),
            float(shard.meta.get("picks_per_pack") == 15),
        ]
    )
    meta = _pick_meta(set_code, limited_type)
    if len(meta) != shard.meta["rows"]:
        raise RuntimeError(
            f"shard/parquet row mismatch: {shard.meta['rows']} vs {len(meta)}"
        )

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
                batch["games_id"] = torch.full_like(
                    batch["games_id"], condition_games_id
                )
            logits = model(table, summary, batch)
            valid = torch.isfinite(logits)
            # Rank from the unscaled logits: dividing by a positive
            # temperature is monotonic, so target_rank is invariant to T by
            # construction (checked again with an explicit assertion by the
            # caller in scripts/fit_dev_temperature.py).
            target = batch["pick_pos"]
            target_logit = logits.gather(1, target.unsqueeze(1))
            rank = (logits > target_logit).sum(dim=1) + 1
            probs = torch.softmax(logits / temperature, dim=1)
            ranks[rows] = rank.cpu().numpy()
            pick_probs[rows] = (
                probs.gather(1, target.unsqueeze(1)).squeeze(1).cpu().numpy()
            )
            top_probs[rows] = probs.max(dim=1).values.cpu().numpy()
            sizes[rows] = valid.sum(dim=1).cpu().numpy()

    return pd.DataFrame(
        {
            "draft_id": meta["draft_id"],
            "pack_number": meta["pack_number"].astype(int),
            "pick_number": meta["pick_number"].astype(int),
            "pack_size": sizes,
            "wr_bucket": meta["user_game_win_rate_bucket"].astype(float),
            "n_games_bucket": meta["user_n_games_bucket"].astype(int),
            "target_rank": ranks,
            "pick_prob": pick_probs,
            "top_prob": top_probs,
        }
    )


def _softmax(logits):
    peak = logits.max(axis=-1, keepdims=True)
    exps = np.exp(logits - peak)
    return exps / exps.sum(axis=-1, keepdims=True)


BASELINE_SEED = 20260707


def baseline_predictions(set_code, limited_type, kind, seed=BASELINE_SEED):
    """Predictions parquet rows for the zero-parameter battery baselines.

    kind="random": per-row uniform target rank over pack_size (deterministic
    under the frozen seed); pick/top probability = 1/pack_size.
    kind="rarity": RarityColorHeuristic scored over grpIds — vocab slots map
    to grpIds through cardstore.name_resolution; a slot with no grpId gets a
    unique sentinel the heuristic cannot know (ev None, ranked last).

    Rows come from the (set, format) shard, so ordering matches every other
    predictions parquet for the same snapshot.
    """
    import json

    from mtga.foundation.dataset import PAD, Shard, shard_dir

    d = shard_dir(set_code, limited_type)
    features = np.load(d / "features.npz")["features"]
    shard = Shard(set_code, limited_type, features)
    meta = _pick_meta(set_code, limited_type)
    n = shard.meta["rows"]
    if len(meta) != n:
        raise RuntimeError(f"shard/parquet row mismatch: {n} vs {len(meta)}")

    pack_slots = np.asarray(shard.pack_slots)
    sizes = (pack_slots != PAD).sum(axis=1).astype(np.int32)

    if kind == "random":
        rng = np.random.default_rng(seed)
        ranks = (rng.random(n) * sizes).astype(np.int32) + 1
        pick_probs = (1.0 / sizes).astype(np.float32)
        top_probs = pick_probs.copy()
    elif kind == "rarity":
        from mtga.lands import cardstore
        from mtga.models.heuristic import RarityColorHeuristic

        with open(paths.vocab_path(set_code, limited_type)) as fh:
            vocab = json.load(fh)["names"]
        canonical, _, _ = cardstore.name_resolution(set_code)
        # Unique negative sentinel per unmapped slot: never in the heuristic's
        # card table, so it scores ev None deterministically.
        grp_of = np.array(
            [canonical.get(name, -(i + 1)) for i, name in enumerate(vocab)],
            dtype=np.int64,
        )
        model = RarityColorHeuristic(set_code)

        pool_slots = np.asarray(shard.pool_slots)
        pool_counts = np.asarray(shard.pool_counts)
        context = np.asarray(shard.context)
        pick_pos = np.asarray(shard.pick_pos)
        ranks = np.empty(n, dtype=np.int32)
        pick_probs = np.empty(n, dtype=np.float32)
        top_probs = np.empty(n, dtype=np.float32)
        for i in range(n):
            real = pack_slots[i, : sizes[i]]
            pack_grps = [int(grp_of[s]) for s in real]
            pool_grps = []
            for slot, count in zip(pool_slots[i], pool_counts[i]):
                if slot == PAD:
                    break
                pool_grps.extend([int(grp_of[slot])] * int(count))
            scores = model.score_pack(
                pack_grps, pool_grps, int(context[i, 0]), int(context[i, 1])
            )
            target = int(grp_of[pack_slots[i, pick_pos[i]]])
            by_grp = {s.grp_id: s for s in scores}
            ranks[i] = by_grp[target].rank
            pick_probs[i] = by_grp[target].prob or 0.0
            top_probs[i] = max((s.prob or 0.0) for s in scores)
    else:
        raise ValueError(f"unknown baseline kind: {kind!r}")

    return pd.DataFrame(
        {
            "draft_id": meta["draft_id"],
            "pack_number": meta["pack_number"].astype(int),
            "pick_number": meta["pick_number"].astype(int),
            "pack_size": sizes,
            "wr_bucket": meta["user_game_win_rate_bucket"].astype(float),
            "n_games_bucket": meta["user_n_games_bucket"].astype(int),
            "target_rank": ranks,
            "pick_prob": pick_probs,
            "top_prob": top_probs,
        }
    )


def per_set_model_predictions(
    set_code,
    limited_type,
    version="latest",
    split="val",
    min_wr_bucket=0.55,
    min_games_bucket=100,
):
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
    keep = {
        "val": val_mask,
        "train": train_mask,
        "all": np.ones(len(picks), dtype=bool),
    }[split]
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
            rows.append(
                (rank, float(probs[target_pos]), float(probs.max()), len(candidates))
            )

    ranks, pick_probs, top_probs, sizes = map(np.array, zip(*rows))
    return pd.DataFrame(
        {
            "draft_id": meta["draft_id"],
            "pack_number": meta["pack_number"].astype(int),
            "pick_number": meta["pick_number"].astype(int),
            "pack_size": sizes,
            "wr_bucket": meta["user_game_win_rate_bucket"].astype(float),
            "n_games_bucket": meta["user_n_games_bucket"].astype(int),
            "target_rank": ranks,
            "pick_prob": pick_probs,
            "top_prob": top_probs,
        }
    )
