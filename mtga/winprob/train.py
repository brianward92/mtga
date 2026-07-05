"""Win-probability v1 training + evaluation protocol.

Trains all three comparison models on the same standardized state matrix and
the same draft-level split:
  1. life_diff  — logistic on life_diff alone (the naive baseline)
  2. full       — logistic on all 25 features (the linear ceiling)
  3. mlp        — 25->64->32->1 ReLU MLP (non-linearity claim: 3 beats 2)

The comparison IS the result, so every metric is reported per turn bucket
(1-3 / 4-6 / 7-9 / 10+) and pooled, and the 2-vs-3 gap is called out
per bucket ("where does non-linearity live?").

Split is BY DRAFT via draftnet.split_by_draft (crc32), expanded from the
per-game key to turn rows through data.game_pos so no draft leaks across
train/val. Training rows may be subsampled for time; validation is always
the full held-out set.

Metrics reuse mtga.mulligan.train.roc_auc / log_loss (generic); the headline
ECE is 15-bin equal-mass (evalproto's protocol, reimplemented here because
evalproto.ece is a top-label pick metric, not a probability-head metric).

Data-loading sanity: state_anchors must reproduce EXPECTED_ANCHORS before any
training happens (mean game length + P(win | life-diff sign at turn 7)).
"""

import datetime
import json

import numpy as np

from mtga.foundation import runlog
from mtga.models.draftnet import VAL_PERMILLE, split_by_draft
from mtga.mulligan.train import calibration, log_loss, roc_auc
from mtga.winprob import data as wdata
from mtga.winprob.model import MLP_HIDDEN, WinProbNet, predict_proba

MODEL_FAMILY = "_winprob"

# turn <= hi defines each bucket; the last (None) catches 10+.
TURN_BUCKETS = [("t1-3", 3), ("t4-6", 6), ("t7-9", 9), ("t10+", None)]

# Reproduced exactly from the curated DSK Premier file or training refuses to
# start: mean game length and P(win | life-diff sign) at turn 7.
EXPECTED_ANCHORS = {
    ("DSK", "PremierDraft"): {"mean_turns": 8.995, "ahead": 0.689,
                              "behind": 0.355},
}

MODEL_SPECS = [
    {"name": "life_diff", "features": ["life_diff"], "hidden": ()},
    {"name": "full", "features": None, "hidden": ()},
    {"name": "mlp", "features": None, "hidden": MLP_HIDDEN},
]


# ---------------------------------------------------------------------------
# Metrics.


def ece_equal_mass(y, p, bins=15):
    """Expected calibration error over `bins` equal-COUNT bins of p.

    Rows are sorted by predicted probability and split into equal-size
    slices; ECE is the count-weighted mean |mean_pred - frac_won|. This is
    the frozen 15-bin protocol (evalproto.ECE_BINS) applied to a probability
    head rather than a top-label confidence.
    """
    y = np.asarray(y, dtype=np.float64)
    p = np.asarray(p, dtype=np.float64)
    n = len(p)
    if n == 0:
        return float("nan")
    order = np.argsort(p, kind="stable")
    y, p = y[order], p[order]
    edges = np.linspace(0, n, bins + 1).astype(int)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        if hi <= lo:
            continue
        total += (hi - lo) * abs(y[lo:hi].mean() - p[lo:hi].mean())
    return float(total / n)


def evaluate(y, p):
    """Full metric block for one head on one row set."""
    y = np.asarray(y, dtype=np.float64)
    p = np.asarray(p, dtype=np.float64)
    return {
        "n": int(len(y)),
        "auc": round(roc_auc(y, p), 4),
        "log_loss": round(log_loss(y, p), 4),
        "brier": round(float(np.mean((p - y) ** 2)), 4),
        "ece": round(ece_equal_mass(y, p), 4),
        "base_rate": round(float(y.mean()), 4) if len(y) else None,
        "mean_pred": round(float(p.mean()), 4) if len(y) else None,
        "reliability": calibration(y, p, n_bins=10)["reliability"],
    }


def _bucket_masks(turn):
    """(label, boolean row mask) per turn bucket, in TURN_BUCKETS order."""
    turn = np.asarray(turn)
    lo = 0
    for label, hi in TURN_BUCKETS:
        upper = hi if hi is not None else int(turn.max())
        yield label, (turn > lo) & (turn <= upper)
        lo = upper


def evaluate_by_bucket(y, p, turn):
    """Pooled + per-turn-bucket metric blocks."""
    out = {"pooled": evaluate(y, p)}
    for label, mask in _bucket_masks(turn):
        if mask.any():
            out[label] = evaluate(y[mask], p[mask])
    return out


