#!/usr/bin/env python
"""Pre-registered ALIGNED normalized score (docs/eval_protocol.md section 3):

    normalized score = zero-shot top-1 / per-set-ceiling top-1
                        on IDENTICAL (draft_id, pack_number, pick_number) picks

Dev trio only (BRO, TMT, SOS). MSH is frozen-eval-only and is never touched
here -- its normalized score is computed by scripts/run_frozen_eval.py's
`ceiling_comparison`, post-T0, under live authorization.

This is DIFFERENT from the already-published "unaligned ratio" (\\RatioBro /
\\RatioTmt / \\RatioSos / \\RatioDevMean in paper/tables/numbers.tex, emitted
by scripts/make_paper_tables.py): the unaligned ratio divides each model's
own top-1, each computed over that model's own separate eval population
(F-dev's zero-shot predictions cover the *entire* held-out slice of a set;
the per-set ceiling's val split is a ~5%-of-drafts held-out slice of its
*own*, expert-only-filtered training data -- different picks, different
denominators). The aligned normalized score instead inner-joins both
prediction frames onto identical picks first (evalproto.align_on_picks) so
both models are scored on the exact same, typically much smaller, set of
picks before the ratio is taken.

Inputs (frozen artifacts / deployed models, never re-run here):
  <F-dev run dir>/zeroshot/{SET}.PremierDraft.parquet   cached zero-shot preds
                                                        (scripts/eval_draftfm.py)
  mtga.foundation.predict.per_set_model_predictions(...) per-set ONNX ceiling
                                                        model, val split

Usage:
  python scripts/eval_normalized_score.py \\
      --run /opt/bward/dat/mtga/foundation/runs/20260704_135822_f_dev \\
      --sets BRO,TMT,SOS

Writes <run>/zeroshot/normalized_score.json and prints a summary table.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from mtga.foundation import evalproto, predict
from mtga.lands import corpus

DEV_SETS = ["BRO", "TMT", "SOS"]


def ratio_cluster_bootstrap(frame_a, frame_b, stat_fn=evalproto.top1,
                            b=evalproto.BOOTSTRAP_B,
                            seed=evalproto.BOOTSTRAP_SEED):
    """95% percentile CI on stat_fn(A) / stat_fn(B), whole-draft cluster
    resampling with SHARED resample indices across A and B.

    `frame_a`/`frame_b` must already be aligned on identical picks (i.e.
    carry exactly the same draft_id set, e.g. the two frames returned by
    evalproto.align_on_picks) so that resample index j means the same draft
    in both frames -- otherwise the ratio's numerator and denominator would
    be resampled independently and the CI would overstate precision.

    Mirrors evalproto.paired_bootstrap_diff's resampling machinery exactly;
    only the final combine step (ratio instead of difference) differs. This
    is NOT added to evalproto.py itself: that module is FROZEN at tag
    eval-protocol-v1 (docs/eval_protocol.md) and a ratio-CI helper is new
    analysis code, not a change to a pre-registered metric.
    """
    drafts_a = set(frame_a["draft_id"])
    drafts_b = set(frame_b["draft_id"])
    if drafts_a != drafts_b:
        raise ValueError(
            "frames are not aligned on identical drafts -- run "
            "evalproto.align_on_picks(expert_a, expert_b) first")

    groups_a = evalproto._draft_groups(frame_a)
    groups_b = evalproto._draft_groups(frame_b)
    ids_a = frame_a["draft_id"].iloc[[g[0] for g in groups_a]].tolist()
    ids_b = frame_b["draft_id"].iloc[[g[0] for g in groups_b]].tolist()
    index_b = {d: i for i, d in enumerate(ids_b)}
    groups_b = [groups_b[index_b[d]] for d in ids_a]

    rng = np.random.default_rng(seed)
    n = len(groups_a)
    point = stat_fn(frame_a) / stat_fn(frame_b)
    stats = np.full(b, np.nan)
    for i in range(b):
        chosen = rng.integers(0, n, size=n)
        rows_a = np.concatenate([groups_a[j] for j in chosen])
        rows_b = np.concatenate([groups_b[j] for j in chosen])
        denom = stat_fn(frame_b.iloc[rows_b])
        if denom > 0:
            stats[i] = stat_fn(frame_a.iloc[rows_a]) / denom
    valid = stats[~np.isnan(stats)]
    lo, hi = np.percentile(valid, [2.5, 97.5])
    return point, float(lo), float(hi), int(b - len(valid))


def normalized_score(zeroshot_dir, set_code, limited_type="PremierDraft",
                     version="latest", split="val"):
    """One dev-trio set's aligned normalized score + supporting counts."""
    zs_path = Path(zeroshot_dir) / f"{set_code}.{limited_type}.parquet"
    zeroshot = evalproto.validate(pd.read_parquet(zs_path))
    ceiling = evalproto.validate(predict.per_set_model_predictions(
        set_code, limited_type, version=version, split=split))

    # Step 3: restrict both to the expert slice BEFORE aligning (matches how
    # every other headline number in the paper is scoped). Note
    # per_set_model_predictions already filters to wr_bucket>=0.55 &
    # n_games_bucket>=100 by construction (its defaults equal
    # evalproto.EXPERT_WR_BUCKET/EXPERT_GAMES_BUCKET exactly), so this is a
    # no-op for `ceiling` and a real filter for `zeroshot` (which covers all
    # skill levels).
    zs_expert = evalproto.expert_slice(zeroshot)
    ceil_expert = evalproto.expert_slice(ceiling)

    aligned_zs, aligned_ceil = evalproto.align_on_picks(zs_expert, ceil_expert)

    n_ceil_drafts = int(ceil_expert["draft_id"].nunique())
    n_aligned_drafts = int(aligned_zs["draft_id"].nunique()) if len(aligned_zs) else 0
    result = {
        "set": set_code,
        "n_zeroshot_expert_picks": int(len(zs_expert)),
        "n_zeroshot_expert_drafts": int(zs_expert["draft_id"].nunique()),
        "n_ceiling_expert_picks": int(len(ceil_expert)),
        "n_ceiling_expert_drafts": n_ceil_drafts,
        "n_aligned_picks": int(len(aligned_zs)),
        "n_aligned_drafts": n_aligned_drafts,
        "aligned_drafts_over_ceiling_val_drafts": (
            n_aligned_drafts / n_ceil_drafts if n_ceil_drafts else float("nan")),
    }
    if not len(aligned_zs):
        result.update(zeroshot_top1_aligned=float("nan"),
                      ceiling_top1_aligned=float("nan"),
                      normalized_score=float("nan"),
                      normalized_score_ci=[float("nan"), float("nan")],
                      degenerate_resamples=None)
        return result

    zs_top1 = evalproto.top1(aligned_zs)
    ceil_top1 = evalproto.top1(aligned_ceil)
    point, lo, hi, degenerate = ratio_cluster_bootstrap(aligned_zs, aligned_ceil)
    result.update(
        zeroshot_top1_aligned=zs_top1,
        ceiling_top1_aligned=ceil_top1,
        normalized_score=point,
        normalized_score_ci=[lo, hi],
        degenerate_resamples=degenerate,
    )
    return result


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True,
                        help="F-dev run dir containing zeroshot/*.parquet")
    parser.add_argument("--sets", default=",".join(DEV_SETS))
    parser.add_argument("--formats", default="PremierDraft")
    parser.add_argument("--version", default="latest")
    parser.add_argument("--split", default="val")
    parser.add_argument("--out", default=None,
                        help="default: <run>/zeroshot/normalized_score.json")
    return parser


