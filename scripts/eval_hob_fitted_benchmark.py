#!/usr/bin/env python
"""Five-fold out-of-fold HOB-only P1P1 choice model; no forecast refitting.

Recipe: docs/hob_postrelease_benchmark_protocol_20260920.md.
Run in .venv-embed, which contains scipy and pandas.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zlib

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import logsumexp

try:
    from scripts import eval_hob_forecast as ev
except ModuleNotFoundError:
    import eval_hob_forecast as ev


def fold_for(draft_id):
    return zlib.crc32(draft_id.encode()) % 5


def id_hash(ids):
    return hashlib.sha256(("\n".join(sorted(ids)) + "\n").encode()).hexdigest()


def choice_loss_and_gradient(weights, offered, picked):
    """Sum masked negative log likelihood + fixed unit ridge penalty."""
    masked = np.where(offered, weights[None, :], -np.inf)
    logz = logsumexp(masked, axis=1)
    probabilities = np.exp(masked - logz[:, None])
    nll = np.sum(logz - weights[picked])
    gradient = (
        probabilities.sum(axis=0)
        - np.bincount(picked, minlength=len(weights))
        + weights
    )
    return float(nll + 0.5 * np.dot(weights, weights)), gradient


def fit_weights(offered, picked):
    if not len(picked) or not offered[np.arange(len(picked)), picked].all():
        raise ValueError("empty training set or picked card absent from pack")
    result = minimize(
        choice_loss_and_gradient,
        np.zeros(offered.shape[1]),
        args=(offered, picked),
        jac=True,
        method="L-BFGS-B",
        options={"maxiter": 500, "ftol": 1e-12, "gtol": 1e-6},
    )
    if not result.success or not np.isfinite(result.x).all():
        raise RuntimeError(f"optimizer did not converge: {result.message}")
    return result


def crossfit(offered, picked, draft_ids, expert, eligible):
    """Each fold's predictions are generated with all its drafts excluded."""
    draft_ids = np.asarray(draft_ids)
    if len(set(draft_ids)) != len(draft_ids):
        raise ValueError("duplicate draft IDs violate one-P1P1-per-draft contract")
    folds = np.array([fold_for(d) for d in draft_ids])
    output = (
        np.zeros(len(picked), bool),
        np.zeros(len(picked)),
        np.zeros(len(picked)),
        np.zeros(len(picked), int),
    )
    reports, fitted = [], []
    for fold in range(5):
        train = (folds != fold) & expert & eligible
        test = folds == fold
        if np.any(train & test):
            raise AssertionError("training and test drafts overlap")
        fit = fit_weights(offered[train], picked[train])
        predicted = ev.evaluate_pack_scores(offered[test], picked[test], fit.x)
        for target, values in zip(output, predicted):
            target[test] = values
        train_predictions = ev.evaluate_pack_scores(
            offered[train], picked[train], fit.x
        )
        report = {
            "fold": fold,
            "training_expert_drafts": int(train.sum()),
            "heldout_drafts": int(test.sum()),
            "heldout_expert_drafts": int((test & expert & eligible).sum()),
            "training_ids_sha256": id_hash(draft_ids[train]),
            "heldout_ids_sha256": id_hash(draft_ids[test]),
            "training_agreement": float(train_predictions[1].mean()),
            "iterations": int(fit.nit),
            "objective": float(fit.fun),
            "gradient_max_abs": float(np.abs(fit.jac).max()),
            "converged": bool(fit.success),
            "optimizer_message": str(fit.message),
        }
        reports.append(report)
        fitted.append(fit.x)
        print(
            f"fold {fold}: {train.sum()} training expert drafts; "
            f"{(test & expert & eligible).sum()} held-out experts; "
            f"converged in {fit.nit} iterations",
            flush=True,
        )
    return output, folds, reports, fitted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["forecast", "grades", "drafts", "protocol", "out-dir"]:
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    inputs = {
        key: {"path": str(path), "sha256": ev.sha256(path)}
        for key in ["forecast", "grades", "drafts", "protocol"]
        if (path := getattr(args, key)) is not None
    }
    snapshot = json.loads(Path(str(args.drafts) + ".meta.json").read_text())
    if snapshot["sha256"] != inputs["drafts"]["sha256"]:
        raise ValueError("draft snapshot changed")
    inputs["drafts"]["download"] = snapshot
    sources, aliases, _ = ev.load_forecasts(args.forecast, args.grades, None)
    picks, raw_rows = ev.load_picks(args.drafts)
    names, offered, picked = ev.pack_arrays(picks, aliases)
    masks = ev.population_masks(picks)
    results = {
        src: ev.evaluate_pack_scores(
            offered, picked, np.array([values.get(n, np.nan) for n in names])
        )
        for src, values in sources.items()
    }
    learned, folds, reports, fitted = crossfit(
        offered, picked, picks.draft_id, masks["expert"], results["draftfm"][0]
    )
    broad = [s for s in sources if s != "limited_resources"]
    common = learned[0] & np.logical_and.reduce([results[s][0] for s in broad])
    comparisons, populations = [], {}
    random = np.divide(
        1.0,
        offered.sum(axis=1),
        out=np.zeros(len(picks)),
        where=offered.sum(axis=1) > 0,
    )
    for label, mask in masks.items():
        keep = mask & common
        scores = learned[1][keep]
        populations[label] = {
            "shared_drafts": int(keep.sum()),
            "hob_fitted_accuracy": float(scores.mean()),
            "random_accuracy": float(random[keep].mean()),
            "hob_fitted_inclusive_accuracy": float(learned[2][keep].mean()),
        }
        for source in broad:
            other = results[source][1][keep]
            delta = scores - other
            lo, hi = ev.paired_interval(delta)
            comparisons.append(
                {
                    "population": label,
                    "source": source,
                    "shared_drafts": int(keep.sum()),
                    "hob_fitted_accuracy": float(scores.mean()),
                    "source_accuracy": float(other.mean()),
                    "hob_fitted_minus_source": float(delta.mean()),
                    "delta_ci_low": lo,
                    "delta_ci_high": hi,
                }
            )
    display = {
        norm: n
        for n in pd.read_csv(args.forecast).name
        for norm in [ev.norm_17lands(n)]
    }
    for fold, weights in enumerate(fitted):
        pd.DataFrame({"name": [display[n] for n in names], "score": weights}).to_csv(
            args.out_dir / f"fold_{fold}_weights.csv", index=False
        )
    pd.DataFrame(comparisons).to_csv(args.out_dir / "comparisons.csv", index=False)
    predictions = pd.DataFrame(
        {
            "draft_id": picks.draft_id,
            "fold": folds,
            "expert": masks["expert"],
            "shared_eligible": common,
            "hob_fitted_credit": learned[1],
            "hob_fitted_inclusive_credit": learned[2],
        }
    )
    predictions.to_parquet(
        args.out_dir / "out_of_fold_predictions.parquet", index=False
    )
    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "software": ev.software_versions(),
        "kind": "post-release expert-trained card-identity conditional logit",
        "inputs": inputs,
        "script_sha256": ev.sha256(Path(__file__)),
        "evaluation_script_sha256": ev.sha256(Path(ev.__file__)),
        "recipe": {
            "folds": 5,
            "assignment": "crc32(draft_id) % 5",
            "ridge": 1.0,
            "objective": "sum NLL + 0.5 * sum(weights**2)",
            "fit_population": "expert P1P1",
            "initial_weights": 0,
            "optimizer": "L-BFGS-B",
            "maxiter": 500,
            "ftol": 1e-12,
            "gtol": 1e-6,
        },
        "raw_pick_rows": raw_rows,
        "p1p1_drafts": len(picks),
        "n_parameters": len(names),
        "folds": reports,
        "populations": populations,
        "comparisons": comparisons,
        "bootstrap": {
            "replicates": 2000,
            "seed": 17,
            "unit": "draft",
            "includes_training_variance": False,
        },
        "attribution": "Data from 17Lands.com (CC BY 4.0)",
        "outputs": {
            p.name: ev.sha256(p)
            for p in sorted(args.out_dir.iterdir())
            if p.suffix in {".csv", ".parquet"}
        },
    }
    (args.out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, allow_nan=False) + "\n"
    )
    print(pd.DataFrame(comparisons).to_string(index=False))


if __name__ == "__main__":
    main()
