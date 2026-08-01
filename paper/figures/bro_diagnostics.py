#!/usr/bin/env python3
"""BRO bonus-sheet diagnostic: zero-shot top-1 with vs. without a bonus-sheet
card in the pack.

Reads the tracked paper/data/bro_diagnostics.json mirror (emitted from
scripts/eval_bro_transfer_analysis.py output) and writes bro_diagnostics.pdf
next to this script. Headless by construction (Agg backend). No hand-typed
numbers.

Usage: python3 paper/figures/bro_diagnostics.py [--report PATH]
"""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_REPORT = HERE.parent / "data" / "bro_diagnostics.json"

BAR = "#2563b0"
INK = "#1f2430"
MUTED = "#6b7280"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = ap.parse_args()

    report = json.loads(Path(args.report).read_text())
    bonus = report["bonus_slice"]
    strat = report["bonus_slice_stratified_gap"]
    labels = ["bonus-sheet\npresent\n(early picks)", "bonus-sheet\nabsent\n(late picks)"]
    keys = ["bonus_present", "bonus_absent"]
    ys = [100 * bonus[k]["top1"] for k in keys]
    los = [100 * bonus[k]["top1"] - 100 * bonus[k]["ci"][0] for k in keys]
    his = [100 * bonus[k]["ci"][1] - 100 * bonus[k]["top1"] for k in keys]
    ns = [bonus[k]["n_picks"] for k in keys]

    fig, ax = plt.subplots(figsize=(3.2, 3.0), dpi=200)
    xs = [0, 1]
    ax.bar(xs, ys, width=0.55, color=BAR, yerr=[los, his], capsize=4,
           error_kw={"lw": 1.2, "ecolor": INK})
    for x, y, n in zip(xs, ys, ns):
        ax.annotate(f"{y:.1f}%\n(n={n:,})", xy=(x, y), xytext=(0, 8),
                    textcoords="offset points", ha="center", fontsize=7.5,
                    color=INK)

    ax.set_xticks(xs)
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("BRO zero-shot expert top-1 (%)", fontsize=8)
    ax.set_ylim(0, max(ys) + 20)

    diff = 100 * (bonus["bonus_absent"]["top1"] - bonus["bonus_present"]["top1"])
    strat_pt = 100 * strat["point"]
    strat_lo, strat_hi = 100 * strat["ci"][0], 100 * strat["ci"][1]
    ax.annotate(
        f"{diff:.1f}pp raw gap\n{strat_pt:.1f}pp pick-depth-adjusted\n"
        f"(CI {strat_lo:.1f}-{strat_hi:.1f})",
        xy=(0.5, max(ys) + 8), xycoords=("axes fraction", "data"),
        ha="center", va="bottom", fontsize=7.5, color=MUTED)

    ax.grid(True, axis="y", color="#e5e7eb", lw=0.6, zorder=0)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#c9ced6")
    ax.tick_params(labelsize=7.5, color="#c9ced6", labelcolor=INK)

    fig.tight_layout()
    out = HERE / "bro_diagnostics.pdf"
    fig.savefig(out, metadata={"CreationDate": None, "ModDate": None})
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