def nonlinearity_gap(full_eval, mlp_eval):
    """MLP-minus-logistic gap per bucket: where does non-linearity live?

    Positive auc_gain / log_loss_drop mean the MLP beat the linear ceiling on
    that bucket (AUC higher is better, log-loss lower is better).
    """
    gap = {}
    for bucket in full_eval:
        f, m = full_eval[bucket], mlp_eval.get(bucket)
        if m is None:
            continue
        gap[bucket] = {
            "n": m["n"],
            "auc_full": f["auc"], "auc_mlp": m["auc"],
            "auc_gain": round(m["auc"] - f["auc"], 4),
            "log_loss_full": f["log_loss"], "log_loss_mlp": m["log_loss"],
            "log_loss_drop": round(f["log_loss"] - m["log_loss"], 4),
        }
    return gap


# ---------------------------------------------------------------------------
# Training.


def _batches(n, batch_size, rng):
    order = rng.permutation(n)
    for start in range(0, n, batch_size):
        yield order[start:start + batch_size]


def train_head(Xs, y, columns, tr_idx, va_idx, hidden, epochs, batch_size,
               lr, seed, patience, progress, name):
    """Train one head on standardized rows; return (model, epochs_ran).

    Xs is the full standardized matrix; `columns` selects this head's inputs.
    Best-by-val-AUC state is restored before returning.
    """
    import torch

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    cols = np.asarray(columns)

    model = WinProbNet(len(cols), hidden=hidden)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    X_tr = np.ascontiguousarray(Xs[tr_idx][:, cols])
    y_tr = y[tr_idx]
    y_va = y[va_idx]

    best = {"auc": -1.0, "epoch": 0}
    best_state, stale, epoch = None, 0, 0
    for epoch in range(1, epochs + 1):
        model.train()
        for order in _batches(len(tr_idx), batch_size, rng):
            if len(order) < 2:
                continue
            x = torch.from_numpy(np.ascontiguousarray(X_tr[order]))
            target = torch.from_numpy(y_tr[order])
            optimizer.zero_grad()
            loss = torch.nn.functional.binary_cross_entropy_with_logits(
                model(x), target)
            loss.backward()
            optimizer.step()

        p_va = predict_proba(model, Xs[va_idx], cols)
        auc = roc_auc(y_va, p_va)
        progress(f"  [{name}] epoch {epoch}: val auc {auc:.4f} "
                 f"log_loss {log_loss(y_va, p_va):.4f}")
        if auc > best["auc"]:
            best = {"auc": auc, "epoch": epoch}
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            stale = 0
        else:
            stale += 1
            if stale >= patience:
                progress(f"  [{name}] early stop after epoch {epoch}")
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    return model, best["epoch"], epoch


def train(set_code, limited_type, epochs=8, batch_size=8192, lr=1e-3,
          seed=17, patience=2, val_permille=VAL_PERMILLE, subsample=3_000_000,
          progress=print):
    """Train all three heads; return (models, report, context)."""
    rng = np.random.default_rng(seed)

    data = wdata.load_dataset(set_code, limited_type)
    anchors = wdata.state_anchors(data)
    expected = EXPECTED_ANCHORS.get((set_code, limited_type))
    if expected:
        wdata.verify_anchors(anchors, expected)
        progress(f"anchors reproduce: mean_turns {anchors['mean_turns']:.3f}, "
                 f"ahead {anchors['ahead']['win_rate']:.3f}, "
                 f"behind {anchors['behind']['win_rate']:.3f}")

    game_train, game_val = split_by_draft(data.game_draft_id, val_permille)
    train_mask = game_train[data.game_pos]
    val_mask = game_val[data.game_pos]
    tr_idx = np.flatnonzero(train_mask)
    va_idx = np.flatnonzero(val_mask)
    if subsample and subsample < len(tr_idx):
        tr_idx = np.sort(rng.choice(tr_idx, size=subsample, replace=False))
    progress(f"rows: {data.n_rows:,} over {data.n_games:,} games | "
             f"train {len(tr_idx):,} / val {len(va_idx):,} | "
             f"features {len(wdata.FEATURES)}")

    mean, std = wdata.fit_scaler(data.X, tr_idx)
    Xs = wdata.standardize(data.X, mean, std)
    y = data.won
    turn_va = data.turn[va_idx]
    y_va = y[va_idx]

    models, evals, context_models = {}, {}, {}
    for spec in MODEL_SPECS:
        names = spec["features"] or wdata.FEATURES
        columns = [wdata.FEATURES.index(f) for f in names]
        progress(f"training '{spec['name']}' "
                 f"({len(columns)} feats, hidden={spec['hidden']})")
        model, best_epoch, epochs_ran = train_head(
            Xs, y, columns, tr_idx, va_idx, spec["hidden"], epochs,
            batch_size, lr, seed, patience, progress, spec["name"])
        p_va = predict_proba(model, Xs[va_idx], columns)
        models[spec["name"]] = model
        evals[spec["name"]] = evaluate_by_bucket(y_va, p_va, turn_va)
        context_models[spec["name"]] = {
            "features": names, "columns": columns, "hidden": list(spec["hidden"]),
            "best_epoch": best_epoch, "epochs_ran": epochs_ran,
            "n_params": sum(p.numel() for p in model.parameters()),
        }

    report = {
        "n_rows": data.n_rows,
        "n_games": data.n_games,
        "n_train": len(tr_idx),
        "n_val": len(va_idx),
        "anchors": anchors,
        "expected_anchors": expected,
        "models": evals,
        "nonlinearity_gap": nonlinearity_gap(evals["full"], evals["mlp"]),
    }
    context = {
        "set": set_code, "format": limited_type, "kind": "winprob-v1",
        "features": wdata.FEATURES,
        "models": context_models,
        "scaler_mean": mean.tolist(), "scaler_std": std.tolist(),
        "wr_fill": data.wr_fill,
        "seed": seed, "epochs": epochs, "batch_size": batch_size, "lr": lr,
        "val_permille": val_permille, "subsample": subsample,
    }
    # Handles for downstream economics (not persisted here).
    context["_scaler"] = (mean, std)
    context["_val_idx"] = va_idx
    context["_data"] = data
    return models, report, context


