"""ONNX export for DraftFM: three graphs factoring model.DraftFM exactly.

Serving (Intel box, onnxruntime CPU) never imports torch, so the trained
model is split into three graphs whose composition reproduces the training
forward (architecture doc §6). Export runs from CPU weights with
`torch.onnx.export(dynamo=True, opset_version=18)` and is validated against
the torch model on random inputs (max |diff| < 1e-4, hard fail) before
meta.json is written — a version dir without meta.json is never served.

  card_encoder.onnx  features [N, feat]                 -> card_emb [N, d]
  set_encoder.onnx   card_emb [N, d], rarity_ids [N]    -> set_summary [d]
  scorer.onnx        pre-gathered pool_emb [B, P, d], pool_counts [B, P],
                     pool_mask [B, P], pack_emb [B, K, d], pack_mask [B, K],
                     wr_id/games_id/format_id [B], position [B, 7],
                     set_scalars [B, 4], set_summary [d] -> logits [B, K]

All of N, B, P (pool slots) and K (pack slots) are dynamic axes; training
shapes are P=46/K=16 but serving may pass e.g. K=300 for a P1P1 table.

The data-dependent empty-pool branch in model.DraftFM.forward (fully-empty
pools attend over the learned null token) is deliberately NOT in the scorer
graph. The graph computes `pool_emb + count_embedding(pool_counts)` for
every slot; for an empty pool the serving wrapper feeds a single unmasked
slot whose embedding is `pool_null_input = empty_pool -
count_embedding.weight[0]` (stored in constants.npz) with count 0, so the
graph reconstructs exactly the learned null token.
"""

import datetime
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from mtga.foundation import runlog
from mtga.foundation.dataset import PAD, POOL_COUNT_CAP
from mtga.foundation.model import DraftFM, position_features

OPSET = 18
VALIDATION_TOLERANCE = 1e-4
VALIDATION_SEED = 20260707
GRAPHS = ["card_encoder.onnx", "set_encoder.onnx", "scorer.onnx"]


class _SetEncoderGraph(nn.Module):
    """encode_set's summary half: rarity-tagged cross-attention over the set."""

    def __init__(self, model):
        super().__init__()
        self.rarity_embedding = model.rarity_embedding
        self.set_tower = model.set_tower

    def forward(self, card_emb, rarity_ids):
        keys = card_emb + self.rarity_embedding(rarity_ids)
        return self.set_tower(keys.unsqueeze(0)).squeeze(0)


class _ScorerGraph(nn.Module):
    """DraftFM.forward with the table gathers (and the empty-pool branch)
    hoisted out: pool/pack rows arrive pre-gathered from the cached table."""

    def __init__(self, model):
        super().__init__()
        self.count_embedding = model.count_embedding
        self.pool_tower = model.pool_tower
        self.wr_embedding = model.wr_embedding
        self.games_embedding = model.games_embedding
        self.format_embedding = model.format_embedding
        self.context_mlp = model.context_mlp
        self.scorer = model.scorer

    def forward(self, pool_emb, pool_counts, pool_mask, pack_emb, pack_mask,
                wr_id, games_id, format_id, position, set_scalars,
                set_summary):
        keys = pool_emb + self.count_embedding(pool_counts)
        pool_summary = self.pool_tower(keys, key_padding_mask=pool_mask)

        batch = pool_emb.shape[0]
        context = self.context_mlp(torch.cat([
            self.wr_embedding(wr_id),
            self.games_embedding(games_id),
            self.format_embedding(format_id),
            position,
            set_scalars,
            set_summary.unsqueeze(0).expand(batch, -1),
        ], dim=1))

        pool_b = pool_summary.unsqueeze(1).expand_as(pack_emb)
        ctx_b = context.unsqueeze(1).expand(-1, pack_emb.shape[1], -1)
        h = torch.cat([pack_emb, pool_b, pack_emb * pool_b, ctx_b], dim=2)
        logits = self.scorer(h).squeeze(-1)
        return logits.masked_fill(pack_mask, float("-inf"))


def load_checkpoint(checkpoint_path):
    """(model.eval() on CPU, checkpoint dict) from a training best.pt."""
    checkpoint = torch.load(checkpoint_path, map_location="cpu",
                            weights_only=False)
    config = checkpoint["config"]
    feat_dim = checkpoint["model"]["card_encoder.net.0.weight"].shape[0]
    if not config.get("set_ctx", True):
        raise ValueError(
            "export requires set_ctx=True (the scorer graph takes a set "
            "summary; set_ctx=False models are ablation-only)")
    model = DraftFM(feat_dim, config["d_model"], config["dropout"],
                    config["set_ctx"])
    model.load_state_dict(checkpoint["model"])
    model.eval()
    return model, checkpoint


