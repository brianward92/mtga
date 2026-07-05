"""Mulligan v1 training + evaluation protocol.

Outcome head: BCE on KEPT decision rows only (selection-on-keep caveat in
mtga/mulligan/data.py). Split is BY DRAFT via draftnet.split_by_draft's
crc32 convention so no draft leaks across train/val.

Evaluation (all reported in metrics.json):
  * AUC / log-loss / Brier / ECE + a decile reliability table on held-out
    kept rows.
  * Sanity marginals: mean predicted P(win) vs empirical by n_lands in a
    7-card hand (should peak at 3-4 lands), by hand size, by on_play.
  * Decision analysis on ALL held-out rows (kept and mulled): the model
    keeps iff P(win|keep) > continuation_value(hand_size, on_play), the
    continuation table being fit on the TRAIN split. Reports agreement
    with observed human keeps and the disagreement cells — the hands the
    model would mull but humans kept should show a depressed realized win
    rate (that is the "beats the crowd" test). For hands humans MULLED the
    realized outcome is the post-mulligan game, not the counterfactual
    keep, so those cells are context only.

Data-loading sanity: mulligan anchors must reproduce EXPECTED_ANCHORS for
known files before any training happens.
"""

import datetime
import json

import numpy as np

from mtga.foundation import runlog
from mtga.lands import paths
from mtga.models.draftnet import VAL_PERMILLE, split_by_draft
from mtga.mulligan import data as mdata
from mtga.mulligan.model import (DEFAULT_DROPOUT, DEFAULT_HIDDEN, MulliganNet,
                                 predict_proba)

MODEL_FAMILY = "_mulligan"

# Win rate by num_mulligans on kept rows, rounded to 3 decimals — must
# reproduce exactly from the curated file or training refuses to start.
EXPECTED_ANCHORS = {
    ("DSK", "PremierDraft"): {0: 0.562, 1: 0.416, 2: 0.248},
}


# ---------------------------------------------------------------------------
# Metrics.


