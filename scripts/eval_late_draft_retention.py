#!/usr/bin/env python
"""Dev-trio late-draft retention (docs/eval_protocol.md section 3):

    late-draft retention = zero-shot top-1 / per-set-ceiling top-1
                            on picks 8+ of each pack (0-indexed pick_number
                            >= 7), each model scored on its OWN population
                            (unaligned -- matches how \\RatioBro/\\RatioTmt/
                            \\RatioSos/\\RatioDevMean are computed in
                            paper/tables/numbers.tex, NOT the aligned
                            normalized score in eval_normalized_score.py).

Fills the dev-trio half of paper/sections/analysis.tex's
"\\pending{late-draft retention, dev trio and MSH}" -- MSH is EVAL_ONLY and
is never touched here.

evalproto.late_draft_retention(frame, ceiling_frame, first_late_pick=7) is
used exactly as frozen; this script only assembles the two input frames
(expert slice) per set and reports the underlying late-pick top-1s plus the
per-(pack,pick) curve against the per-cell random floor.

Inputs (frozen artifacts / deployed models, never re-run here):
  <F-dev run dir>/zeroshot/{SET}.PremierDraft.parquet   cached zero-shot preds
  mtga.foundation.predict.per_set_model_predictions(...) per-set ONNX ceiling,
                                                        val split

Usage:
  .venv-ml/bin/python scripts/eval_late_draft_retention.py \\
      --run /opt/bward/dat/mtga/foundation/runs/20260704_135822_f_dev \\
      [--out /tmp/late_draft_retention.json]
"""

import argparse
import json
from pathlib import Path

import pandas as pd

from mtga.foundation import evalproto, predict
from mtga.lands import corpus

DEV_SETS = ["BRO", "TMT", "SOS"]
FIRST_LATE_PICK = 7  # 0-indexed pick_number >= 7 -> human pick 8+

# Already-published overall (all-pick) unaligned ratios, for comparison
# (paper/tables/numbers.tex \RatioBro / \RatioTmt / \RatioSos / \RatioDevMean,
# emitted by scripts/make_paper_tables.py from the same F-dev run).
PUBLISHED_OVERALL_RATIO = {"BRO": 0.745, "TMT": 0.810, "SOS": 0.805}


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True,
                        help="F-dev run dir (contains zeroshot/*.parquet)")
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--version", default="latest")
    parser.add_argument("--split", default="val")
    parser.add_argument("--out", default=None, help="optional json report path")
    return parser


def load_expert_pair(run_dir, set_code, fmt, version, split):
    """(zeroshot_expert, ceiling_expert) predictions frames for one set."""
    zs_path = Path(run_dir) / "zeroshot" / f"{set_code}.{fmt}.parquet"
    zeroshot = evalproto.validate(pd.read_parquet(zs_path))
    ceiling = evalproto.validate(predict.per_set_model_predictions(
        set_code, fmt, version=version, split=split))
    return evalproto.expert_slice(zeroshot), evalproto.expert_slice(ceiling)


def set_report(set_code, zs_expert, ceil_expert):
    late_zs = zs_expert[zs_expert["pick_number"] >= FIRST_LATE_PICK]
    late_ceil = ceil_expert[ceil_expert["pick_number"] >= FIRST_LATE_PICK]

    late_zs_top1, zs_lo, zs_hi = evalproto.cluster_bootstrap(late_zs, evalproto.top1)
    late_ceil_top1, ceil_lo, ceil_hi = evalproto.cluster_bootstrap(
        late_ceil, evalproto.top1)
    retention = evalproto.late_draft_retention(
        zs_expert, ceil_expert, first_late_pick=FIRST_LATE_PICK)

    overall_zs_top1 = evalproto.top1(zs_expert)
    overall_ceil_top1 = evalproto.top1(ceil_expert)
    overall_ratio = overall_zs_top1 / overall_ceil_top1

    return {
        "set": set_code,
        "n_late_zs_picks": int(len(late_zs)),
        "n_late_zs_drafts": int(late_zs["draft_id"].nunique()),
        "n_late_ceil_picks": int(len(late_ceil)),
        "n_late_ceil_drafts": int(late_ceil["draft_id"].nunique()),
        "late_zeroshot_top1": late_zs_top1,
        "late_zeroshot_top1_ci": [zs_lo, zs_hi],
        "late_ceiling_top1": late_ceil_top1,
        "late_ceiling_top1_ci": [ceil_lo, ceil_hi],
        "late_draft_retention": retention,
        "overall_zeroshot_top1_this_run": overall_zs_top1,
        "overall_ceiling_top1_this_run": overall_ceil_top1,
        "overall_ratio_this_run": overall_ratio,
        "published_overall_ratio": PUBLISHED_OVERALL_RATIO.get(set_code),
        "retention_minus_published_overall_ratio": (
            retention - PUBLISHED_OVERALL_RATIO[set_code]
            if set_code in PUBLISHED_OVERALL_RATIO else float("nan")),
    }


