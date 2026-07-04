"""Resolve which EV model serves a (set, format) request.

Resolution order:
  1. trained `latest` model for the exact format
  2. trained `latest` for each alias in FORMAT_FALLBACKS (Quick/Trad borrow
     the Premier model — flagged `fallback` so the UI can label it)
  3. DraftFM zero-shot (models/_foundation/<format>/latest, else the
     format-agnostic models/_foundation/latest) — a real model for any set
     with built assets, so a brand-new set is served the moment its assets
     exist; once the nightly per-set model lands it outranks this tier
  4. HeuristicRatingsModel (own metrics, else cached site ratings) — cold start
  5. RarityColorHeuristic — absolute floor

Resolved models are cached in-process; the cache key includes the `latest`
symlink targets (per-set and foundation) and ratings-cache mtimes, so a
nightly retrain, foundation export, or ratings refresh hot-swaps without a
server restart.
"""

import json
import os

import numpy as np

from mtga.lands import config, paths
from mtga.models.base import rank_scores
from mtga.models.draftfm import OnnxDraftFMModel
from mtga.models.heuristic import HeuristicRatingsModel, RarityColorHeuristic

_cache = {}


class OnnxEVModel:
    model_kind = "draftnet-mlp"

    def __init__(self, version_dir, serving_format=None):
        import onnxruntime

        with open(version_dir / "meta.json") as file:
            self.meta = json.load(file)
        self.model_id = self.meta["model_id"]
        self.pool_cap = self.meta["arch"].get("pool_cap", 8)
        self.n_cards = len(self.meta["vocab"])
        self.grp_to_index = {}
        for entry in self.meta["vocab"]:
            for grp_id in entry.get("grp_ids") or (
                [entry["grp_id"]] if entry["grp_id"] is not None else []
            ):
                self.grp_to_index.setdefault(grp_id, entry["index"])
        trained_format = self.meta["model_id"].split("/")[1]
        self.fallback = serving_format is not None and serving_format != trained_format
        self.session = onnxruntime.InferenceSession(
            str(version_dir / "model.onnx"), providers=["CPUExecutionProvider"]
        )

    def score_pack(self, pack_grp_ids, pool_grp_ids, pack_number=None, pick_number=None):
        pool = np.zeros((1, self.n_cards), dtype=np.float32)
        for grp_id in pool_grp_ids:
            index = self.grp_to_index.get(grp_id)
            if index is not None and pool[0, index] < self.pool_cap:
                pool[0, index] += 1.0
        logits = self.session.run(["scores"], {"pool": pool})[0][0]
        evs = [
            float(logits[self.grp_to_index[g]]) if g in self.grp_to_index else None
            for g in pack_grp_ids
        ]
        return rank_scores(pack_grp_ids, evs)


def _latest_dir(set_code, limited_type):
    link = paths.MODELS_DIR / set_code / limited_type / "latest"
    if link.exists() and (link / "model.onnx").exists():
        return link
    return None


def _foundation_links(limited_type):
    """Candidate DraftFM `latest` links: format-specific, then shared."""
    base = paths.MODELS_DIR / "_foundation"
    return [base / limited_type / "latest", base / "latest"]


def _foundation_latest(limited_type):
    for link in _foundation_links(limited_type):
        if (link / "scorer.onnx").exists() and (link / "meta.json").exists():
            return link
    return None


def _cache_key(set_code, limited_type):
    parts = [set_code, limited_type]
    for fmt in [limited_type] + config.FORMAT_FALLBACKS.get(limited_type, []):
        link = paths.MODELS_DIR / set_code / fmt / "latest"
        parts.append(os.path.realpath(link) if link.exists() else "-")
    for link in _foundation_links(limited_type):
        parts.append(os.path.realpath(link) if link.exists() else "-")
    # DraftFM needs per-set assets; their appearance (day-1 set bring-up)
    # must invalidate a cached heuristic resolution without a restart.
    assets = paths.DATA_ROOT / "foundation" / "set_assets" / f"{set_code}.npz"
    parts.append(str(assets.stat().st_mtime) if assets.exists() else "-")
    for prefix, pathfn in [("cards_", paths.metrics_cards_path)]:
        metric_link = paths.latest_symlink(pathfn(set_code, limited_type, "x"), prefix)
        parts.append(str(metric_link.stat().st_mtime) if metric_link.exists() else "-")
    ratings_link = paths.latest_symlink(
        paths.card_ratings_path(set_code, limited_type, "x")
    )
    parts.append(str(ratings_link.stat().st_mtime) if ratings_link.exists() else "-")
    return tuple(parts)


def resolve(set_code, limited_type):
    key = _cache_key(set_code, limited_type)
    if key in _cache:
        return _cache[key]

    model = None
    latest = _latest_dir(set_code, limited_type)
    if latest is not None:
        model = OnnxEVModel(latest, serving_format=limited_type)
    else:
        for alias in config.FORMAT_FALLBACKS.get(limited_type, []):
            alias_latest = _latest_dir(set_code, alias)
            if alias_latest is not None:
                model = OnnxEVModel(alias_latest, serving_format=limited_type)
                break

    if model is None:
        foundation = _foundation_latest(limited_type)
        if foundation is not None:
            try:
                model = OnnxDraftFMModel(foundation, set_code, limited_type)
            except Exception as err:  # noqa: BLE001 — degrade, never 500
                print(f"draftfm unavailable for {set_code} {limited_type}: "
                      f"{type(err).__name__}: {err}")

    if model is None:
        for fmt in [limited_type, "PremierDraft"]:
            try:
                model = HeuristicRatingsModel(set_code, fmt)
                break
            except FileNotFoundError:
                continue

    if model is None:
        model = RarityColorHeuristic(set_code)

    # Data-version stamp: consumers caching derived results (e.g. the API's
    # P1P1 table) key on this so a hot-swap invalidates them too.
    model.cache_token = key

    _cache.clear()  # single-entry cache is plenty for one box
    _cache[key] = model
    return model
