#!/usr/bin/env python
"""Skill-band and per-pick breakdowns from CACHED prediction parquets.

Two post-hoc analyses of already-cached per-pick prediction files (the
protocol's contract: models are never re-run during analysis, and every
statistic is computed from cached predictions):

  1. Skill bands: top-1 agreement split by the drafter's 17Lands win-rate
     bucket -- bottom (< 0.50), middle (0.50 to < 0.55), top (>= 0.55).
     Bands partition whole drafts (a draft carries one bucket), so the
     frozen cluster bootstrap applies unchanged. The top band is the
     paper's high-win-rate population WITHOUT the >= 100-games condition,
     so it is close to, but not identical to, the headline slice.
  2. Per-(pack, pick) curves: top-1 and the per-cell random floor at every
     pick position (evalproto.per_pick_curve, frozen).

Inputs (cached artifacts only; nothing is re-run, MSH is never re-scored):
  <f_dev run>/zeroshot/{BRO,TMT,SOS}.PremierDraft.parquet   deployment mode
  <frozen_eval>/<msh_sha>/f-full.deployment.parquet          deployment mode
  <frozen_eval>/<msh_sha>/f-full.human.parquet               human mode

Output: paper/data/pick_breakdowns.json (consumed by
scripts/make_paper_tables.py and paper/figures/pick_curves.py).

Usage:
  .venv-ml/bin/python scripts/eval_pick_breakdowns.py [--out PATH]
"""

import argparse
import datetime
import json
from pathlib import Path

import pandas as pd

from mtga.foundation import evalproto

REPO = Path(__file__).resolve().parents[1]

FDEV_RUN = "20260704_135822_f_dev"
FDEV_ZEROSHOT = Path(
    f"/opt/bward/dat/mtga/foundation/runs/{FDEV_RUN}/zeroshot")
MSH_SHA = "013df16b8994534f69ed63c87ab684acafc5f4cbe82982264b0fc111dbb2183a"
MSH_DIR = Path(f"/opt/bward/dat/mtga/foundation/frozen_eval/{MSH_SHA}")

DEV_SETS = ["BRO", "TMT", "SOS"]

# Bands partition drafts by the platform-provided win-rate bucket. The top
# cut matches evalproto.EXPERT_WR_BUCKET so the top band aligns with the
# paper's high-win-rate threshold (games condition deliberately not applied:
# bands answer "which players does the model match", not "the headline").
BANDS = [
    ("bottom", 0.00, 0.50),
    ("middle", 0.50, evalproto.EXPERT_WR_BUCKET),
    ("top", evalproto.EXPERT_WR_BUCKET, 1.01),
]


def band_rows(frame):
    """[{band, lo, hi, n_picks, n_drafts, top1, top1_ci}] for one frame."""
    out = []
    known = frame[frame["wr_bucket"].notna()]
    for name, lo, hi in BANDS:
        sub = known[(known["wr_bucket"] >= lo) & (known["wr_bucket"] < hi)]
        point, ci_lo, ci_hi = evalproto.cluster_bootstrap(sub, evalproto.top1)
        out.append({
            "band": name, "wr_lo": lo, "wr_hi": hi,
            "n_picks": int(len(sub)),
            "n_drafts": int(sub["draft_id"].nunique()),
            "top1": point, "top1_ci": [ci_lo, ci_hi],
        })
    return out


def curve_rows(frame):
    """evalproto.per_pick_curve as plain records (pack/pick 0-indexed)."""
    curve = evalproto.per_pick_curve(frame)
    return [
        {"pack_number": int(r.pack_number), "pick_number": int(r.pick_number),
         "top1": float(r.top1), "random_floor": float(r.random_floor),
         "n": int(r.n)}
        for r in curve.itertuples()
    ]


def analyze(frame, label):
    evalproto.validate(frame)
    print(f"{label}: {len(frame):,} picks, "
          f"{frame['draft_id'].nunique():,} drafts")
    return {"skill_bands": band_rows(frame), "per_pick_curve": curve_rows(frame)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(
        REPO / "paper" / "data" / "pick_breakdowns.json"))
    args = parser.parse_args()

    result = {
        "_comment": (
            "Post-hoc breakdowns of cached prediction parquets (no model "
            "re-runs; MSH never re-scored). Emitted by "
            "scripts/eval_pick_breakdowns.py; consumed by "
            "scripts/make_paper_tables.py and paper/figures/pick_curves.py."),
        "bands": [
            {"band": n, "wr_lo": lo, "wr_hi": hi} for n, lo, hi in BANDS],
        "sources": {
            "dev": {"run": FDEV_RUN, "mode": "deployment",
                    "dir": str(FDEV_ZEROSHOT)},
            "msh": {"member": "f-full", "snapshot_sha": MSH_SHA,
                    "dir": str(MSH_DIR)},
        },
        "sets": {},
        "executed_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }

    for set_code in DEV_SETS:
        frame = pd.read_parquet(
            FDEV_ZEROSHOT / f"{set_code}.PremierDraft.parquet")
        result["sets"][set_code] = {
            "mode": "deployment", "source_run": FDEV_RUN,
            **analyze(frame, f"{set_code} (F-dev deployment)"),
        }

    for mode in ("deployment", "human"):
        frame = pd.read_parquet(MSH_DIR / f"f-full.{mode}.parquet")
        result["sets"][f"MSH.{mode}"] = {
            "mode": mode, "source_run": f"frozen_eval/{MSH_SHA[:12]}",
            **analyze(frame, f"MSH (F-full {mode})"),
        }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