def roc_auc(y, p):
    """Rank-based AUC (tie-aware); NaN when only one class is present."""
    y = np.asarray(y, dtype=bool)
    n_pos, n_neg = int(y.sum()), int((~y).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(len(p), dtype=np.float64)
    sorted_p = np.asarray(p)[order]
    # average ranks over tied groups
    boundaries = np.flatnonzero(np.diff(sorted_p)) + 1
    starts = np.concatenate([[0], boundaries])
    ends = np.concatenate([boundaries, [len(p)]])
    for start, end in zip(starts, ends):
        ranks[order[start:end]] = 0.5 * (start + end - 1) + 1.0
    return float((ranks[y].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def calibration(y, p, n_bins=10):
    """Decile reliability table + ECE (weighted |mean_p - frac_pos|)."""
    y = np.asarray(y, dtype=np.float64)
    p = np.asarray(p, dtype=np.float64)
    edges = np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))
    which = np.clip(np.searchsorted(edges, p, side="right") - 1,
                    0, len(edges) - 2)
    table, ece = [], 0.0
    for b in range(len(edges) - 1):
        sel = which == b
        n = int(sel.sum())
        if n == 0:
            continue
        mean_p, frac_pos = float(p[sel].mean()), float(y[sel].mean())
        table.append({"bin": b, "lo": float(edges[b]), "hi": float(edges[b + 1]),
                      "n": n, "mean_pred": round(mean_p, 4),
                      "frac_won": round(frac_pos, 4)})
        ece += (n / len(p)) * abs(mean_p - frac_pos)
    return {"ece": round(float(ece), 4), "reliability": table}


def log_loss(y, p, eps=1e-7):
    p = np.clip(np.asarray(p, dtype=np.float64), eps, 1 - eps)
    y = np.asarray(y, dtype=np.float64)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


def _cell(pred, won, sel):
    n = int(sel.sum())
    return {"n": n,
            "mean_pred": round(float(pred[sel].mean()), 4) if n else None,
            "win_rate": round(float(won[sel].mean()), 4) if n else None}


def sanity_tables(data, idx, pred):
    """Predicted vs empirical marginals on held-out kept rows."""
    won, on_play = data.won[idx], data.on_play[idx]
    hand_size = data.hand_size[idx]
    n_lands = np.rint(
        data.extras[idx, mdata.EXTRA_COLUMNS.index("n_lands")]
        * mdata.FULL_HAND).astype(int)

    by_lands = {}
    full = hand_size == mdata.FULL_HAND
    for lands in range(mdata.FULL_HAND + 1):
        sel = full & (n_lands == lands)
        if sel.any():
            by_lands[lands] = _cell(pred, won, sel)
    by_size = {int(s): _cell(pred, won, hand_size == s)
               for s in sorted(np.unique(hand_size), reverse=True)}
    by_play = {("play" if play else "draw"): _cell(pred, won, on_play == play)
               for play in (True, False)}
    return {"by_n_lands_at_7": by_lands, "by_hand_size": by_size,
            "by_on_play": by_play}


def decision_analysis(data, idx, pred, table):
    """Model keep/mull vs observed human keep/mull on held-out rows.

    Realized win rates in the human-kept cells are true keep outcomes; in
    the human-mulled cells they are post-mulligan outcomes (context only).
    """
    hand_size, on_play = data.hand_size[idx], data.on_play[idx]
    kept, won = data.kept[idx], data.won[idx]

    thresholds = np.empty(len(idx), dtype=np.float64)
    threshold_map = {}
    for size in np.unique(hand_size):
        for play in (True, False):
            value = mdata.continuation_value(table, size, play)
            threshold_map[f"{int(size)}_{'play' if play else 'draw'}"] = round(value, 4)
            thresholds[(hand_size == size) & (on_play == play)] = value
    model_keep = pred > thresholds

    def cells(mask):
        return {
            "human_keep_model_keep": _cell(pred, won, mask & kept & model_keep),
            "human_keep_model_mull": _cell(pred, won, mask & kept & ~model_keep),
            "human_mull_model_keep": _cell(pred, won, mask & ~kept & model_keep),
            "human_mull_model_mull": _cell(pred, won, mask & ~kept & ~model_keep),
        }

    everything = np.ones(len(idx), dtype=bool)
    return {
        "thresholds": threshold_map,
        "agreement": round(float((model_keep == kept).mean()), 4),
        "human_keep_rate": round(float(kept.mean()), 4),
        "model_keep_rate": round(float(model_keep.mean()), 4),
        "cells": cells(everything),
        "cells_at_7": cells(hand_size == mdata.FULL_HAND),
    }


# ---------------------------------------------------------------------------
# Training.


def _batches(n, batch_size, rng=None):
    order = np.arange(n) if rng is None else rng.permutation(n)
    for start in range(0, n, batch_size):
        yield order[start:start + batch_size]


def train(set_code, limited_type, epochs=8, batch_size=4096, lr=1e-3,
          hidden=DEFAULT_HIDDEN, dropout=DEFAULT_DROPOUT, seed=17,
          patience=2, val_permille=VAL_PERMILLE, subsample=None,
          progress=print):
    """Train and return (model, report, context) — persistence is separate."""
    import torch

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)

    data = mdata.load_dataset(set_code, limited_type)
    anchors = mdata.mulligan_anchors(data)
    expected = EXPECTED_ANCHORS.get((set_code, limited_type))
    if expected:
        mdata.verify_anchors(anchors, expected)
        progress(f"anchors reproduce: { {m: round(a['win_rate'], 3) for m, a in anchors.items()} }")

    train_mask, val_mask = split_by_draft(data.draft_id, val_permille)
    table = mdata.continuation_table(data, mask=train_mask)

    tr_idx = np.flatnonzero(data.kept & train_mask)
    va_idx = np.flatnonzero(data.kept & val_mask)
    if subsample and subsample < len(tr_idx):
        tr_idx = rng.choice(tr_idx, size=subsample, replace=False)
    progress(f"decisions: {data.n_rows:,} ({int(data.kept.sum()):,} kept) | "
             f"train {len(tr_idx):,} / val {len(va_idx):,} kept rows | "
             f"input dim {data.input_dim}")

    model = MulliganNet(data.input_dim, hidden, dropout)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    y_val = data.won[va_idx]

    best = {"auc": -1.0, "epoch": 0}
    best_state = None
    stale = 0
    for epoch in range(1, epochs + 1):
        model.train()
        for order in _batches(len(tr_idx), batch_size, rng):
            if len(order) < 2:
                continue
            rows = tr_idx[order]
            x = torch.from_numpy(mdata.assemble(data, rows))
            y = torch.from_numpy(data.won[rows])
            optimizer.zero_grad()
            loss = torch.nn.functional.binary_cross_entropy_with_logits(
                model(x), y)
            loss.backward()
            optimizer.step()

        p_val = predict_proba(model, data, va_idx)
        auc = roc_auc(y_val, p_val)
        progress(f"epoch {epoch}: val auc {auc:.4f} "
                 f"log_loss {log_loss(y_val, p_val):.4f}")
        if auc > best["auc"]:
            best = {"auc": auc, "epoch": epoch}
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            stale = 0
        else:
            stale += 1
            if stale >= patience:
                progress(f"early stop after epoch {epoch}")
                break
    if best_state is not None:  # NaN AUC (one-class val) keeps the last state
        model.load_state_dict(best_state)

    # Outcome-head quality on held-out kept rows.
    p_val = predict_proba(model, data, va_idx)
    outcome = {
        "auc": round(roc_auc(y_val, p_val), 4),
        "log_loss": round(log_loss(y_val, p_val), 4),
        "brier": round(float(np.mean((p_val - y_val) ** 2)), 4),
        "base_rate": round(float(y_val.mean()), 4),
        **calibration(y_val, p_val),
    }

    # Decision analysis on ALL held-out rows (kept + mulled).
    all_val = np.flatnonzero(val_mask)
    p_all = predict_proba(model, data, all_val)

    report = {
        "n_decisions": data.n_rows,
        "n_kept": int(data.kept.sum()),
        "n_train": len(tr_idx),
        "n_val_kept": len(va_idx),
        "n_val_all": len(all_val),
        "anchors": {str(m): a for m, a in anchors.items()},
        "continuation": table,
        "outcome_head": outcome,
        "sanity": sanity_tables(data, va_idx, p_val),
        "decision": decision_analysis(data, all_val, p_all, table),
        "best_epoch": best["epoch"],
    }
    context = {
        "set": set_code, "format": limited_type, "kind": "mulligan-mlp-v1",
        "input_dim": data.input_dim, "hidden": list(hidden),
        "dropout": dropout, "extras": mdata.EXTRA_COLUMNS,
        "seed": seed, "epochs": epochs, "epochs_ran": epoch,
        "batch_size": batch_size, "lr": lr, "val_permille": val_permille,
        "subsample": subsample,
        "n_params": sum(p.numel() for p in model.parameters()),
    }
    return model, report, context


