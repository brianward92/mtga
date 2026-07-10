#!/usr/bin/env python
"""Post-day-one MSH ceiling rows (docs/eval_protocol.md section 4, item 6).

Pre-registered to run AFTER the zero-shot frozen evaluation, never iterated:
a per-set DraftNet ceiling trained on the frozen MSH snapshot with the stock
recipe (hidden 512/512, dropout 0.3, seed 17). This script does NOT re-run
any battery member: the zero-shot side of every comparison is read from the
cached prediction parquets the one real pass wrote. Only the new ceiling
model is run (over its own validation split), exactly as ceilings are run
for the dev sets.

Outputs an addendum directory next to the canonical frozen-eval output,
using the same summary.json schema (so make_paper_tables.py's existing
discovery finds the "perset" member and its ceiling_comparisons):

  <frozen root>/<snapshot_sha>_postday1/
      perset.deployment.parquet
      summary.json     (context.set=MSH, rehearse=false, results.perset,
                        ceiling_comparisons for f-full and f-dev)

The canonical one-shot directory is never written to.

Usage:
  MTGA_DATA_ROOT=/opt/bward/dat/mtga .venv-ml/bin/python \\
      scripts/eval_msh_ceiling_comparison.py [--version msh_perset_ceiling]
"""

import argparse
import datetime
import hashlib
import json
from pathlib import Path

import pandas as pd

from mtga.foundation import evalproto, predict
from mtga.lands import paths

MSH_SHA = "013df16b8994534f69ed63c87ab684acafc5f4cbe82982264b0fc111dbb2183a"


def summarize_frame(frame, label):
    evalproto.validate(frame)
    expert = evalproto.expert_slice(frame)
    result = {"all": evalproto.summarize(frame, f"{label}/all")}
    if len(expert):
        result["expert"] = evalproto.summarize(expert, f"{label}/expert")
    return result


def ceiling_comparison(zeroshot, ceiling):
    """Identical to run_frozen_eval.ceiling_comparison (not imported: that
    module argparses at import in some environments; logic mirrored and kept
    in lockstep with the frozen evalproto calls)."""
    aligned_z, aligned_c = evalproto.align_on_picks(
        evalproto.expert_slice(zeroshot), evalproto.expert_slice(ceiling))
    if not len(aligned_z):
        return None
    diff, lo, hi = evalproto.paired_bootstrap_diff(
        aligned_z, aligned_c, evalproto.top1)
    return {
        "n_shared_picks": int(len(aligned_z)),
        "zeroshot_top1": evalproto.top1(aligned_z),
        "ceiling_top1": evalproto.top1(aligned_c),
        "normalized_top1": (evalproto.top1(aligned_z)
                            / max(evalproto.top1(aligned_c), 1e-12)),
        "top1_diff": diff, "top1_diff_ci": [lo, hi],
        "late_draft_retention": evalproto.late_draft_retention(
            aligned_z, aligned_c),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="msh_perset_ceiling",
                        help="per-set model version dir under models/MSH")
    parser.add_argument("--frozen-root", default=None)
    args = parser.parse_args()

    frozen_root = Path(args.frozen_root) if args.frozen_root else (
        paths.DATA_ROOT / "foundation" / "frozen_eval")
    canonical = frozen_root / MSH_SHA
    out_dir = frozen_root / f"{MSH_SHA}_postday1"
    out_dir.mkdir(parents=True, exist_ok=True)

    model_meta = json.loads(
        (paths.MODELS_DIR / "MSH" / "PremierDraft" / args.version /
         "meta.json").read_text())

    print(f"ceiling: MSH/PremierDraft/{args.version} "
          f"(trained {model_meta['trained_at']})")
    ceiling = predict.per_set_model_predictions(
        "MSH", "PremierDraft", version=args.version, split="val")
    ceiling.to_parquet(out_dir / "perset.deployment.parquet", index=False)
    results = {"perset": {"deployment": summarize_frame(ceiling, "perset")}}
    e = results["perset"]["deployment"]["expert"]
    print(f"ceiling val (high-win-rate slice): top1 {e['top1']:.4f} "
          f"[{e['top1_ci'][0]:.4f}, {e['top1_ci'][1]:.4f}], "
          f"n={e['n_picks']:,}")

    comparisons = {}
    for member in ("f-full", "f-dev"):
        cached = canonical / f"{member}.deployment.parquet"
        frame = pd.read_parquet(cached)
        comparison = ceiling_comparison(frame, ceiling)
        comparisons[member] = comparison
        print(f"{member}: normalized top-1 "
              f"{comparison['normalized_top1']:.4f} "
              f"({comparison['zeroshot_top1']:.4f} / "
              f"{comparison['ceiling_top1']:.4f}), late-draft retention "
              f"{comparison['late_draft_retention']:.4f} over "
              f"{comparison['n_shared_picks']:,} shared picks")

    summary = {
        "context": {
            "set": "MSH", "format": "PremierDraft", "rehearse": False,
            "snapshot_sha": MSH_SHA,
            "post_day_one": True,
            "note": (
                "Pre-registered post-day-one addendum (protocol section 4, "
                "item 6): per-set ceiling trained on the frozen snapshot "
                "with the stock recipe AFTER the zero-shot pass. Zero-shot "
                "frames are the canonical cached parquets; no battery "
                "member was re-run."),
            "ceiling_model": model_meta["model_id"],
            "ceiling_trained_at": model_meta["trained_at"],
            "ceiling_data_etag": model_meta["data_etag"],
            "executed_at": datetime.datetime.now().isoformat(
                timespec="seconds"),
        },
        "results": results,
        "ceiling_comparisons": comparisons,
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, default=str))
    print(f"wrote {out_dir}/summary.json")


if __name__ == "__main__":
    main()
