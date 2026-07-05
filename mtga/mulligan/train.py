"""Mulligan training + evaluation protocol (v1 single-set, v2 cross-set).

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

v2 (train_crossset): the same protocol run over data.load_datasets' cross-
set concatenation, plus a held_out_sets leg that is excluded from training
AND from the continuation table and scored zero-shot with the frozen
model/table — the mulligan analogue of DraftFM's (mtga/foundation) F-dev
holdout protocol. See train_crossset's docstring for the full rationale,
in particular why no set-identity feature is added (DraftFM's "no
set-identity embedding anywhere" zero-shot invariant applies here too).
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


def _fit_mlp(data, tr_idx, va_idx, epochs, batch_size, lr, hidden, dropout,
            seed, patience, progress):
    """Shared MulliganNet training loop (train() and train_crossset()).

    tr_idx/va_idx are KEPT-row indices (outcome head trains/selects on kept
    hands only). Returns (model, best_epoch, epochs_ran).
    """
    import torch

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)

    model = MulliganNet(data.input_dim, hidden, dropout)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    y_val = data.won[va_idx]

    best = {"auc": -1.0, "epoch": 0}
    best_state = None
    stale = 0
    epoch = 0
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
    return model, best["epoch"], epoch


def train(set_code, limited_type, epochs=8, batch_size=4096, lr=1e-3,
          hidden=DEFAULT_HIDDEN, dropout=DEFAULT_DROPOUT, seed=17,
          patience=2, val_permille=VAL_PERMILLE, subsample=None,
          progress=print):
    """Train and return (model, report, context) — persistence is separate."""
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

    model, best_epoch, epochs_ran = _fit_mlp(
        data, tr_idx, va_idx, epochs, batch_size, lr, hidden, dropout, seed,
        patience, progress)

    # Outcome-head quality on held-out kept rows.
    y_val = data.won[va_idx]
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
        "best_epoch": best_epoch,
    }
    context = {
        "set": set_code, "format": limited_type, "kind": "mulligan-mlp-v1",
        "input_dim": data.input_dim, "hidden": list(hidden),
        "dropout": dropout, "extras": mdata.EXTRA_COLUMNS,
        "seed": seed, "epochs": epochs, "epochs_ran": epochs_ran,
        "batch_size": batch_size, "lr": lr, "val_permille": val_permille,
        "subsample": subsample,
        "n_params": sum(p.numel() for p in model.parameters()),
    }
    return model, report, context


# ---------------------------------------------------------------------------
# v2: cross-set training (see data.py's module docstring for the loading
# side). Same architecture/protocol as train() above; train_crossset just
# runs it over a concatenated multi-set corpus and adds a held-out zero-shot
# leg, mirroring DraftFM's cross-set philosophy (one model, many sets, a
# held-out trio scored zero-shot) for keep/mull decisions.


def _per_set_report(data, idx, pred, table, set_names):
    """Break outcome-head + decision metrics for idx down by source set.

    idx/pred are aligned (pred[i] is the model's P(win) for row idx[i]);
    only sets actually present in idx are reported.
    """
    out = {}
    set_of_idx = data.set_code[idx]
    for name in set_names:
        sel = set_of_idx == name
        if not sel.any():
            continue
        rows, preds = idx[sel], pred[sel]
        kept_sel = data.kept[rows]
        entry = {"n": int(sel.sum()), "n_kept": int(kept_sel.sum())}
        if kept_sel.any():
            y, p = data.won[rows][kept_sel], preds[kept_sel]
            entry["outcome_head"] = {
                "auc": round(roc_auc(y, p), 4),
                "log_loss": round(log_loss(y, p), 4),
                "brier": round(float(np.mean((p - y) ** 2)), 4),
                "base_rate": round(float(y.mean()), 4),
            }
        decision = decision_analysis(data, rows, preds, table)
        entry["decision_agreement"] = decision["agreement"]
        entry["human_keep_rate"] = decision["human_keep_rate"]
        entry["model_keep_rate"] = decision["model_keep_rate"]
        out[name] = entry
    return out


def train_crossset(train_sets, limited_type, held_out_sets=(), epochs=8,
                   batch_size=4096, lr=1e-3, hidden=DEFAULT_HIDDEN,
                   dropout=DEFAULT_DROPOUT, seed=17, patience=2,
                   val_permille=VAL_PERMILLE, subsample=None, progress=print):
    """v2: train ONE mulligan model across MULTIPLE sets' replay_mull data.

    Mirrors DraftFM's cross-set philosophy (mtga/foundation): one model over
    the union of train_sets — split by draft_id (crc32), exactly like
    train()/split_by_draft, just applied to the concatenated pool — with
    held_out_sets EXCLUDED from training and the continuation table
    entirely, then scored zero-shot with the frozen model. That is the
    mulligan analogue of DraftFM's F-dev holdout protocol (docs/
    eval_protocol.md): pick held_out_sets disjoint from DraftFM's own dev
    trio {BRO, TMT, SOS} so the two projects don't quietly reuse the same
    held-out role on the same data.

    Same MulliganNet architecture, BCE-on-kept-rows loss, and empirical
    continuation-table design as v1 (train()) — the ask is SCALE, not a
    redesign. No set-identity feature is added to the model input (extras/
    hand/deck pooling are unchanged from v1, see data.py): DraftFM's design
    invariant is "no set-identity embedding anywhere", precisely because an
    embedding indexed by the training-set list cannot represent a set never
    seen at train time, which would undercut zero-shot generalization. Any
    per-set outcome/decision breakdown below (both within the training
    pool's val split and on the held-out sets) is reported purely as a
    DIAGNOSTIC — a base-rate/calibration gap by set is documented, not
    modeled, exactly as DraftFM documents rather than corrects for its
    Universes Beyond calibration penalty.
    """
    rng = np.random.default_rng(seed)
    train_sets, held_out_sets = list(train_sets), list(held_out_sets)

    data = mdata.load_datasets(train_sets, limited_type)
    anchor_checks = {}
    for (set_code, fmt), expected in EXPECTED_ANCHORS.items():
        if fmt != limited_type or set_code not in train_sets:
            continue
        set_anchors = mdata.mulligan_anchors(
            data, mask=(data.set_code == set_code))
        mdata.verify_anchors(set_anchors, expected)
        anchor_checks[set_code] = {
            m: round(a["win_rate"], 3) for m, a in set_anchors.items()}
        progress(f"{set_code} anchors reproduce: {anchor_checks[set_code]}")

    train_mask, val_mask = split_by_draft(data.draft_id, val_permille)
    table = mdata.continuation_table(data, mask=train_mask)

    tr_idx = np.flatnonzero(data.kept & train_mask)
    va_idx = np.flatnonzero(data.kept & val_mask)
    if subsample and subsample < len(tr_idx):
        tr_idx = rng.choice(tr_idx, size=subsample, replace=False)
    progress(f"train sets ({len(train_sets)}): {train_sets}")
    progress(f"decisions: {data.n_rows:,} ({int(data.kept.sum()):,} kept) | "
             f"train {len(tr_idx):,} / val {len(va_idx):,} kept rows | "
             f"input dim {data.input_dim}")

    model, best_epoch, epochs_ran = _fit_mlp(
        data, tr_idx, va_idx, epochs, batch_size, lr, hidden, dropout, seed,
        patience, progress)

    # Outcome-head quality on held-out (within-training-pool) kept rows.
    y_val = data.won[va_idx]
    p_val = predict_proba(model, data, va_idx)
    outcome = {
        "auc": round(roc_auc(y_val, p_val), 4),
        "log_loss": round(log_loss(y_val, p_val), 4),
        "brier": round(float(np.mean((p_val - y_val) ** 2)), 4),
        "base_rate": round(float(y_val.mean()), 4),
        **calibration(y_val, p_val),
    }

    all_val = np.flatnonzero(val_mask)
    p_all = predict_proba(model, data, all_val)
    decision = decision_analysis(data, all_val, p_all, table)

    report = {
        "train_sets": train_sets,
        "held_out_sets": held_out_sets,
        "n_decisions": data.n_rows,
        "n_kept": int(data.kept.sum()),
        "n_train": len(tr_idx),
        "n_val_kept": len(va_idx),
        "n_val_all": len(all_val),
        "anchors": anchor_checks,
        "continuation": table,
        "outcome_head": outcome,
        "sanity": sanity_tables(data, va_idx, p_val),
        "decision": decision,
        "per_set_val": _per_set_report(data, all_val, p_all, table, train_sets),
        "best_epoch": best_epoch,
    }

    if held_out_sets:
        progress(f"held-out (zero-shot) sets: {held_out_sets}")
        held = mdata.load_datasets(held_out_sets, limited_type)
        held_idx = np.arange(held.n_rows)
        p_held = predict_proba(model, held, held_idx)

        held_kept = np.flatnonzero(held.kept)
        y_held, p_held_kept = held.won[held_kept], p_held[held_kept]
        held_outcome = {
            "auc": round(roc_auc(y_held, p_held_kept), 4),
            "log_loss": round(log_loss(y_held, p_held_kept), 4),
            "brier": round(float(np.mean((p_held_kept - y_held) ** 2)), 4),
            "base_rate": round(float(y_held.mean()), 4),
            **calibration(y_held, p_held_kept),
        }
        held_decision = decision_analysis(held, held_idx, p_held, table)
        report["held_out"] = {
            "n_decisions": held.n_rows,
            "n_kept": int(held.kept.sum()),
            "outcome_head": held_outcome,
            "decision": held_decision,
            "per_set": _per_set_report(
                held, held_idx, p_held, table, held_out_sets),
        }
        progress(f"zero-shot on {held_out_sets}: auc {held_outcome['auc']:.4f} "
                f"decision_agreement {held_decision['agreement']:.4f} "
                f"(vs in-training val auc {outcome['auc']:.4f} / "
                f"agreement {decision['agreement']:.4f})")

    context = {
        "train_sets": train_sets, "held_out_sets": held_out_sets,
        "format": limited_type, "kind": "mulligan-mlp-v2-crossset",
        "input_dim": data.input_dim, "hidden": list(hidden),
        "dropout": dropout, "extras": mdata.EXTRA_COLUMNS,
        "seed": seed, "epochs": epochs, "epochs_ran": epochs_ran,
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


def save_crossset_version(model, report, context, tag="v2-crossset"):
    """v2 counterpart of save_version: no single set_code/data_etag, so
    data_etags is a {set: etag} map over every set the run touched
    (train_sets + held_out_sets)."""
    import torch

    limited_type = context["format"]
    out_dir = paths.MODELS_DIR / MODEL_FAMILY / tag
    out_dir.mkdir(parents=True, exist_ok=True)

    torch.save({"model": model.state_dict(), "config": context},
               out_dir / "checkpoint.pt")

    data_etags = {}
    for set_code in context["train_sets"] + context["held_out_sets"]:
        mull_meta = paths.meta_path(paths.replay_mull_path(set_code, limited_type))
        if mull_meta.exists():
            with open(mull_meta) as fh:
                data_etags[set_code] = json.load(fh).get("source_etag")
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
        "train_sets": context["train_sets"],
        "held_out_sets": context["held_out_sets"],
        "data_etags": data_etags,
        "manifest_hash": manifest_hash,
        "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "torch_version": torch.__version__,
        "caveats": [
            "outcome head is trained on kept hands only (selection on keep)",
            "Bo1 hand smoothing shapes the 7-card candidate distribution",
            "continuation table is empirical, fit on the TRAIN-SETS train "
            "split only (held_out_sets never touch it)",
            "held_out_sets are excluded from training entirely; the "
            "held_out block in metrics.json is a genuine zero-shot score",
            "no set-identity feature/embedding: architecture is identical "
            "to v1 (see train_crossset docstring)",
        ],
    }
    with open(out_dir / "meta.json", "w") as fh:
        json.dump(meta, fh, indent=2)
    with open(out_dir / "metrics.json", "w") as fh:
        json.dump(report, fh, indent=2)
    with open(out_dir / "continuation.json", "w") as fh:
        json.dump(report["continuation"], fh, indent=2)
    return out_dir


def ledger_run_crossset(report, context, out_dir):
    """Append the v2 cross-set run record to the experiment ledger."""
    metrics = {
        "auc": report["outcome_head"]["auc"],
        "log_loss": report["outcome_head"]["log_loss"],
        "ece": report["outcome_head"]["ece"],
        "decision_agreement": report["decision"]["agreement"],
        "n_train": report["n_train"],
        "n_val_kept": report["n_val_kept"],
        "best_epoch": report["best_epoch"],
    }
    if "held_out" in report:
        metrics["held_out_auc"] = report["held_out"]["outcome_head"]["auc"]
        metrics["held_out_log_loss"] = report["held_out"]["outcome_head"]["log_loss"]
        metrics["held_out_decision_agreement"] = (
            report["held_out"]["decision"]["agreement"])
    record = {
        "run_id": runlog.new_run_id("mulligan_crossset"),
        "kind": context["kind"],
        "config": context,
        "metrics": metrics,
        "anchors": report["anchors"],
        "artifacts": {
            "dir": str(out_dir),
            "checkpoint_sha256": runlog.file_sha256(out_dir / "checkpoint.pt"),
        },
    }
    return runlog.append(record)