def save_version(model, report, context, tag=None):
    """Persist checkpoint.pt + meta.json + metrics.json + continuation.json."""
    import torch

    set_code, limited_type = context["set"], context["format"]
    tag = tag or f"v1-{set_code.lower()}"
    out_dir = paths.MODELS_DIR / MODEL_FAMILY / tag
    out_dir.mkdir(parents=True, exist_ok=True)

    torch.save({"model": model.state_dict(), "config": context},
               out_dir / "checkpoint.pt")

    mull_meta = paths.meta_path(paths.replay_mull_path(set_code, limited_type))
    data_etag = None
    if mull_meta.exists():
        with open(mull_meta) as fh:
            data_etag = json.load(fh).get("source_etag")
    manifest_hash = None
    if paths.FEATURIZER_MANIFEST.exists():
        with open(paths.FEATURIZER_MANIFEST) as fh:
            manifest_hash = json.load(fh).get("content_hash")

    meta = {
        "model_id": f"{MODEL_FAMILY}/{tag}",
        "kind": context["kind"],
        "arch": {"input_dim": context["input_dim"],
                 "hidden": context["hidden"], "dropout": context["dropout"],
                 "extras": context["extras"]},
        "train": {k: context[k] for k in
                  ["seed", "epochs_ran", "batch_size", "lr", "val_permille",
                   "subsample"]},
        "data_etag": data_etag,
        "manifest_hash": manifest_hash,
        "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "torch_version": torch.__version__,
        "caveats": [
            "outcome head is trained on kept hands only (selection on keep)",
            "Bo1 hand smoothing shapes the 7-card candidate distribution",
            "continuation table is empirical, fit on the train split",
        ],
    }
    with open(out_dir / "meta.json", "w") as fh:
        json.dump(meta, fh, indent=2)
    with open(out_dir / "metrics.json", "w") as fh:
        json.dump(report, fh, indent=2)
    with open(out_dir / "continuation.json", "w") as fh:
        json.dump(report["continuation"], fh, indent=2)
    return out_dir


def ledger_run(report, context, out_dir):
    """Append the run record to the experiment ledger; returns the record."""
    record = {
        "run_id": runlog.new_run_id(
            f"mulligan_{context['set'].lower()}_{context['format'].lower()}"),
        "kind": context["kind"],
        "config": context,
        "metrics": {
            "auc": report["outcome_head"]["auc"],
            "log_loss": report["outcome_head"]["log_loss"],
            "ece": report["outcome_head"]["ece"],
            "decision_agreement": report["decision"]["agreement"],
            "n_train": report["n_train"],
            "n_val_kept": report["n_val_kept"],
            "best_epoch": report["best_epoch"],
        },
        "anchors": report["anchors"],
        "artifacts": {
            "dir": str(out_dir),
            "checkpoint_sha256": runlog.file_sha256(out_dir / "checkpoint.pt"),
        },
    }
    return runlog.append(record)
