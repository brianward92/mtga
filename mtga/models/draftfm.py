"""Serve a DraftFM ONNX export through the EVModel protocol.

Zero-shot tier: one exported foundation model (models/_foundation/<tag>/,
card_encoder.onnx + scorer.onnx + optionally set_encoder.onnx +
constants.npz + meta.json from scripts/export_draftfm.py) scores ANY set for
which per-set assets exist (scripts/build_set_assets.py). onnxruntime only —
torch never loads in the serving process.

set_encoder.onnx and the set summary it produces only exist for set_ctx=True
exports; set_ctx=False exports (the current winning recipe, see
mtga/foundation/export.py) have no such file, and "set_summary" is simply
absent from the scorer's inputs rather than zeroed.

At construction the card table [N, d] and set summary [d] (if any) are
computed once from the assets' feature matrix; score_pack is numpy gathers
over that cached table plus a single scorer.onnx call. Empty pools use the
learned null token via constants.npz's pool_null_input (see mtga/foundation/
export.py for why it differs from the raw empty_pool parameter).
"""

import json
from pathlib import Path

import numpy as np

from mtga.lands import paths
from mtga.models.base import rank_scores

# Mirrors mtga.foundation.dataset (tag-frozen); duplicated so the serving
# process never imports the training stack (duckdb et al).
POOL_COUNT_CAP = 8
FORMAT_IDS = {"PremierDraft": 0, "TradDraft": 1}
OTHER_FORMAT_ID = 2
DEFAULT_PICKS_PER_PACK = 14


def position_features(pack_number, pick_number, picks_per_pack):
    """Numpy twin of mtga.foundation.model.position_features for one pick."""
    ppp = float(picks_per_pack)
    pool_size = pack_number * ppp + pick_number
    return np.array([[
        1.0 if pack_number == 0 else 0.0,
        1.0 if pack_number == 1 else 0.0,
        1.0 if pack_number == 2 else 0.0,
        pick_number / ppp,
        max(ppp - 1 - pick_number, 0.0) / ppp,
        pool_size / 45.0,
        min(pool_size / (3 * ppp), 1.0),
    ]], dtype=np.float32)


def load_assets(assets_path):
    """Per-set serving assets dict from a build_set_assets.py npz."""
    assets_path = Path(assets_path)
    if not assets_path.exists():
        raise FileNotFoundError(
            f"no DraftFM set assets at {assets_path} "
            f"(run scripts/build_set_assets.py)")
    with np.load(assets_path) as z:
        return {
            "features": z["features"].astype(np.float32),
            "rarity_ids": z["rarity_ids"].astype(np.int64),
            "names": [str(n) for n in z["names"]],
            "grp_ids": json.loads(str(z["grp_ids"])),
            "manifest_hash": str(z["manifest_hash"]),
            "picks_per_pack": int(z["picks_per_pack"]),
        }