# ---------------------------------------------------------------------------
# Persistence.


def save_version(models, report, context, tag=None):
    """Persist all three checkpoints + meta.json + metrics.json."""
    import torch

    set_code, limited_type = context["set"], context["format"]
    tag = tag or f"v1-{set_code.lower()}"
    out_dir = paths_models_dir() / MODEL_FAMILY / tag
    out_dir.mkdir(parents=True, exist_ok=True)

    for name, model in models.items():
        cm = context["models"][name]
        torch.save(
            {"model": model.state_dict(),
             "config": {"kind": context["kind"], "head": name,
                        "features": cm["features"], "columns": cm["columns"],
                        "hidden": cm["hidden"], "input_dim": len(cm["columns"]),
                        "scaler_mean": context["scaler_mean"],
                        "scaler_std": context["scaler_std"],
                        "wr_fill": context["wr_fill"]}},
            out_dir / f"checkpoint_{name}.pt")

    meta = {
        "model_id": f"{MODEL_FAMILY}/{tag}",
        "kind": context["kind"],
        "features": context["features"],
        "heads": {name: {"features": cm["features"], "hidden": cm["hidden"],
                         "n_params": cm["n_params"], "best_epoch": cm["best_epoch"]}
                  for name, cm in context["models"].items()},
        "scaler_mean": context["scaler_mean"],
        "scaler_std": context["scaler_std"],
        "wr_fill": context["wr_fill"],
        "train": {k: context[k] for k in
                  ["seed", "epochs", "batch_size", "lr", "val_permille",
                   "subsample"]},
        "data_etag": _data_etag(set_code, limited_type),
        "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "torch_version": torch.__version__,
        "caveats": [
            "one-sided partial observation: opponent hand/deck are unknown",
            "17Lands users win ~54% of games (skill selection); V is centered "
            "on that population, not 50%",
            "Bo1 hand smoothing shapes opening states",
            "economics gradients are associational along the data manifold, "
            "not causal interventions (see economics.py)",
        ],
    }
    with open(out_dir / "meta.json", "w") as fh:
        json.dump(meta, fh, indent=2)
    with open(out_dir / "metrics.json", "w") as fh:
        json.dump(_json_report(report), fh, indent=2)
    return out_dir


def paths_models_dir():
    from mtga.lands import paths
    return paths.MODELS_DIR


def _data_etag(set_code, limited_type):
    from mtga.lands import paths
    meta = paths.meta_path(paths.replay_turns_path(set_code, limited_type))
    if meta.exists():
        with open(meta) as fh:
            return json.load(fh).get("source_etag")
    return None


def _json_report(report):
    """Report without the private handles (leading-underscore keys)."""
    return {k: v for k, v in report.items() if not k.startswith("_")}


def ledger_run(report, context, out_dir, economics=None):
    """Append the run record to the experiment ledger; returns the record."""
    mlp = report["models"]["mlp"]["pooled"]
    full = report["models"]["full"]["pooled"]
    base = report["models"]["life_diff"]["pooled"]
    metrics = {
        "auc_life_diff": base["auc"], "auc_full": full["auc"],
        "auc_mlp": mlp["auc"],
        "log_loss_life_diff": base["log_loss"],
        "log_loss_full": full["log_loss"], "log_loss_mlp": mlp["log_loss"],
        "ece_mlp": mlp["ece"], "n_train": report["n_train"],
        "n_val": report["n_val"],
    }
    if economics is not None:
        metrics["card_life_equiv_typical"] = economics.get("headline", {}).get(
            "life_per_card")
    record = {
        "run_id": runlog.new_run_id(
            f"winprob_{context['set'].lower()}_{context['format'].lower()}"),
        "kind": context["kind"],
        "config": {k: v for k, v in context.items() if not k.startswith("_")},
        "metrics": metrics,
        "anchors": report["anchors"],
        "artifacts": {
            "dir": str(out_dir),
            "checkpoint_mlp_sha256": runlog.file_sha256(
                out_dir / "checkpoint_mlp.pt"),
        },
    }
    return runlog.append(record)
