#!/usr/bin/env python
"""Rebuild development evaluation rail: DraftFM widths on BRO, FDN, and MSH.

Protocol: docs/eval_protocol_rebuild.md (tag eval-protocol-rebuild-v1).

In this rebuild BRO, FDN, and MSH are ordinary whole-set development
environments — a set code is a filter argument and nothing else. The v0.1
frozen-MSH rail (scripts/run_frozen_eval.py, scripts/eval_draftfm.py,
docs/eval_protocol.md) describes a different experiment and is preserved
untouched; nothing here builds on it.

Two phases, because analysis must never need a GPU:

  predict   one inference pass per (model, set, format) -> prediction parquet
  report    every table, curve, and plot derived from those cached parquets
  sanity    harness self-check against training-time validation on the 29
            training sets — no development set is touched

Metric definitions, the expert slice, ECE binning, and the per-position curve
are reused from mtga/foundation/evalproto.py (the v0.1 metric library, which
carries no set-specific behavior). Only the cluster-bootstrap kernel is
re-implemented, because the reference one materializes a resampled DataFrame
per iteration and cannot run at 12.6M picks; `sanity` and `report` both assert
the fast kernel agrees with the reference before reporting anything.
"""

import argparse
import json
import platform
import time
from pathlib import Path

import numpy as np
import pandas as pd

from mtga.foundation import evalproto, runlog
from mtga.lands import paths

PROTOCOL_TAG = "eval-protocol-rebuild-v1"
DEV_SETS = ("BRO", "FDN", "MSH")
EXPECTED_MANIFEST_SHA = (
    "c3eb9af4f3bea0f4b695cde9788f98563f9b1a59674448e58110e513de0067ee"
)
BOOTSTRAP_B = 1000
BOOTSTRAP_SEED = 20260809
BATCH = 8192
FORMAT_ORDER = ("PremierDraft", "TradDraft", "QuickDraft")
PROB_FLOOR = 1e-12

# dataviz reference palette, categorical slots 1-3 (light mode). Validated
# all-pairs: worst CVD dE 9.2, worst normal-vision dE 24.0. Slot 3 sits below
# 3:1 on the light surface, so the plot ships direct labels and a CSV table.
SERIES_COLORS = ("#2a78d6", "#eb6834", "#1baf7a")
SURFACE = "#fcfcfb"
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_GRID = "#dcdbd6"


# -- paths -------------------------------------------------------------------


def eval_root():
    return paths.DATA_ROOT / "eval_rebuild"


def default_preds_dir():
    return eval_root() / "preds"


def default_reports_dir():
    return eval_root() / "reports"


def shard_path(set_code, limited_type):
    return paths.DATA_ROOT / "foundation" / "shards" / f"{set_code}.{limited_type}"


def available_formats(set_code):
    """Formats with a built shard, PremierDraft first."""
    root = paths.DATA_ROOT / "foundation" / "shards"
    found = [
        d.name.split(".", 1)[1]
        for d in sorted(root.glob(f"{set_code}.*"))
        if (d / "meta.json").exists()
    ]
    rank = {name: i for i, name in enumerate(FORMAT_ORDER)}
    return sorted(found, key=lambda f: (rank.get(f, len(rank)), f))


# -- integrity gates ---------------------------------------------------------


def manifest_content_hash():
    return json.loads(paths.FEATURIZER_MANIFEST.read_text()).get("content_hash")


def resolve_manifest_sha(expected):
    """On-disk featurizer manifest hash, pinned against `expected`."""
    on_disk = manifest_content_hash()
    if expected and on_disk != expected:
        raise SystemExit(
            f"featurizer manifest content_hash {on_disk} != expected {expected}; "
            f"the feature space drifted — refusing to evaluate"
        )
    return on_disk


def verify_run(run_dir, manifest_sha):
    """Load a run record, refusing on manifest or checkpoint-hash drift."""
    run_dir = Path(run_dir)
    record = json.loads((run_dir / "record.json").read_text())
    problems = []
    if record.get("featurizer_manifest_sha") != manifest_sha:
        problems.append(
            f"record featurizer_manifest_sha "
            f"{record.get('featurizer_manifest_sha')} != {manifest_sha}"
        )
    checkpoint = run_dir / "best.pt"
    if not checkpoint.exists():
        problems.append(f"missing checkpoint {checkpoint}")
        actual = None
    else:
        actual = runlog.file_sha256(checkpoint)
        recorded = (record.get("artifacts") or {}).get("best_sha256")
        if recorded and recorded != actual:
            problems.append(f"best.pt sha256 {actual} != recorded {recorded}")
    if problems:
        raise SystemExit(f"{run_dir.name}: " + "; ".join(problems))
    return record, actual


def model_id(record):
    return f"d{record['config']['d_model']}"


# -- model + shard plumbing (the training/serving forward path) --------------


def load_model(run_dir, manifest_sha, device):
    import torch

    from mtga.foundation.model import DraftFM

    checkpoint = torch.load(
        Path(run_dir) / "best.pt", map_location="cpu", weights_only=False
    )
    if checkpoint.get("featurizer_manifest_sha") != manifest_sha:
        raise SystemExit(
            f"{Path(run_dir).name}: checkpoint featurizer_manifest_sha "
            f"{checkpoint.get('featurizer_manifest_sha')} != {manifest_sha}"
        )
    config = checkpoint["config"]
    feat_dim = checkpoint["model"]["card_encoder.net.0.weight"].shape[0]
    model = DraftFM(feat_dim, config["d_model"], config["dropout"], config["set_ctx"])
    model.load_state_dict(checkpoint["model"])
    return model.to(device).eval(), checkpoint, feat_dim