class OnnxDraftFMModel:
    model_kind = "draftfm-zeroshot"
    fallback = False  # a real model for the set, just not set-specific

    def __init__(self, version_dir, set_code, limited_type="PremierDraft",
                 assets_path=None):
        import onnxruntime

        version_dir = Path(version_dir)
        with open(version_dir / "meta.json") as fh:
            self.meta = json.load(fh)
        self.model_id = self.meta["model_id"]
        self.set_code = set_code
        self.limited_type = limited_type

        assets = load_assets(assets_path or paths.set_assets_path(set_code))
        expected = self.meta.get("manifest_hash")
        if expected and assets["manifest_hash"] and \
                expected != assets["manifest_hash"]:
            raise ValueError(
                f"featurizer manifest mismatch for {set_code}: model "
                f"{expected[:12]} vs assets {assets['manifest_hash'][:12]} "
                f"(rebuild the set assets)")

        # Match the model's expected feature width (no-text exports use 391).
        feat_dim = self.meta.get("feat_dim")
        if feat_dim and assets["features"].shape[1] > feat_dim:
            assets["features"] = assets["features"][:, :feat_dim]

        providers = ["CPUExecutionProvider"]
        card_encoder = onnxruntime.InferenceSession(
            str(version_dir / "card_encoder.onnx"), providers=providers)
        self.scorer = onnxruntime.InferenceSession(
            str(version_dir / "scorer.onnx"), providers=providers)

        # One-time set encode: everything at request time gathers from these.
        self.table = card_encoder.run(
            ["card_emb"], {"features": assets["features"]})[0]

        # set_ctx=False exports have no set_encoder graph at all -- not a
        # zeroed summary, an absent one (see mtga/foundation/export.py).
        set_encoder_path = version_dir / "set_encoder.onnx"
        if set_encoder_path.exists():
            set_encoder = onnxruntime.InferenceSession(
                str(set_encoder_path), providers=providers)
            self.set_summary = set_encoder.run(
                ["set_summary"],
                {"card_emb": self.table, "rarity_ids": assets["rarity_ids"]},
            )[0].astype(np.float32)
        else:
            self.set_summary = None
        self.pool_null_input = np.load(version_dir / "constants.npz")[
            "pool_null_input"].astype(np.float32)

        self.grp_to_row = {}
        for row, name in enumerate(assets["names"]):
            for grp_id in assets["grp_ids"].get(name, []):
                self.grp_to_row.setdefault(int(grp_id), row)

        serving = self.meta.get("serving", {})
        self.wr_id = int(serving.get("wr_id", 33))
        self.games_id = int(serving.get("games_id", 6))
        self.format_id = FORMAT_IDS.get(limited_type, OTHER_FORMAT_ID)
        self.picks_per_pack = (assets["picks_per_pack"]
                               or DEFAULT_PICKS_PER_PACK)
        ppp = self.picks_per_pack
        self.set_scalars = np.array([[
            len(assets["names"]) / 400.0,
            float(ppp == 13), float(ppp == 14), float(ppp == 15),
        ]], dtype=np.float32)

    def _pool_inputs(self, pool_grp_ids):
        rows = [self.grp_to_row[g] for g in pool_grp_ids
                if g in self.grp_to_row]
        if not rows:
            # Empty pool: the learned null token, reconstructed in-graph.
            return (self.pool_null_input[None, None],
                    np.zeros((1, 1), dtype=np.int64),
                    np.zeros((1, 1), dtype=bool))
        uniq, counts = np.unique(np.asarray(rows), return_counts=True)
        return (self.table[uniq][None],
                np.minimum(counts, POOL_COUNT_CAP)[None].astype(np.int64),
                np.zeros((1, len(uniq)), dtype=bool))

    def score_pack(self, pack_grp_ids, pool_grp_ids, pack_number=None,
                   pick_number=None):
        rows = [self.grp_to_row.get(g) for g in pack_grp_ids]
        known = sorted({r for r in rows if r is not None})
        if not known:
            return rank_scores(pack_grp_ids, [None] * len(pack_grp_ids))

        pool_emb, pool_counts, pool_mask = self._pool_inputs(pool_grp_ids)
        if pack_number is None or pick_number is None:
            pool_size = len(pool_grp_ids)
            pack_number = pool_size // self.picks_per_pack
            pick_number = pool_size % self.picks_per_pack
        position = position_features(int(pack_number), int(pick_number),
                                     self.picks_per_pack)

        feed = {
            "pool_emb": pool_emb,
            "pool_counts": pool_counts,
            "pool_mask": pool_mask,
            "pack_emb": self.table[known][None],
            "pack_mask": np.zeros((1, len(known)), dtype=bool),
            "wr_id": np.array([self.wr_id], dtype=np.int64),
            "games_id": np.array([self.games_id], dtype=np.int64),
            "format_id": np.array([self.format_id], dtype=np.int64),
            "position": position,
            "set_scalars": self.set_scalars,
        }
        if self.set_summary is not None:
            feed["set_summary"] = self.set_summary
        logits = self.scorer.run(["logits"], feed)[0][0]

        by_row = dict(zip(known, logits))
        evs = [None if r is None else float(by_row[r]) for r in rows]
        return rank_scores(pack_grp_ids, evs)