def curve_report(zs_expert, set_code):
    """Per-(pack,pick) zero-shot top-1 vs. the per-cell random floor, plus
    the worst (most floor-hugging) margin cell for a quick eyeball check."""
    curve = evalproto.per_pick_curve(zs_expert)
    curve["set"] = set_code
    curve["margin"] = curve["top1"] - curve["random_floor"]
    return curve


def main():
    args = create_parser().parse_args()
    bad = set(DEV_SETS) & corpus.EVAL_ONLY
    if bad:
        raise SystemExit(f"{bad} is EVAL_ONLY -- this script is dev-trio-only")

    reports = {}
    curves = []
    for set_code in DEV_SETS:
        zs_expert, ceil_expert = load_expert_pair(
            args.run, set_code, args.format, args.version, args.split)
        r = set_report(set_code, zs_expert, ceil_expert)
        reports[set_code] = r
        curves.append(curve_report(zs_expert, set_code))

        print(f"== {set_code} (expert slice, F-dev zero-shot vs. per-set "
              f"ceiling {args.version}/{args.split}) ==")
        print(f"  late (pick>={FIRST_LATE_PICK}) zero-shot top1: "
              f"{r['late_zeroshot_top1']:.4f} "
              f"(CI {r['late_zeroshot_top1_ci'][0]:.4f}-"
              f"{r['late_zeroshot_top1_ci'][1]:.4f}) "
              f"n={r['n_late_zs_picks']:,} picks / {r['n_late_zs_drafts']:,} drafts")
        print(f"  late ceiling top1: {r['late_ceiling_top1']:.4f} "
              f"(CI {r['late_ceiling_top1_ci'][0]:.4f}-"
              f"{r['late_ceiling_top1_ci'][1]:.4f}) "
              f"n={r['n_late_ceil_picks']:,} picks / {r['n_late_ceil_drafts']:,} drafts")
        print(f"  late-draft retention (unaligned zs/ceiling): "
              f"{r['late_draft_retention']:.4f} "
              f"({100 * r['late_draft_retention']:.1f}%)")
        print(f"  overall (all-pick) ratio, this run: "
              f"{r['overall_ratio_this_run']:.4f} "
              f"({100 * r['overall_ratio_this_run']:.1f}%) | "
              f"published \\Ratio{set_code.title()}: "
              f"{100 * r['published_overall_ratio']:.1f}%")
        delta = 100 * (r['late_draft_retention'] - r['overall_ratio_this_run'])
        print(f"  late retention - overall ratio (this run): {delta:+.1f}pp\n")

    dev_mean_retention = sum(reports[s]["late_draft_retention"] for s in DEV_SETS) / 3
    dev_mean_overall = sum(reports[s]["overall_ratio_this_run"] for s in DEV_SETS) / 3
    print(f"dev-trio mean late-draft retention: {dev_mean_retention:.4f} "
          f"({100 * dev_mean_retention:.1f}%)")
    print(f"dev-trio mean overall ratio (this run): {dev_mean_overall:.4f} "
          f"({100 * dev_mean_overall:.1f}%) | published \\RatioDevMean: 78.7%")

    all_curves = pd.concat(curves, ignore_index=True)
    print("\n== per-(pack,pick) zero-shot top1 vs. random floor (all dev sets) ==")
    print(all_curves.sort_values(["set", "pack_number", "pick_number"])
          .to_string(index=False))
    worst = all_curves.loc[all_curves["margin"].idxmin()]
    print(f"\nsmallest zero-shot margin over random floor: set={worst['set']} "
          f"pack={int(worst['pack_number'])} pick={int(worst['pick_number'])} "
          f"top1={worst['top1']:.4f} random_floor={worst['random_floor']:.4f} "
          f"margin={worst['margin']:.4f} n={int(worst['n'])}")

    out_path = Path(args.out) if args.out else (
        Path(args.run) / "zeroshot" / "late_draft_retention.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "run": str(args.run),
        "first_late_pick": FIRST_LATE_PICK,
        "version": args.version,
        "split": args.split,
        "per_set": reports,
        "dev_mean_late_draft_retention": dev_mean_retention,
        "dev_mean_overall_ratio_this_run": dev_mean_overall,
        "curves": all_curves.to_dict(orient="records"),
    }, indent=2, default=str))
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