def prepare_shard(set_code, limited_type, feat_dim):
    """Shard view carrying the feature table the model expects.

    Mirrors mtga/foundation/predict.py's width contract: the only tolerated
    mismatch is a structured-only model scored on a structured+text table.
    """
    import torch

    from mtga.foundation.dataset import Shard
    from mtga.foundation.predict import TEXT_EMB_DIM

    assets = np.load(shard_path(set_code, limited_type) / "features.npz")
    matrix = assets["features"].astype(np.float32)
    if matrix.shape[1] != feat_dim:
        if matrix.shape[1] - feat_dim == TEXT_EMB_DIM:
            matrix = matrix[:, :feat_dim]
        else:
            raise SystemExit(
                f"{set_code}.{limited_type}: feature width {matrix.shape[1]} != "
                f"model width {feat_dim} and the delta is not the "
                f"{TEXT_EMB_DIM}-d text block — the shard was featurized "
                f"through a different manifest than the model trained on"
            )
    shard = Shard(set_code, limited_type, torch.from_numpy(matrix))
    shard.rarity_ids = torch.from_numpy(assets["rarity_ids"].astype(np.int64))
    shard.set_scalars = torch.tensor(
        [
            shard.meta["vocab_size"] / 400.0,
            float(shard.meta.get("picks_per_pack") == 13),
            float(shard.meta.get("picks_per_pack") == 14),
            float(shard.meta.get("picks_per_pack") == 15),
        ]
    )
    return shard


def derive_draft_ids(shard):
    """Draft key per row (protocol section 4).

    Shard rows keep the curated scan order: a draft's picks are contiguous and
    strictly increasing in (pack, pick). A boundary is declared when that
    ordering breaks, or when the stored crc32(draft_id) % 1000 changes — the
    second rule catches boundaries the first misses across a truncated draft.
    Neither rule can split one draft in two.
    """
    context = np.asarray(shard.context)
    split = np.asarray(shard.split).astype(np.int32)
    key = context[:, 0].astype(np.int32) * 256 + context[:, 1].astype(np.int32)
    boundary = np.empty(len(key), dtype=bool)
    boundary[0] = True
    boundary[1:] = (key[1:] <= key[:-1]) | (split[1:] != split[:-1])
    return (np.cumsum(boundary) - 1).astype(np.int32)


def skill_columns(context):
    """Shard ordinal ids -> the evalproto slice columns.

    wr_bucket = wr_id / 50 (id 255 means unknown -> NaN, excluded by the
    expert slice); n_games_bucket is the bucket's game count (unknown -> 0,
    likewise excluded).
    """
    from mtga.foundation.dataset import GAMES_BUCKETS

    wr_id = context[:, 2]
    wr = np.where(wr_id == 255, np.nan, wr_id / 50.0).astype(np.float32)
    lookup = np.zeros(256, dtype=np.int16)
    for index, games in enumerate(GAMES_BUCKETS):
        lookup[index] = games
    return wr, lookup[context[:, 3]]


