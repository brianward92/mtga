#!/usr/bin/env python3
"""Scaling curve (the money plot): dev-trio-mean expert top-1 vs training data.

Reads paper/figures/scaling_data.json (emitted by scripts/make_paper_tables.py
from run records + zeroshot summaries) and writes scaling_curve.pdf next to
it. Rungs whose zero-shot eval has not run yet are skipped automatically, so
the figure grows as summary.json files land — no code edits.

Headless by construction (Agg backend). No hand-typed numbers: every plotted
value comes from scaling_data.json.
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent

SERIES = "#2563b0"  # single data series: one saturated, CVD-safe blue
PROBE_FACE = "white"  # probe rungs: open markers, same hue
REFERENCE = "#6b7280"  # published anchors: recessive gray, labeled directly
CEILING = "#9ca3af"
INK = "#1f2430"
MUTED = "#6b7280"

MAIN_LADDER = ["S1", "S2", "S4", "S8", "S16", "S27"]
PROBES = ["S2b", "S4b"]


def main():
    data = json.loads((HERE / "scaling_data.json").read_text())
    rungs = {r["rung"]: r for r in data["rungs"]}

    def points(names):
        out = []
        for name in names:
            r = rungs.get(name)
            if r and r["train_picks"] and r["dev_mean_top1"] is not None:
                out.append((r["train_picks"] / 1e6, 100 * r["dev_mean_top1"], name))
        return out

    ladder = points(MAIN_LADDER)
    probes = points(PROBES)

    fig, ax = plt.subplots(figsize=(5.2, 3.4), dpi=200)

    # Published anchors: recessive dashed rules with direct labels (identity
    # never rides on color alone).
    anchors = data["anchors"]
    styles = {"bertram": (0, (5, 3)), "expert_tuned": (0, (2, 2)), "gpt4o": (0, (1, 2))}
    # Label placement avoids collisions between close anchors (44.5 vs 43).
    placement = {"gpt4o": {"x": 0.0, "ha": "left", "va": "top", "offset": (4, -3)}}
    for key, spec in anchors.items():
        y = 100 * spec["top1"]
        ax.axhline(
            y, color=REFERENCE, lw=1.0, linestyle=styles.get(key, "--"), zorder=1
        )
        place = placement.get(
            key, {"x": 1.0, "ha": "right", "va": "bottom", "offset": (-4, 3)}
        )
        ax.annotate(
            spec["label"],
            xy=(place["x"], y),
            xycoords=("axes fraction", "data"),
            xytext=place["offset"],
            textcoords="offset points",
            ha=place["ha"],
            va=place["va"],
            fontsize=6.5,
            color=MUTED,
        )
    ceiling = 100 * data["ceiling_dev_mean"]
    ax.axhline(ceiling, color=CEILING, lw=1.0, linestyle=(0, (7, 2)), zorder=1)
    ax.annotate(
        "within-set supervised reference (dev mean)",
        xy=(1.0, ceiling),
        xycoords=("axes fraction", "data"),
        xytext=(-4, 3),
        textcoords="offset points",
        ha="right",
        va="bottom",
        fontsize=6.5,
        color=MUTED,
    )

    # Main ladder: one series, thin line, direct rung labels.
    if ladder:
        xs, ys, names = zip(*ladder)
        ax.plot(
            xs, ys, "-o", color=SERIES, lw=2.0, ms=5.5, mec=SERIES, mfc=SERIES, zorder=3
        )
        for x, y, name in ladder:
            ax.annotate(
                name,
                xy=(x, y),
                xytext=(0, -11),
                textcoords="offset points",
                ha="center",
                fontsize=7,
                color=INK,
            )
    # Probe rungs (set-composition variance): open markers, same hue.
    if probes:
        xs, ys, names = zip(*probes)
        ax.plot(xs, ys, "o", color=SERIES, ms=5.5, mew=1.6, mfc=PROBE_FACE, zorder=3)
        for x, y, name in probes:
            ax.annotate(
                name,
                xy=(x, y),
                xytext=(0, 7),
                textcoords="offset points",
                ha="center",
                fontsize=7,
                color=MUTED,
            )

    ax.set_xscale("log")
    ax.set_xlabel("training picks (millions, log scale)", fontsize=8)
    ax.set_ylabel("dev-mean expert top-1 (%)", fontsize=8)

    ys_all = (
        [y for _, y, _ in ladder]
        + [y for _, y, _ in probes]
        + [100 * s["top1"] for s in anchors.values()]
        + [ceiling]
    )
    ax.set_ylim(min(ys_all) - 3, max(ys_all) + 4)
    xs_all = [x for x, _, _ in ladder] + [x for x, _, _ in probes] or [1, 200]
    ax.set_xlim(min(xs_all) / 2.2, max(xs_all) * 2.2)

    ax.grid(True, axis="y", color="#e5e7eb", lw=0.6, zorder=0)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#c9ced6")
    ax.tick_params(labelsize=7.5, color="#c9ced6", labelcolor=INK)

    fig.tight_layout()
    out = HERE / "scaling_curve.pdf"
    fig.savefig(out, metadata={"CreationDate": None, "ModDate": None})
    print(f"wrote {out} ({len(ladder)} ladder + {len(probes)} probe points)")


if __name__ == "__main__":
    main()