def main():
    args = create_parser().parse_args()
    sets = [s.strip().upper() for s in args.sets.split(",")]
    bad = set(sets) & corpus.EVAL_ONLY
    if bad:
        raise SystemExit(f"{bad} is EVAL_ONLY -- MSH goes through "
                         f"scripts/run_frozen_eval.py, never this script")
    formats = [f.strip() for f in args.formats.split(",")]
    zeroshot_dir = Path(args.run) / "zeroshot"

    per_set = {}
    for set_code in sets:
        for fmt in formats:
            key = f"{set_code}.{fmt}"
            r = normalized_score(zeroshot_dir, set_code, fmt,
                                 version=args.version, split=args.split)
            per_set[key] = r
            print(
                f"{key}: aligned n_picks={r['n_aligned_picks']:,} "
                f"n_drafts={r['n_aligned_drafts']:,} "
                f"({r['aligned_drafts_over_ceiling_val_drafts']:.1%} of the "
                f"ceiling's {r['n_ceiling_expert_drafts']:,}-draft val "
                f"slice) | zero-shot top1 {r['zeroshot_top1_aligned']:.4f} "
                f"/ ceiling top1 {r['ceiling_top1_aligned']:.4f} "
                f"= normalized score {r['normalized_score']:.4f} "
                f"(CI {r['normalized_score_ci'][0]:.4f}-"
                f"{r['normalized_score_ci'][1]:.4f})", flush=True)

    premier_keys = [k for k in per_set if k.endswith(".PremierDraft")]
    dev_mean = (sum(per_set[k]["normalized_score"] for k in premier_keys)
               / len(premier_keys)) if premier_keys else float("nan")
    print(f"dev-trio mean aligned normalized score (Premier): {dev_mean:.4f}")

    out_path = Path(args.out) if args.out else (zeroshot_dir / "normalized_score.json")
    out_path.write_text(json.dumps(
        {"run": str(args.run), "version": args.version, "split": args.split,
         "per_set": per_set, "dev_mean_normalized_score": dev_mean},
        indent=2, default=str))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