def score_rows(model, shard, device, rows=None, batch_size=BATCH, progress=0):
    """One inference pass -> the prediction-parquet frame plus diagnostics."""
    import torch

    from mtga.foundation.train import make_batch

    total = shard.meta["rows"]
    rows = np.arange(total) if rows is None else np.asarray(rows)
    n = len(rows)
    ranks = np.empty(n, dtype=np.int8)
    pick_probs = np.empty(n, dtype=np.float32)
    top_probs = np.empty(n, dtype=np.float32)
    sizes = np.empty(n, dtype=np.int8)
    argmax_hits = np.empty(n, dtype=bool)

    started = time.time()
    with torch.no_grad():
        table, summary = model.encode_set(
            shard.features.to(device), shard.rarity_ids.to(device)
        )
        for start in range(0, n, batch_size):
            stop = min(start + batch_size, n)
            batch = make_batch(shard, rows[start:stop], device)
            logits = model(table, summary, batch)
            target = batch["pick_pos"]
            target_logit = logits.gather(1, target.unsqueeze(1))
            # Rank, not argmax: a tie with the human's card counts as
            # agreement. The two differ only on exact float ties, and the
            # disagreement count is reported as a diagnostic.
            rank = (logits > target_logit).sum(dim=1) + 1
            probs = torch.softmax(logits, dim=1)
            ranks[start:stop] = rank.cpu().numpy().astype(np.int8)
            pick_probs[start:stop] = (
                probs.gather(1, target.unsqueeze(1)).squeeze(1).cpu().numpy()
            )
            top_probs[start:stop] = probs.max(dim=1).values.cpu().numpy()
            sizes[start:stop] = (
                torch.isfinite(logits).sum(dim=1).cpu().numpy().astype(np.int8)
            )
            argmax_hits[start:stop] = (logits.argmax(1) == target).cpu().numpy()
            if progress and (start // batch_size) % progress == 0:
                rate = stop / max(time.time() - started, 1e-9)
                print(
                    f"    {stop:,}/{n:,} picks ({rate:,.0f}/s)",
                    flush=True,
                )
    elapsed = time.time() - started

    context = np.asarray(shard.context)[rows]
    wr, games = skill_columns(context)
    frame = pd.DataFrame(
        {
            "draft_id": derive_draft_ids(shard)[rows],
            "pack_number": context[:, 0].astype(np.int8),
            "pick_number": context[:, 1].astype(np.int8),
            "n_options": sizes,
            "pack_size": sizes,
            "target_rank": ranks,
            "top1": ranks == 1,
            "top3": ranks <= 3,
            "pick_prob": pick_probs,
            "top_prob": top_probs,
            "log_loss": -np.log(np.clip(pick_probs, PROB_FLOOR, 1.0)).astype(
                np.float32
            ),
            "wr_bucket": wr,
            "n_games_bucket": games.astype(np.int16),
        }
    )
    diagnostics = {
        "picks": int(n),
        "drafts": int(pd.unique(frame["draft_id"]).size),
        "elapsed_s": round(elapsed, 2),
        "picks_per_s": round(n / max(elapsed, 1e-9)),
        # Training-time validation counts argmax equality; this rail counts
        # rank == 1. Both are kept so the sanity gate can compare them.
        "argmax_correct": int(argmax_hits.sum()),
        "argmax_rank_disagreements": int((argmax_hits != (ranks == 1)).sum()),
        "picks_per_pack": shard.meta.get("picks_per_pack"),
        "vocab_size": shard.meta.get("vocab_size"),
        "forced_picks": int((sizes == 1).sum()),
    }
    return frame, diagnostics


# -- cluster bootstrap -------------------------------------------------------


def bootstrap_values(frame):
    """The three bootstrapped statistics, defined exactly as evalproto does."""
    rank = frame["target_rank"].to_numpy()
    prob = frame["pick_prob"].to_numpy(dtype=np.float64)
    return {
        "top1": (rank == 1).astype(np.float64),
        "top3": (rank <= 3).astype(np.float64),
        "log_loss": -np.log(np.clip(prob, PROB_FLOOR, 1.0)),
    }


def cluster_bootstrap_means(frame, b=BOOTSTRAP_B, seed=BOOTSTRAP_SEED):
    """Percentile cluster bootstrap over drafts for mean-type statistics.

    Algebraically identical to evalproto.cluster_bootstrap: every statistic
    here is a mean over picks, so a resample's value is
    sum(per-draft sums) / sum(per-draft counts) over the drawn drafts. Group
    order (first appearance) and the per-iteration draw match the reference,
    so the two agree to floating-point tolerance — asserted by
    selftest_bootstrap. Returns point, CI, and the replicate array (the
    replicates let the three-set mean carry a CI too).
    """
    values = bootstrap_values(frame)
    codes, uniques = pd.factorize(frame["draft_id"], sort=False)
    n = len(uniques)
    if n == 0:
        empty = np.full(b, np.nan)
        return {
            k: {
                "point": float("nan"),
                "lo": float("nan"),
                "hi": float("nan"),
                "reps": empty,
            }
            for k in values
        }
    counts = np.bincount(codes, minlength=n).astype(np.float64)
    sums = {k: np.bincount(codes, weights=v, minlength=n) for k, v in values.items()}
    rng = np.random.default_rng(seed)
    reps = {k: np.empty(b) for k in values}
    for i in range(b):
        chosen = rng.integers(0, n, size=n)
        denominator = counts[chosen].sum()
        for key in values:
            reps[key][i] = sums[key][chosen].sum() / denominator
    result = {}
    for key, series in values.items():
        low, high = np.percentile(reps[key], [2.5, 97.5])
        result[key] = {
            "point": float(series.mean()),
            "lo": float(low),
            "hi": float(high),
            "reps": reps[key],
        }
    return result


def cluster_bootstrap_ece(frame, b=BOOTSTRAP_B, seed=BOOTSTRAP_SEED, bins=None):
    """Cluster bootstrap CI for top-label ECE, on the same by-draft resamples.

    ECE is not a mean over picks, so the sums/counts kernel above does not
    apply. Two facts make it affordable anyway.

    First, evalproto's binned ECE collapses to a difference of sums: a bin
    contributes ``(n_bin/N) * |mean(correct) - mean(confidence)|``, which is
    ``|sum(correct) - sum(confidence)| / N``. So only the per-(draft, bin) sum
    of ``correct - confidence`` and the per-draft pick count are needed, and a
    resample is a matrix-vector product against the draft multiplicities.

    Second, the bin EDGES are held at the full-sample equal-mass edges rather
    than recomputed per resample. That is the documented approximation here:
    it isolates sampling variability in the bin statistics instead of also
    jittering the boundaries. selftest_bootstrap measures the resulting CI
    discrepancy against the literal evalproto estimator on a subsample.

    Draws are regenerated from the same seed and the same draft count, so they
    are the identical resamples the mean statistics use.
    """
    bins = bins or evalproto.ECE_BINS
    confidence = frame["top_prob"].to_numpy(dtype=np.float64)
    correct = (frame["target_rank"].to_numpy() == 1).astype(np.float64)
    codes, uniques = pd.factorize(frame["draft_id"], sort=False)
    n = len(uniques)
    total = len(frame)
    if n == 0 or total == 0:
        return {
            "point": float("nan"),
            "lo": float("nan"),
            "hi": float("nan"),
            "reps": np.full(b, np.nan),
        }

    # Full-sample equal-mass bin assignment, matching evalproto.ece exactly.
    order = np.argsort(confidence, kind="stable")
    edges = np.linspace(0, total, bins + 1).astype(int)
    bin_of_position = np.repeat(np.arange(bins), np.diff(edges))
    bin_id = np.empty(total, dtype=np.int64)
    bin_id[order] = bin_of_position

    flat = codes.astype(np.int64) * bins + bin_id
    deltas = np.bincount(
        flat, weights=correct - confidence, minlength=n * bins
    ).reshape(n, bins)
    per_draft = np.bincount(codes, minlength=n).astype(np.float64)

    point = float(np.abs(deltas.sum(axis=0)).sum() / total)
    rng = np.random.default_rng(seed)
    reps = np.empty(b)
    for i in range(b):
        chosen = rng.integers(0, n, size=n)
        multiplicity = np.bincount(chosen, minlength=n).astype(np.float64)
        reps[i] = np.abs(multiplicity @ deltas).sum() / (multiplicity @ per_draft)
    low, high = np.percentile(reps, [2.5, 97.5])
    return {"point": point, "lo": float(low), "hi": float(high), "reps": reps}


def selftest_bootstrap(frame, b=100, seed=BOOTSTRAP_SEED, tol=1e-9, ece_tol=2e-3):
    """Assert the fast kernel reproduces evalproto.cluster_bootstrap."""
    fast = cluster_bootstrap_means(frame, b=b, seed=seed)
    reference = {
        "top1": evalproto.cluster_bootstrap(frame, evalproto.top1, b=b, seed=seed),
        "top3": evalproto.cluster_bootstrap(
            frame, lambda f: evalproto.topk(f, 3), b=b, seed=seed
        ),
        "log_loss": evalproto.cluster_bootstrap(
            frame, evalproto.log_loss, b=b, seed=seed
        ),
    }
    report = {}
    for key, (point, low, high) in reference.items():
        got = fast[key]
        deltas = [
            abs(point - got["point"]),
            abs(low - got["lo"]),
            abs(high - got["hi"]),
        ]
        report[key] = {"reference": [point, low, high], "max_abs_delta": max(deltas)}
        if max(deltas) > tol:
            raise SystemExit(
                f"bootstrap self-test FAILED for {key}: reference "
                f"{(point, low, high)} vs fast "
                f"{(got['point'], got['lo'], got['hi'])}"
            )

    # ECE: the fixed-edge kernel is an approximation of the literal estimator,
    # so this check reports the discrepancy rather than demanding zero.
    reference_ece = evalproto.cluster_bootstrap(frame, evalproto.ece, b=b, seed=seed)
    fast_ece = cluster_bootstrap_ece(frame, b=b, seed=seed)
    point, low, high = reference_ece
    deltas = {
        "point": abs(point - fast_ece["point"]),
        "lo": abs(low - fast_ece["lo"]),
        "hi": abs(high - fast_ece["hi"]),
    }
    report["ece"] = {
        "reference": [point, low, high],
        "fast": [fast_ece["point"], fast_ece["lo"], fast_ece["hi"]],
        "max_abs_delta": max(deltas.values()),
        "tolerance": ece_tol,
        "note": "fixed full-sample equal-mass bin edges across resamples",
    }
    if deltas["point"] > tol:
        raise SystemExit(
            f"ECE point estimate FAILED: reference {point} vs fast "
            f"{fast_ece['point']} (must match evalproto.ece exactly)"
        )
    if max(deltas.values()) > ece_tol:
        raise SystemExit(
            f"ECE bootstrap CI discrepancy {max(deltas.values()):.2e} exceeds "
            f"{ece_tol:.2e}: reference {reference_ece} vs fast "
            f"{(fast_ece['point'], fast_ece['lo'], fast_ece['hi'])}"
        )
    return report


# -- phase A: predict --------------------------------------------------------


def phase_predict(args):
    import torch

    manifest_sha = resolve_manifest_sha(args.expect_manifest)
    out_root = Path(args.out) if args.out else default_preds_dir()
    out_root.mkdir(parents=True, exist_ok=True)
    sets = [s.strip().upper() for s in args.sets.split(",") if s.strip()]
    device = args.device
    if device == "mps" and not torch.backends.mps.is_available():
        print("MPS unavailable — falling back to CPU", flush=True)
        device = "cpu"

    for run_dir in args.runs:
        record, checkpoint_sha = verify_run(run_dir, manifest_sha)
        tag = model_id(record)
        model, _, feat_dim = load_model(run_dir, manifest_sha, device)
        target = out_root / tag
        target.mkdir(parents=True, exist_ok=True)
        print(f"[{tag}] {record['run_id']} on {device}", flush=True)
        for set_code in sets:
            formats = (
                [f.strip() for f in args.formats.split(",")]
                if args.formats
                else available_formats(set_code)
            )
            for limited_type in formats:
                if not (shard_path(set_code, limited_type) / "meta.json").exists():
                    print(f"  skip {set_code}.{limited_type}: no shard", flush=True)
                    continue
                shard = prepare_shard(set_code, limited_type, feat_dim)
                rows = None
                if args.limit:
                    rows = np.arange(min(args.limit, shard.meta["rows"]))
                frame, diagnostics = score_rows(
                    model,
                    shard,
                    device,
                    rows=rows,
                    batch_size=args.batch_size,
                    progress=args.progress,
                )
                path = target / f"{set_code}.{limited_type}.parquet"
                frame.to_parquet(path, index=False)
                diagnostics.update(
                    {
                        "protocol": PROTOCOL_TAG,
                        "model_id": tag,
                        "run_id": record["run_id"],
                        "run_dir": str(Path(run_dir).resolve()),
                        "set": set_code,
                        "format": limited_type,
                        "d_model": record["config"]["d_model"],
                        "n_params": record.get("n_params"),
                        "train_wall_clock_s": record.get("wall_clock_s"),
                        "train_examples_per_s": record.get("examples_per_s"),
                        "best_val_top1": record.get("best_val_top1"),
                        "checkpoint_sha256": checkpoint_sha,
                        "featurizer_manifest_sha": manifest_sha,
                        "device": device,
                        "torch_version": torch.__version__,
                        "git_sha": runlog.git_sha(),
                        "limit_rows": args.limit or None,
                        "parquet_sha256": runlog.file_sha256(path),
                    }
                )
                path.with_suffix(".json").write_text(
                    json.dumps(diagnostics, indent=2, default=str)
                )
                print(
                    f"  {set_code}.{limited_type}: {diagnostics['picks']:,} picks "
                    f"in {diagnostics['elapsed_s']:.1f}s "
                    f"({diagnostics['picks_per_s']:,}/s), "
                    f"top1 {frame['top1'].mean():.4f}",
                    flush=True,
                )
        del model
        if device == "mps":
            torch.mps.empty_cache()
    print(f"predictions cached under {out_root}")


# -- sanity gate -------------------------------------------------------------


def phase_sanity(args):
    """Reproduce training-time validation top-1 with the evaluation harness.

    Scores a seeded sample of the held-out validation rows of the 29 training
    sets — the same population and the same forward path the training loop's
    early-stopping signal uses. No development set is touched.
    """
    import torch

    manifest_sha = resolve_manifest_sha(args.expect_manifest)
    record, checkpoint_sha = verify_run(args.run, manifest_sha)
    device = args.device
    if device == "mps" and not torch.backends.mps.is_available():
        print("MPS unavailable — falling back to CPU", flush=True)
        device = "cpu"
    model, _, feat_dim = load_model(args.run, manifest_sha, device)

    import resource

    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if soft < 8192:
        resource.setrlimit(resource.RLIMIT_NOFILE, (min(8192, hard), hard))

    pairs = [tuple(p) for p in record["config"]["sets"]]
    rng = np.random.default_rng(args.seed)
    frames = []
    argmax_correct = argmax_total = 0
    elapsed = 0.0
    for set_code, limited_type in pairs:
        shard = prepare_shard(set_code, limited_type, feat_dim)
        if not len(shard.val_idx):
            continue
        take = min(args.per_shard, len(shard.val_idx))
        rows = np.sort(rng.choice(shard.val_idx, size=take, replace=False))
        frame, diagnostics = score_rows(
            model, shard, device, rows=rows, batch_size=args.batch_size
        )
        # Training-time signal is argmax equality; the harness reports rank==1.
        argmax_correct += diagnostics["argmax_correct"]
        argmax_total += len(frame)
        elapsed += diagnostics["elapsed_s"]
        frame["draft_id"] = (
            frame["draft_id"].to_numpy().astype(np.int64)
            + (len(frames) + 1) * 10_000_000
        )
        frames.append(frame)
        del shard

    combined = pd.concat(frames, ignore_index=True)
    harness_top1 = evalproto.top1(combined)
    expected = record.get("best_val_top1")
    sample = combined.iloc[: min(len(combined), 200_000)]
    selftest = selftest_bootstrap(sample, b=args.selftest_b)
    boot = cluster_bootstrap_means(combined, b=args.bootstrap)

    result = {
        "protocol": PROTOCOL_TAG,
        "run_id": record["run_id"],
        "model_id": model_id(record),
        "checkpoint_sha256": checkpoint_sha,
        "featurizer_manifest_sha": manifest_sha,
        "device": device,
        "n_shards": len(frames),
        "per_shard": args.per_shard,
        "n_picks": int(len(combined)),
        "harness_top1": harness_top1,
        "training_argmax_top1": argmax_correct / max(argmax_total, 1),
        "recorded_best_val_top1": expected,
        "delta_pp": (harness_top1 - expected) * 100 if expected else None,
        "top1_ci": [boot["top1"]["lo"], boot["top1"]["hi"]],
        "top3": evalproto.topk(combined, 3),
        "log_loss": evalproto.log_loss(combined),
        "ece": evalproto.ece(combined),
        "argmax_vs_rank_disagreements": int(
            (
                combined["top1"].to_numpy() != (combined["target_rank"].to_numpy() == 1)
            ).sum()
        ),
        "eval_picks_per_s": round(len(combined) / max(elapsed, 1e-9)),
        "bootstrap_selftest": selftest,
    }
    out = Path(args.out) if args.out else (eval_root() / "sanity")
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"sanity_{model_id(record)}.json"
    path.write_text(json.dumps(result, indent=2, default=str))
    print(
        json.dumps(
            {k: v for k, v in result.items() if k != "bootstrap_selftest"},
            indent=2,
            default=str,
        )
    )
    print(f"\nwrote {path}")


# -- phase B: report ---------------------------------------------------------


def read_predictions(preds_dir, tag, set_code):
    """All formats for one (model, set), draft keys made unique across files."""
    frames = []
    metas = []
    offset = 0
    for path in sorted((Path(preds_dir) / tag).glob(f"{set_code}.*.parquet")):
        frame = pd.read_parquet(path)
        frame["format"] = path.name.split(".")[1]
        frame["draft_id"] = frame["draft_id"].to_numpy().astype(np.int64) + offset
        offset = int(frame["draft_id"].max()) + 1
        frames.append(frame)
        meta_path = path.with_suffix(".json")
        if meta_path.exists():
            metas.append(json.loads(meta_path.read_text()))
    if not frames:
        return None, []
    return pd.concat(frames, ignore_index=True), metas


def block_metrics(frame, b, seed):
    """One reporting cell: point estimates, CIs, ECE, and bootstrap reps."""
    boot = cluster_bootstrap_means(frame, b=b, seed=seed)
    boot["ece"] = cluster_bootstrap_ece(frame, b=b, seed=seed)
    row = {
        "n_picks": int(len(frame)),
        "n_drafts": int(pd.unique(frame["draft_id"]).size),
    }
    for name in ("top1", "top3", "log_loss", "ece"):
        row[name] = boot[name]["point"]
        row[f"{name}_lo"] = boot[name]["lo"]
        row[f"{name}_hi"] = boot[name]["hi"]
    return row, {k: v["reps"] for k, v in boot.items()}


def collect_rows(frame, tag, set_code, format_label, b, seed):
    rows = []
    reps = {}
    slices = (("all", frame), ("expert", evalproto.expert_slice(frame)))
    for slice_name, sliced in slices:
        policies = (
            ("all_picks", sliced),
            ("non_forced", evalproto.non_forced(sliced)),
        )
        for policy, subset in policies:
            if not len(subset):
                continue
            metrics, replicates = block_metrics(subset, b, seed)
            rows.append(
                {
                    "model": tag,
                    "set": set_code,
                    "format": format_label,
                    "slice": slice_name,
                    "picks": policy,
                    **metrics,
                }
            )
            reps[(tag, set_code, format_label, slice_name, policy)] = replicates
    return rows, reps


def format_pct(row, name):
    return (
        f"{row[name] * 100:.2f} "
        f"[{row[f'{name}_lo'] * 100:.2f}, {row[f'{name}_hi'] * 100:.2f}]"
    )


def format_nats(row, name):
    return f"{row[name]:.4f} " f"[{row[f'{name}_lo']:.4f}, {row[f'{name}_hi']:.4f}]"


def format_ece(row):
    return f"{row['ece']:.4f} [{row['ece_lo']:.4f}, {row['ece_hi']:.4f}]"


def markdown_table(rows, models):
    lines = [
        "| slice | picks | model | n picks | n drafts | top-1 % [95% CI] | "
        "top-3 % [95% CI] | log loss [95% CI] | ECE [95% CI] |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for slice_name in ("all", "expert"):
        for policy in ("all_picks", "non_forced"):
            for tag in models:
                match = [
                    r
                    for r in rows
                    if r["slice"] == slice_name
                    and r["picks"] == policy
                    and r["model"] == tag
                ]
                if not match:
                    continue
                row = match[0]
                lines.append(
                    f"| {slice_name} | {policy} | {tag} | {row['n_picks']:,} | "
                    f"{row['n_drafts']:,} | {format_pct(row, 'top1')} | "
                    f"{format_pct(row, 'top3')} | {format_nats(row, 'log_loss')} | "
                    f"{format_ece(row)} |"
                )
    return lines


def detect_reversals(set_rows, mean_rows, models):
    """Sets whose width ordering on top-1 differs from the three-set mean."""
    notes = []
    for slice_name in ("all", "expert"):
        for policy in ("all_picks", "non_forced"):
            mean_match = [
                r
                for r in mean_rows
                if r["slice"] == slice_name and r["picks"] == policy
            ]
            if not mean_match:
                continue
            mean_order = [
                r["model"]
                for r in sorted(mean_match, key=lambda r: -r["top1"])
                if r["model"] in models
            ]
            if not mean_order:
                continue
            winner = mean_order[0]
            for set_code in DEV_SETS:
                per_set = [
                    r
                    for r in set_rows
                    if r["set"] == set_code
                    and r["format"] == "ALL"
                    and r["slice"] == slice_name
                    and r["picks"] == policy
                ]
                if not per_set:
                    continue
                order = [r["model"] for r in sorted(per_set, key=lambda r: -r["top1"])]
                if order[0] != winner:
                    best = [r for r in per_set if r["model"] == order[0]][0]
                    lost = [r for r in per_set if r["model"] == winner]
                    delta = (
                        (best["top1"] - lost[0]["top1"]) * 100 if lost else float("nan")
                    )
                    notes.append(
                        f"- **{set_code}** ({slice_name}, {policy}): mean-best "
                        f"`{winner}` is not set-best — `{order[0]}` leads by "
                        f"{delta:.3f} pp (set order {' > '.join(order)})."
                    )
    return notes


def plot_by_pick(curves, baseline, set_code, picks_per_pack, models, path):
    """Per-set top-1 by draft position, three width curves plus the 1/n floor."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.patheffects as patheffects
        import matplotlib.pyplot as plt
    except ImportError:
        return False

    figure, axes = plt.subplots(figsize=(9.5, 4.8), dpi=200)
    figure.patch.set_facecolor(SURFACE)
    axes.set_facecolor(SURFACE)
    for spine in ("top", "right"):
        axes.spines[spine].set_visible(False)
    for spine in ("left", "bottom"):
        axes.spines[spine].set_color(INK_GRID)
    axes.grid(True, color=INK_GRID, linewidth=0.8, alpha=0.7)
    axes.set_axisbelow(True)

    for boundary in range(1, 3):
        axes.axvline(
            boundary * picks_per_pack - 0.5,
            color=INK_GRID,
            linewidth=1.2,
            zorder=1,
        )
    for pack in range(3):
        axes.text(
            pack * picks_per_pack + 0.4,
            2,
            f"pack {pack + 1}",
            color=INK_SECONDARY,
            fontsize=8,
            alpha=0.8,
        )

    axes.plot(
        baseline["position"],
        baseline["random_floor"] * 100,
        color=INK_SECONDARY,
        linewidth=1.5,
        linestyle=(0, (5, 3)),
        label="1/n baseline",
        zorder=2,
    )
    drawn = [tag for tag in models if curves.get(tag) is not None]
    for index, tag in enumerate(drawn):
        curve = curves[tag]
        color = SERIES_COLORS[index % len(SERIES_COLORS)]
        axes.plot(
            curve["position"],
            curve["top1"] * 100,
            color=color,
            linewidth=2.0,
            marker="o",
            markersize=3.6,
            label=tag,
            zorder=3 + index,
        )
        # Direct labels supply relief for the slot-3 contrast warning. The
        # curves nearly coincide and all converge to 100% on the forced last
        # pick, so labels are staggered across distinct x positions instead of
        # stacked at the line ends, and haloed against the gridlines.
        anchor = int(round(len(curve) * (index + 1) / (len(drawn) + 1)))
        anchor = min(max(anchor, 0), len(curve) - 1)
        axes.annotate(
            tag,
            xy=(curve["position"].iloc[anchor], curve["top1"].iloc[anchor] * 100),
            xytext=(0, 9),
            textcoords="offset points",
            color=color,
            fontsize=8,
            ha="center",
            fontweight="bold",
            zorder=10,
        ).set_path_effects([patheffects.withStroke(linewidth=2.5, foreground=SURFACE)])

    axes.set_title(
        f"{set_code} — top-1 agreement by draft position",
        color=INK_PRIMARY,
        fontsize=12,
        pad=26,
        loc="left",
    )
    axes.set_xlabel("pick within draft (pack 1 → 3)", color=INK_SECONDARY, fontsize=9)
    axes.set_ylabel("top-1 agreement (%)", color=INK_SECONDARY, fontsize=9)
    axes.tick_params(colors=INK_SECONDARY, labelsize=8)
    axes.set_xlim(-1, 3 * picks_per_pack)
    axes.set_ylim(0, 104)
    legend = axes.legend(
        frameon=False,
        fontsize=8,
        loc="lower left",
        bbox_to_anchor=(0, 1.0),
        ncol=4,
        handlelength=1.8,
        columnspacing=1.6,
    )
    for text in legend.get_texts():
        text.set_color(INK_SECONDARY)
    figure.tight_layout()
    figure.savefig(path, facecolor=SURFACE)
    plt.close(figure)
    return True


def phase_report(args):
    preds_dir = Path(args.preds) if args.preds else default_preds_dir()
    reports = Path(args.out) if args.out else default_reports_dir()
    reports.mkdir(parents=True, exist_ok=True)
    models = (
        args.models.split(",")
        if args.models
        else sorted(
            (d.name for d in preds_dir.iterdir() if d.is_dir()),
            key=lambda name: int(name.lstrip("d")) if name.lstrip("d").isdigit() else 0,
        )
    )
    sets = [s.strip().upper() for s in args.sets.split(",") if s.strip()]

    all_rows = []
    curves = {}
    baselines = {}
    picks_per_pack = {}
    metas = []
    selftest = None
    set_reps = {}

    for set_code in sets:
        for tag in models:
            frame, file_metas = read_predictions(preds_dir, tag, set_code)
            if frame is None:
                print(f"no predictions for {tag}/{set_code}", flush=True)
                continue
            metas.extend(file_metas)
            if selftest is None:
                selftest = selftest_bootstrap(
                    frame.iloc[: min(len(frame), 200_000)], b=args.selftest_b
                )
                print("bootstrap self-test vs evalproto: OK", flush=True)
            rows, reps = collect_rows(
                frame, tag, set_code, "ALL", args.bootstrap, args.seed
            )
            all_rows.extend(rows)
            set_reps.update(reps)
            for limited_type, part in frame.groupby("format", sort=True):
                sub_rows, _ = collect_rows(
                    part, tag, set_code, limited_type, args.bootstrap, args.seed
                )
                all_rows.extend(sub_rows)
            curve = evalproto.per_pick_curve(frame)
            ppp = next(
                (
                    m.get("picks_per_pack")
                    for m in file_metas
                    if m.get("picks_per_pack")
                ),
                14,
            )
            picks_per_pack[set_code] = ppp
            curve["position"] = curve["pack_number"] * ppp + curve["pick_number"]
            curve = curve.sort_values("position").reset_index(drop=True)
            curves.setdefault(set_code, {})[tag] = curve
            # random_floor depends only on pack sizes, so it is identical for
            # every model on this set; keeping the last one is deliberate.
            baselines[set_code] = curve
            print(
                f"{set_code} {tag}: {len(frame):,} picks, "
                f"top1 {frame['top1'].mean():.4f}",
                flush=True,
            )
            del frame

    summary = pd.DataFrame(all_rows)
    # Unweighted three-set mean, CI from the averaged bootstrap replicates.
    mean_rows = []
    for tag in models:
        for slice_name in ("all", "expert"):
            for policy in ("all_picks", "non_forced"):
                keys = [
                    (tag, s, "ALL", slice_name, policy)
                    for s in sets
                    if (tag, s, "ALL", slice_name, policy) in set_reps
                ]
                if len(keys) != len(sets):
                    continue
                per_set = [
                    r
                    for r in all_rows
                    if r["model"] == tag
                    and r["format"] == "ALL"
                    and r["slice"] == slice_name
                    and r["picks"] == policy
                ]
                row = {
                    "model": tag,
                    "set": "MEAN",
                    "format": "ALL",
                    "slice": slice_name,
                    "picks": policy,
                    "n_picks": int(sum(r["n_picks"] for r in per_set)),
                    "n_drafts": int(sum(r["n_drafts"] for r in per_set)),
                }
                for name in ("top1", "top3", "log_loss", "ece"):
                    stacked = np.mean([set_reps[k][name] for k in keys], axis=0)
                    low, high = np.percentile(stacked, [2.5, 97.5])
                    row[name] = float(np.mean([r[name] for r in per_set]))
                    row[f"{name}_lo"] = float(low)
                    row[f"{name}_hi"] = float(high)
                mean_rows.append(row)
    summary = pd.concat([summary, pd.DataFrame(mean_rows)], ignore_index=True)
    summary.to_csv(reports / "summary.csv", index=False)

    efficiency = []
    seen = set()
    for meta in metas:
        tag = meta["model_id"]
        if tag in seen:
            continue
        rows_for_tag = [m for m in metas if m["model_id"] == tag]
        picks = sum(m["picks"] for m in rows_for_tag)
        seconds = sum(m["elapsed_s"] for m in rows_for_tag)
        efficiency.append(
            {
                "model": tag,
                "d_model": meta["d_model"],
                "n_params": meta["n_params"],
                "train_wall_clock_s": meta["train_wall_clock_s"],
                "train_wall_clock_h": round(meta["train_wall_clock_s"] / 3600, 2),
                "train_examples_per_s": meta["train_examples_per_s"],
                "internal_val_top1": meta["best_val_top1"],
                "eval_picks": picks,
                "eval_seconds": round(seconds, 1),
                "eval_picks_per_s": round(picks / max(seconds, 1e-9)),
                "device": meta["device"],
            }
        )
        seen.add(tag)
    efficiency = pd.DataFrame(efficiency)
    efficiency.to_csv(reports / "efficiency.csv", index=False)

    plotted = {}
    for set_code in sets:
        if set_code not in curves:
            continue
        table = []
        for tag, curve in curves[set_code].items():
            part = curve.copy()
            part["model"] = tag
            table.append(part)
        pd.concat(table, ignore_index=True).to_csv(
            reports / f"by_pick_{set_code}.csv", index=False
        )
        plotted[set_code] = plot_by_pick(
            curves[set_code],
            baselines[set_code],
            set_code,
            picks_per_pack[set_code],
            models,
            reports / f"by_pick_{set_code}.png",
        )
    if args.require_plots and not all(plotted.values()):
        raise SystemExit("matplotlib unavailable — cannot honour --require-plots")
    if not all(plotted.values()):
        print("WARNING: matplotlib unavailable; CSV curves written, PNGs skipped")

    manifest_sha = metas[0]["featurizer_manifest_sha"] if metas else "unknown"
    lines = [
        "# DraftFM rebuild width comparison",
        "",
        f"Protocol: `{PROTOCOL_TAG}` (`docs/eval_protocol_rebuild.md`)  ",
        f"Git revision: `{runlog.git_sha()}`  ",
        f"Featurizer manifest: `{manifest_sha}`  ",
        f"Bootstrap: cluster by draft, B={args.bootstrap}, seed={args.seed}  ",
        "",
        "Every 95% CI in this report is a percentile cluster bootstrap over "
        f"drafts on the same B={args.bootstrap} resamples (seed {args.seed}). "
        f"ECE uses {evalproto.ECE_BINS} equal-mass bins whose edges are fixed "
        "at the full-sample values across resamples; the run's self-test "
        "reports the resulting CI discrepancy against the literal estimator.",
        "",
        "BRO, FDN, and MSH are whole-set **development** environments for this "
        "rebuild, not untouched final tests. They informed architecture "
        "selection, so these numbers are optimistic relative to a "
        "never-inspected holdout.",
        "",
        "## Per-set results",
        "",
    ]
    for set_code in sets:
        rows = [r for r in all_rows if r["set"] == set_code and r["format"] == "ALL"]
        if not rows:
            continue
        lines += [f"### {set_code} (all formats pooled)", ""]
        lines += markdown_table(rows, models)
        lines += [""]

    lines += ["## Per (set, format)", ""]
    for set_code in sets:
        for limited_type in sorted(
            {r["format"] for r in all_rows if r["set"] == set_code} - {"ALL"}
        ):
            rows = [
                r
                for r in all_rows
                if r["set"] == set_code and r["format"] == limited_type
            ]
            lines += [f"### {set_code}.{limited_type}", ""]
            lines += markdown_table(rows, models)
            lines += [""]

    lines += [
        "## Unweighted three-set mean (summary only, not a winner rule)",
        "",
        "Metric columns are the unweighted mean of the three per-set values; "
        "the CI comes from averaging the per-set bootstrap replicates. The "
        "pick and draft columns are totals, not means.",
        "",
    ]
    lines += markdown_table(mean_rows, models)
    lines += [""]

    reversals = detect_reversals(all_rows, mean_rows, models)
    lines += ["## Set-level reversals", ""]
    lines += reversals or ["- None: the mean ordering holds on every set."]
    lines += ["", "## Efficiency", ""]
    lines += [
        "| model | d_model | params | train wall clock (h) | train ex/s | "
        "internal val top-1 | eval picks | eval picks/s | device |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for row in efficiency.to_dict("records"):
        lines.append(
            f"| {row['model']} | {row['d_model']} | {row['n_params']:,} | "
            f"{row['train_wall_clock_h']:.2f} | "
            f"{row['train_examples_per_s']:,} | "
            f"{row['internal_val_top1'] * 100:.4f}% | {row['eval_picks']:,} | "
            f"{row['eval_picks_per_s']:,} | {row['device']} |"
        )
    lines += ["", "## By-position agreement", ""]
    for set_code in sets:
        if set_code in curves:
            lines.append(
                f"- `by_pick_{set_code}.png` / `by_pick_{set_code}.csv` — "
                f"three width curves plus the mean 1/n baseline."
            )
    (reports / "summary.md").write_text("\n".join(lines) + "\n")

    # Phase B derives everything from the cached parquets, so their integrity
    # is the whole chain of custody: re-verify the hashes phase A recorded.
    mismatches = []
    for meta in metas:
        path = preds_dir / meta["model_id"] / f"{meta['set']}.{meta['format']}.parquet"
        actual = runlog.file_sha256(path)
        if actual != meta["parquet_sha256"]:
            mismatches.append(
                {
                    "file": str(path),
                    "recorded": meta["parquet_sha256"],
                    "actual": actual,
                }
            )
    if mismatches:
        raise SystemExit(
            f"prediction parquet sha256 mismatch on {len(mismatches)} file(s): "
            f"{mismatches[0]['file']} — the cache changed since phase A"
        )

    provenance = {
        "protocol": PROTOCOL_TAG,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "git_sha": runlog.git_sha(),
        "platform": platform.platform(),
        "bootstrap": {
            "b": args.bootstrap,
            "seed": args.seed,
            "unit": "draft",
            "method": "percentile cluster bootstrap",
            "ece_bins": evalproto.ECE_BINS,
            "ece_bin_edges": "fixed at full-sample equal-mass values",
        },
        "featurizer_manifest_sha": manifest_sha,
        "bootstrap_selftest_vs_evalproto": selftest,
        "phase_a": {
            "rerun_from_cache_only": True,
            "code_commit": args.phase_a_code_commit or None,
            "parquet_sha256_verified": True,
            "n_parquets_verified": len(metas),
            "valid_input_assets": args.phase_a_inputs or None,
            "note": args.phase_a_note or None,
        },
        "checkpoints": {
            m["model_id"]: {
                "run_id": m["run_id"],
                "run_dir": m["run_dir"],
                "sha256": m["checkpoint_sha256"],
                "n_params": m["n_params"],
            }
            for m in metas
        },
        "prediction_files": {
            f"{m['model_id']}/{m['set']}.{m['format']}.parquet": {
                "sha256": m["parquet_sha256"],
                "picks": m["picks"],
                "drafts": m["drafts"],
                "argmax_rank_disagreements": m["argmax_rank_disagreements"],
            }
            for m in metas
        },
    }
    (reports / "provenance.json").write_text(
        json.dumps(provenance, indent=2, default=str)
    )
    print(f"wrote {reports}/summary.md, summary.csv, efficiency.csv, provenance.json")


# -- cli ---------------------------------------------------------------------


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--expect-manifest",
        default=EXPECTED_MANIFEST_SHA,
        help="pin the featurizer manifest content hash ('' to skip)",
    )
    subparsers = parser.add_subparsers(dest="phase", required=True)

    predict = subparsers.add_parser("predict", help="phase A: cache predictions")
    predict.add_argument("--runs", nargs="+", required=True, help="run directories")
    predict.add_argument("--sets", default=",".join(DEV_SETS))
    predict.add_argument("--formats", default="", help="default: every built shard")
    predict.add_argument("--device", default="mps")
    predict.add_argument("--batch-size", type=int, default=BATCH)
    predict.add_argument("--limit", type=int, default=0, help="smoke: first N rows")
    predict.add_argument("--progress", type=int, default=0, help="log every N batches")
    predict.add_argument("--out", default="")
    predict.set_defaults(func=phase_predict)

    sanity = subparsers.add_parser("sanity", help="harness gate vs training val")
    sanity.add_argument("--run", required=True)
    sanity.add_argument("--device", default="mps")
    sanity.add_argument("--per-shard", type=int, default=3636)
    sanity.add_argument("--batch-size", type=int, default=BATCH)
    sanity.add_argument("--seed", type=int, default=18)
    sanity.add_argument("--bootstrap", type=int, default=BOOTSTRAP_B)
    sanity.add_argument("--selftest-b", type=int, default=100)
    sanity.add_argument("--out", default="")
    sanity.set_defaults(func=phase_sanity)

    report = subparsers.add_parser("report", help="phase B: tables, curves, plots")
    report.add_argument("--preds", default="")
    report.add_argument("--out", default="")
    report.add_argument("--sets", default=",".join(DEV_SETS))
    report.add_argument("--models", default="")
    report.add_argument("--bootstrap", type=int, default=BOOTSTRAP_B)
    report.add_argument("--seed", type=int, default=BOOTSTRAP_SEED)
    report.add_argument("--selftest-b", type=int, default=100)
    report.add_argument("--require-plots", action="store_true")
    report.add_argument(
        "--phase-a-code-commit",
        default="",
        help="commit whose code produced the cached prediction parquets",
    )
    report.add_argument(
        "--phase-a-inputs",
        default="",
        help="the only asset set a future phase A re-run may be pointed at",
    )
    report.add_argument("--phase-a-note", default="", help="chain-of-custody note")
    report.set_defaults(func=phase_report)
    return parser


def main():
    args = create_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
