#!/usr/bin/env python3
"""Top-1 agreement through the draft, per pick position, against the
per-cell random floor: dev trio (F-dev, zero-shot) and MSH (F-full, the
frozen pass). Reads paper/data/pick_breakdowns.json (emitted by
scripts/eval_pick_breakdowns.py from cached predictions) and writes
pick_curves.pdf next to this script.

Headless by construction (Agg backend). No hand-typed numbers.

Usage: python3 paper/figures/pick_curves.py
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "pick_breakdowns.json"

SERIES = "#2563b0"
FLOOR = "#9ca3af"
INK = "#1f2430"
MUTED = "#6b7280"

PANELS = [
    ("BRO", "BRO (zero-shot)"),
    ("TMT", "TMT (zero-shot)"),
    ("SOS", "SOS (zero-shot)"),
    ("MSH.deployment", "MSH (frozen pass)"),
]


def main():
    data = json.loads(DATA.read_text())
    fig, axes = plt.subplots(1, 4, figsize=(9.6, 2.6), dpi=200,
                             sharey=True)
    for ax, (key, title) in zip(axes, PANELS):
        curve = data["sets"][key]["per_pick_curve"]
        picks_per_pack = max(r["pick_number"] for r in curve) + 1
        xs = [r["pack_number"] * picks_per_pack + r["pick_number"] + 1
              for r in curve]
        order = sorted(range(len(xs)), key=lambda i: xs[i])
        xs = [xs[i] for i in order]
        top1 = [100 * curve[i]["top1"] for i in order]
        floor = [100 * curve[i]["random_floor"] for i in order]

        for boundary in (picks_per_pack, 2 * picks_per_pack):
            ax.axvline(boundary + 0.5, color="#e5e7eb", lw=0.8, zorder=0)
        ax.plot(xs, floor, color=FLOOR, lw=1.1, ls="--", label="random floor")
        ax.plot(xs, top1, color=SERIES, lw=1.6, label="model")
        ax.set_title(title, fontsize=9, color=INK)
        ax.set_xlabel("pick", fontsize=8, color=MUTED)
        ax.tick_params(labelsize=7, colors=MUTED)
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
        for spine in ("left", "bottom"):
            ax.spines[spine].set_color(MUTED)

    axes[0].set_ylabel("top-1 agreement (%)", fontsize=8, color=MUTED)
    axes[0].set_ylim(0, 100)
    axes[0].legend(fontsize=7, frameon=False, loc="upper center")
    fig.tight_layout()
    out = HERE / "pick_curves.pdf"
    fig.savefig(out, bbox_inches="tight")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
