#!/usr/bin/env python3
"""Characterize the scaling-ladder curve shape (paper Fig. scaling / Table tab:scaling).

Reads paper/figures/scaling_data.json (the same machine-readable source
scaling_curve.py plots from -- emitted by make_paper_tables.py from run
records, never hand-typed) and fits dev-mean zero-shot top-1 as a log-linear
function of training picks across the nested ladder (S1, S2, S4, S8, S16,
S27/F-dev). Reports slope (pp per doubling of training picks), intercept,
R^2, and per-segment doubling-normalized deltas, so the "scaling-curve shape"
claim in results.tex traces to a script rather than an eyeballed table read.

Usage: python3 scripts/analyze_scaling_shape.py
"""

import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "paper" / "figures" / "scaling_data.json"

MAIN_LADDER = ["S1", "S2", "S4", "S8", "S16", "S27"]


def fit_loglinear(xs, ys):
    """OLS fit y = a + b*x; returns (slope, intercept, r2)."""
    n = len(xs)
    xbar = sum(xs) / n
    ybar = sum(ys) / n
    sxy = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys))
    sxx = sum((x - xbar) ** 2 for x in xs)
    b = sxy / sxx
    a = ybar - b * xbar
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - ybar) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot
    return a, b, r2, [(y - (a + b * x)) for x, y in zip(xs, ys)]


def main():
    data = json.loads(DATA.read_text())
    rungs = {r["rung"]: r for r in data["rungs"]}
    ladder = [rungs[name] for name in MAIN_LADDER if name in rungs]

    xs = [math.log2(r["train_picks"] / 1e6) for r in ladder]
    ys = [100 * r["dev_mean_top1"] for r in ladder]
    names = [r["rung"] for r in ladder]

    a, b, r2, resid = fit_loglinear(xs, ys)
    print("Log-linear fit: dev_mean_top1(%) = "
          f"{a:.3f} + {b:.3f} * log2(train_picks_M)")
    print(f"  slope = {b:.3f} pp per doubling of training picks")
    print(f"  R^2   = {r2:.4f}  (n={len(xs)} nested-ladder rungs, "
          f"{MAIN_LADDER[0]}..{MAIN_LADDER[-1]})")
    print()
    print(f"{'rung':6}{'picks(M)':>12}{'top1(%)':>10}{'fit(%)':>10}{'resid(pp)':>12}")
    for name, r, x, y, e in zip(names, ladder, xs, ys, resid):
        fit_y = a + b * x
        print(f"{name:6}{r['train_picks']/1e6:12.1f}{y:10.2f}{fit_y:10.2f}{e:12.3f}")

    print()
    print("Per-segment doublings-normalized delta (raw pp / log2 picks ratio):")
    for (n0, r0), (n1, r1) in zip(list(zip(names, ladder))[:-1],
                                   list(zip(names, ladder))[1:]):
        dbl = math.log2(r1["train_picks"] / r0["train_picks"])
        dy = 100 * (r1["dev_mean_top1"] - r0["dev_mean_top1"])
        print(f"  {n0}->{n1}: +{dy:.2f}pp over {dbl:.3f} doublings "
              f"= {dy/dbl:.3f} pp/doubling")


if __name__ == "__main__":
    main()