def export_graphs(model, out_dir):
    """Write the three graphs + constants.npz. Returns (feat_dim, d)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    feat_dim = model.card_encoder.net[1].in_features
    d = model.d

    n_cards = torch.export.Dim("n_cards", min=2)
    batch = torch.export.Dim("batch", min=1)
    pool = torch.export.Dim("pool_slots", min=1)
    pack = torch.export.Dim("pack_slots", min=1)

    torch.onnx.export(
        model.card_encoder, (torch.randn(8, feat_dim),),
        str(out_dir / "card_encoder.onnx"),
        input_names=["features"], output_names=["card_emb"],
        dynamic_shapes=({0: n_cards},), dynamo=True, opset_version=OPSET,
    )
    torch.onnx.export(
        _SetEncoderGraph(model),
        (torch.randn(8, d), torch.randint(0, 6, (8,))),
        str(out_dir / "set_encoder.onnx"),
        input_names=["card_emb", "rarity_ids"], output_names=["set_summary"],
        dynamic_shapes=({0: n_cards}, {0: n_cards}),
        dynamo=True, opset_version=OPSET,
    )
    b, p, k = 3, 5, 4
    scorer_args = (
        torch.randn(b, p, d),                       # pool_emb
        torch.randint(0, POOL_COUNT_CAP + 1, (b, p)),  # pool_counts
        torch.zeros(b, p, dtype=torch.bool),        # pool_mask
        torch.randn(b, k, d),                       # pack_emb
        torch.zeros(b, k, dtype=torch.bool),        # pack_mask
        torch.randint(15, 46, (b,)),                # wr_id
        torch.randint(0, 7, (b,)),                  # games_id
        torch.randint(0, 3, (b,)),                  # format_id
        torch.randn(b, 7),                          # position
        torch.randn(b, 4),                          # set_scalars
        torch.randn(d),                             # set_summary
    )
    torch.onnx.export(
        _ScorerGraph(model), scorer_args, str(out_dir / "scorer.onnx"),
        input_names=["pool_emb", "pool_counts", "pool_mask", "pack_emb",
                     "pack_mask", "wr_id", "games_id", "format_id",
                     "position", "set_scalars", "set_summary"],
        output_names=["logits"],
        dynamic_shapes=(
            {0: batch, 1: pool}, {0: batch, 1: pool}, {0: batch, 1: pool},
            {0: batch, 1: pack}, {0: batch, 1: pack},
            {0: batch}, {0: batch}, {0: batch},
            {0: batch}, {0: batch}, None,
        ),
        dynamo=True, opset_version=OPSET,
    )

    with torch.no_grad():
        pool_null_input = (model.empty_pool
                           - model.count_embedding.weight[0]).numpy()
    np.savez(out_dir / "constants.npz",
             pool_null_input=pool_null_input.astype(np.float32))
    return feat_dim, d


# ---------------------------------------------------------------------------
# Validation: torch forward vs the composed three-graph ONNX path.

def _random_batch(rng, n_cards, batch, pool_len, pack_len, picks_per_pack=14):
    """Numpy batch in the training layout, with one guaranteed-empty pool."""
    pool_slots = np.full((batch, pool_len), int(PAD), dtype=np.int64)
    pool_counts = np.zeros((batch, pool_len), dtype=np.int64)
    pack_slots = np.full((batch, pack_len), int(PAD), dtype=np.int64)
    context = np.zeros((batch, 5), dtype=np.int64)
    for i in range(batch):
        n_pool = 0 if i == 0 else int(rng.integers(0, min(pool_len, n_cards) + 1))
        slots = rng.choice(n_cards, size=n_pool, replace=False)
        pool_slots[i, :n_pool] = slots
        pool_counts[i, :n_pool] = rng.integers(1, POOL_COUNT_CAP + 1, n_pool)
        n_pack = int(rng.integers(1, pack_len + 1))
        pack_slots[i, :n_pack] = rng.choice(n_cards, size=n_pack, replace=False)
        context[i] = [rng.integers(0, 3), rng.integers(0, picks_per_pack),
                      rng.integers(15, 46), rng.integers(0, 7),
                      rng.integers(0, 3)]
    position = position_features(torch.from_numpy(context),
                                 picks_per_pack).numpy()
    set_scalars = np.tile(
        np.array([n_cards / 400.0, 0.0, 1.0, 0.0], dtype=np.float32),
        (batch, 1))
    return {
        "pool_slots": pool_slots, "pool_counts": pool_counts,
        "pack_slots": pack_slots, "position": position.astype(np.float32),
        "wr_id": context[:, 2], "games_id": context[:, 3],
        "format_id": context[:, 4], "set_scalars": set_scalars,
    }


def _torch_logits(model, features, rarity_ids, batch):
    with torch.no_grad():
        table, summary = model.encode_set(torch.from_numpy(features),
                                          torch.from_numpy(rarity_ids))
        logits = model(table, summary,
                       {k: torch.from_numpy(v) for k, v in batch.items()})
    return logits.numpy()


def onnx_logits(sessions, pool_null_input, features, rarity_ids, batch):
    """The serving-side composition: gathers + null injection in numpy,
    then the three graphs. Mirrors mtga.models.draftfm exactly."""
    card, set_enc, scorer = sessions
    table = card.run(["card_emb"], {"features": features})[0]
    summary = set_enc.run(["set_summary"], {
        "card_emb": table, "rarity_ids": rarity_ids})[0]

    pool_mask = batch["pool_slots"] == int(PAD)
    pool_emb = table[np.where(pool_mask, 0, batch["pool_slots"])]
    empty = pool_mask.all(axis=1)
    pool_emb[empty, 0] = pool_null_input
    pool_mask = pool_mask.copy()
    pool_mask[empty, 0] = False

    pack_mask = batch["pack_slots"] == int(PAD)
    pack_emb = table[np.where(pack_mask, 0, batch["pack_slots"])]

    logits = scorer.run(["logits"], {
        "pool_emb": pool_emb.astype(np.float32),
        "pool_counts": batch["pool_counts"],
        "pool_mask": pool_mask,
        "pack_emb": pack_emb.astype(np.float32),
        "pack_mask": pack_mask,
        "wr_id": batch["wr_id"], "games_id": batch["games_id"],
        "format_id": batch["format_id"],
        "position": batch["position"], "set_scalars": batch["set_scalars"],
        "set_summary": summary,
    })[0]
    return logits, pack_mask


def validate_export(model, version_dir, n_cards=40,
                    tolerance=VALIDATION_TOLERANCE, seed=VALIDATION_SEED):
    """Torch-vs-ORT parity on random inputs; raises RuntimeError past
    tolerance. Covers training shapes (46/16), serving shapes (B=1, short
    dynamic pool/pack axes), and the empty-pool null-token path."""
    import onnxruntime

    version_dir = Path(version_dir)
    sessions = tuple(
        onnxruntime.InferenceSession(str(version_dir / g),
                                     providers=["CPUExecutionProvider"])
        for g in GRAPHS)
    pool_null_input = np.load(version_dir / "constants.npz")["pool_null_input"]

    rng = np.random.default_rng(seed)
    feat_dim = model.card_encoder.net[1].in_features
    features = rng.normal(size=(n_cards, feat_dim)).astype(np.float32)
    rarity_ids = rng.integers(0, 6, n_cards).astype(np.int64)

    report = {"tolerance": tolerance, "cases": {}}
    worst = 0.0
    for label, (batch_size, pool_len, pack_len) in {
        "train_shape_b64": (64, 46, 16),
        "serve_shape_b1": (1, 1, 4),      # row 0 is always the empty pool
        "serve_shape_b2_short": (2, 5, 3),
    }.items():
        batch = _random_batch(rng, n_cards, batch_size, pool_len, pack_len)
        want = _torch_logits(model, features, rarity_ids, batch)
        got, pack_mask = onnx_logits(sessions, pool_null_input, features,
                                     rarity_ids, batch)
        if not np.isneginf(got[pack_mask]).all():
            raise RuntimeError(f"{label}: padded pack slots not masked to -inf")
        diff = float(np.abs(want[~pack_mask] - got[~pack_mask]).max())
        report["cases"][label] = diff
        worst = max(worst, diff)
    report["max_abs_diff"] = worst
    if worst >= tolerance:
        raise RuntimeError(
            f"ONNX export validation FAILED: max |torch - ort| = {worst:.3e} "
            f">= {tolerance:.0e} ({report['cases']})")
    return report


def export_version(checkpoint_path, out_dir, wr_id, games_id, manifest_hash,
                   model_id=None):
    """Export + validate + write meta.json. Returns the meta dict.

    meta.json is written only after validation passes, so a failed export
    can never be picked up by the registry (which requires meta.json).
    """
    checkpoint_path = Path(checkpoint_path)
    out_dir = Path(out_dir)
    model, checkpoint = load_checkpoint(checkpoint_path)
    feat_dim, d = export_graphs(model, out_dir)
    report = validate_export(model, out_dir)

    meta = {
        "model_id": model_id or f"_foundation/{out_dir.name}",
        "kind": "draftfm-zeroshot",
        "manifest_hash": manifest_hash,
        "serving": {"wr_id": int(wr_id), "games_id": int(games_id)},
        "config": checkpoint.get("config"),
        "checkpoint": str(checkpoint_path),
        "checkpoint_sha256": runlog.file_sha256(checkpoint_path),
        "checkpoint_step": checkpoint.get("step"),
        "checkpoint_val_top1": checkpoint.get("val_top1"),
        "feat_dim": int(feat_dim),
        "d_model": int(d),
        "opset": OPSET,
        "torch_version": torch.__version__,
        "exported_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "validation": report,
    }
    with open(out_dir / "meta.json", "w") as fh:
        json.dump(meta, fh, indent=2)
    return meta
