#!/usr/bin/env python
"""Why does BRO transfer worst? Two dev-trio-only sub-analyses for the
"Why BRO transfers worst" paragraph (paper/sections/analysis.tex).

Frozen-eval discipline: this script only reads F-dev's already-cached
zero-shot predictions (mtga/foundation/predict.py output) and BRO's curated
draft/card-feature parquets. It never re-runs a model and never touches MSH.

  A. Per-(pack,pick) curve comparison: evalproto.per_pick_curve on BRO vs
     TMT/SOS (expert slice, same F-dev run), to see whether BRO's shortfall
     is spread uniformly across the draft or concentrated in specific
     picks/packs.
  B. Bonus-sheet-slice accuracy: identify BRO's 63-card BRR retro-artifact
     bonus sheet, flag every scored pick in BRO's curated draft data by
     whether its pack contained >= 1 bonus-sheet card, join that flag onto
     F-dev's BRO zero-shot predictions, and compare top-1 (expert slice,
     cluster-bootstrap CI) between bonus-present and bonus-absent packs.

Usage:
  .venv-ml/bin/python scripts/eval_bro_transfer_analysis.py \
      --run /opt/bward/dat/mtga/foundation/runs/20260704_135822_f_dev \
      [--out /tmp/bro_transfer_report.json]
"""

import argparse
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from mtga.foundation import evalproto
from mtga.lands import paths

DEV_SETS = ["BRO", "TMT", "SOS"]


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True,
                        help="F-dev run dir (contains zeroshot/*.parquet)")
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--out", default=None, help="optional json report path")
    return parser


def load_expert_frames(run_dir, fmt):
    """{set: (raw_frame, expert_frame)} for BRO/TMT/SOS from one F-dev run."""
    out = {}
    for set_code in DEV_SETS:
        path = Path(run_dir) / "zeroshot" / f"{set_code}.{fmt}.parquet"
        frame = pd.read_parquet(path)
        evalproto.validate(frame)
        out[set_code] = (frame, evalproto.expert_slice(frame))
    return out


# -- A: per-(pack,pick) curve comparison -------------------------------------

def _nanwavg(values, weights):
    """Weighted mean skipping (value, weight) pairs where either is NaN.

    BRO's packs carry one more pick than TMT/SOS's (15 vs. 14 -- see
    module docstring / prose: pick_number == 14 is always pack_size == 1,
    i.e. a genuine extra, forced, last-card slot, consistent with a bonus
    sheet enlarging the pack), so the outer-joined (pack, pick) grid has
    rows where a TMT/SOS cell has no BRO counterpart or vice versa.
    np.average would silently propagate those to NaN for the whole
    aggregate; this drops them from that one aggregate's weighting only.
    """
    values = np.asarray(values, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    mask = ~(np.isnan(values) | np.isnan(weights))
    if not mask.any():
        return float("nan")
    return float(np.average(values[mask], weights=weights[mask]))


def curve_comparison(experts):
    """Wide per-(pack,pick) table of BRO/TMT/SOS top-1 plus the BRO gap
    against the TMT/SOS mean, and per-pack / trend aggregates of that gap.

    BRO's booster carries one more card than TMT/SOS's (15 vs. 14 --
    pick_number == 14 is BRO-only and always pack_size == 1, i.e. a real
    extra forced last slot; per_pick_curve's own `random_floor` column
    confirms pack_size(pick_number) runs one higher for BRO at every
    pick_number: 15-pick_number vs. 14-pick_number). Comparing raw top-1 at
    the same raw pick_number is therefore NOT apples-to-apples late in the
    pack: at pick_number 13, TMT/SOS are already down to a forced 1-card
    "pick" (top1 pinned at 1.0) while BRO still has a genuine 2-candidate
    choice -- inflating the naive top1 gap for reasons that have nothing to
    do with card content. `lift` = top1 - random_floor (accuracy in excess
    of chance) is reported alongside the raw gap for this reason; the
    within-pack trend should be read off `lift_gap`, not `gap`.
    """
    curves = {s: evalproto.per_pick_curve(experts[s]) for s in DEV_SETS}

    wide = curves["BRO"][["pack_number", "pick_number", "top1", "random_floor", "n"]].rename(
        columns={"top1": "top1_bro", "random_floor": "floor_bro", "n": "n_bro"})
    for s in ("TMT", "SOS"):
        c = curves[s][["pack_number", "pick_number", "top1", "random_floor", "n"]].rename(
            columns={"top1": f"top1_{s.lower()}", "random_floor": f"floor_{s.lower()}",
                     "n": f"n_{s.lower()}"})
        wide = wide.merge(c, on=["pack_number", "pick_number"], how="outer")
    wide = wide.sort_values(["pack_number", "pick_number"]).reset_index(drop=True)
    wide["top1_tmtsos_mean"] = wide[["top1_tmt", "top1_sos"]].mean(axis=1)
    wide["gap"] = wide["top1_tmtsos_mean"] - wide["top1_bro"]
    wide["lift_bro"] = wide["top1_bro"] - wide["floor_bro"]
    wide["lift_tmt"] = wide["top1_tmt"] - wide["floor_tmt"]
    wide["lift_sos"] = wide["top1_sos"] - wide["floor_sos"]
    wide["lift_tmtsos_mean"] = wide[["lift_tmt", "lift_sos"]].mean(axis=1)
    wide["lift_gap"] = wide["lift_tmtsos_mean"] - wide["lift_bro"]

    per_pack = wide.groupby("pack_number").apply(
        lambda g: pd.Series({
            "mean_top1_bro": _nanwavg(g["top1_bro"], g["n_bro"]),
            "mean_top1_tmtsos": _nanwavg(
                g["top1_tmtsos_mean"], (g["n_tmt"].fillna(0) + g["n_sos"].fillna(0)) / 2),
            "mean_gap": _nanwavg(
                g["gap"],
                (g["n_bro"].fillna(0) + g["n_tmt"].fillna(0) + g["n_sos"].fillna(0)) / 3),
            "mean_lift_gap": _nanwavg(
                g["lift_gap"],
                (g["n_bro"].fillna(0) + g["n_tmt"].fillna(0) + g["n_sos"].fillna(0)) / 3),
            "n_cells": len(g),
            "n_cells_comparable": int(g["gap"].notna().sum()),
        }), include_groups=False,
    ).reset_index()

    def _corr(g, col):
        g = g.dropna(subset=[col])
        return float(g["pick_number"].corr(g[col])) if len(g) > 2 else float("nan")

    trend_by_pack, lift_trend_by_pack = {}, {}
    for pack, g in wide.groupby("pack_number"):
        trend_by_pack[int(pack)] = _corr(g, "gap")
        lift_trend_by_pack[int(pack)] = _corr(g, "lift_gap")
    overall_corr = _corr(wide, "gap")
    overall_lift_corr = _corr(wide, "lift_gap")

    return {"cells": wide, "per_pack": per_pack,
            "gap_pick_corr_by_pack": trend_by_pack,
            "gap_pick_corr_overall": overall_corr,
            "lift_gap_pick_corr_by_pack": lift_trend_by_pack,
            "lift_gap_pick_corr_overall": overall_lift_corr}


# -- B: bonus-sheet-slice accuracy -------------------------------------------

def bro_bonus_sheet_names():
    """Canonical 63-name BRR retro-artifact bonus-sheet list (raw Scryfall
    printings, set == 'brr'), cross-checked against BRO's curated vocab.

    Filtering cardfeats_v1.parquet's *resolved* 'set' column for 'brr' (the
    naive first thing to try) badly undercounts: featurize.resolve_names
    prefers a name's newest PAPER printing over an in-expansion one whenever
    the in-expansion set isn't in the caller's `prefer` set, and BRO-only
    feature builds only prefer 'bro', never 'brr'. Most of the 63 retro
    artifacts have since been reprinted in a later product, so cardfeats
    resolves them to that later set instead of 'brr' -- only 31/63 survive
    a naive `set == 'brr'` filter there. The raw per-printing Scryfall table
    (pre-resolution) is required to recover the true 63.
    """
    cards = pd.read_parquet(paths.SCRYFALL_CARDS_PARQUET, columns=["name", "set"])
    brr_names = sorted(set(cards.loc[cards["set"].str.lower() == "brr", "name"]))
    if len(brr_names) != 63:
        raise RuntimeError(f"expected 63 raw BRR printings, found {len(brr_names)}")

    vocab = json.loads(paths.vocab_path("BRO", "PremierDraft").read_text())
    vocab_names = set(vocab["names"])
    missing = [n for n in brr_names if n not in vocab_names]
    if missing:
        raise RuntimeError(f"BRR names absent from BRO's curated vocab: {missing}")

    feats = pd.read_parquet(paths.CARDFEATS_PARQUET, columns=["name_display", "set"])
    cardfeats_brr = sorted(set(feats.loc[feats["set"] == "brr", "name_display"]))

    return brr_names, cardfeats_brr


def bro_pack_bonus_flags(bonus_names):
    """(draft_id, pack_number, pick_number, has_bonus) for every scored BRO
    pick; has_bonus = the pack offered >= 1 BRR bonus-sheet card."""
    parquet = paths.curated_path("draft", "BRO", "PremierDraft")
    con = duckdb.connect()
    all_cols = con.execute(
        f"DESCRIBE SELECT * FROM '{parquet}' LIMIT 0").df()["column_name"]
    name_set = set(bonus_names)
    pack_cols = [c for c in all_cols
                if c.startswith("pack_card_") and c[len("pack_card_"):] in name_set]
    found = {c[len("pack_card_"):] for c in pack_cols}
    if found != name_set:
        raise RuntimeError(
            f"missing pack_card_ columns for bonus names: {name_set - found}")
    sum_expr = " + ".join(f'"{c}"' for c in pack_cols)
    query = f"""
        SELECT draft_id, pack_number, pick_number,
               ({sum_expr}) > 0 AS has_bonus
        FROM '{parquet}'
        WHERE pick_index >= 0
    """
    frame = con.execute(query).df()
    con.close()
    return frame


def bonus_slice_accuracy(bro_expert, bonus_flags):
    keys = ["draft_id", "pack_number", "pick_number"]
    merged = bro_expert.merge(bonus_flags, on=keys, how="inner")
    if len(merged) != len(bro_expert):
        raise RuntimeError(
            f"(draft_id, pack_number, pick_number) join dropped rows: "
            f"{len(bro_expert)} -> {len(merged)}")

    out = {}
    for label, frame in [("bonus_present", merged[merged["has_bonus"]]),
                         ("bonus_absent", merged[~merged["has_bonus"]])]:
        point, lo, hi = evalproto.cluster_bootstrap(frame, evalproto.top1)
        out[label] = {"top1": point, "ci": [lo, hi], "n_picks": len(frame),
                      "n_drafts": int(frame["draft_id"].nunique()),
                      "frac_of_picks": len(frame) / len(merged)}
    return out, merged


def pick_number_confound(merged):
    """How strongly has_bonus proxies pick depth: rate by pick_number plus
    each side's mean pick_number (BRO's booster carries exactly one BRR
    card, so a pack can only "have the bonus card" before it's been picked
    away -- has_bonus falls monotonically across the pack by construction,
    not by any property of the cards themselves)."""
    rate_by_pick = merged.groupby("pick_number")["has_bonus"].mean()
    mean_pick_present = merged.loc[merged["has_bonus"], "pick_number"].mean()
    mean_pick_absent = merged.loc[~merged["has_bonus"], "pick_number"].mean()
    return {
        "has_bonus_rate_by_pick_number": {
            int(k): float(v) for k, v in rate_by_pick.items()},
        "mean_pick_number_present": float(mean_pick_present),
        "mean_pick_number_absent": float(mean_pick_absent),
    }


def stratified_bonus_gap(frame):
    """bonus_absent - bonus_present top-1 gap, stratified by pick_number and
    weighted by each stratum's bonus_present count.

    has_bonus is a near-deterministic proxy for pick depth (see
    pick_number_confound), so the raw pooled gap in bonus_slice_accuracy
    mostly measures "early picks are mechanically harder," not a bonus-sheet
    effect. This holds pick depth fixed within each stratum before averaging,
    so the residual gap approximates the effect at matched pick depth. Takes
    a single frame (for evalproto.cluster_bootstrap's stat_fn contract).
    """
    total_w = 0.0
    total = 0.0
    for _, g in frame.groupby("pick_number"):
        present = g["has_bonus"]
        n_present = int(present.sum())
        n_absent = int((~present).sum())
        if n_present == 0 or n_absent == 0:
            continue
        top1_present = (g.loc[present, "target_rank"] == 1).mean()
        top1_absent = (g.loc[~present, "target_rank"] == 1).mean()
        total += (top1_absent - top1_present) * n_present
        total_w += n_present
    return total / total_w if total_w > 0 else float("nan")


# -- reporting ----------------------------------------------------------------

def main():
    args = create_parser().parse_args()
    experts_raw = load_expert_frames(args.run, args.format)
    experts = {s: e for s, (raw, e) in experts_raw.items()}

    headline = {}
    for s in DEV_SETS:
        point, lo, hi = evalproto.cluster_bootstrap(experts[s], evalproto.top1)
        headline[s] = {"top1": point, "ci": [lo, hi], "n_picks": len(experts[s])}
    trio_mean_other = (headline["TMT"]["top1"] + headline["SOS"]["top1"]) / 2
    gap_vs_others = trio_mean_other - headline["BRO"]["top1"]
    print("== headline (expert slice, F-dev zero-shot) ==")
    for s in DEV_SETS:
        h = headline[s]
        print(f"  {s}: top1={h['top1']:.4f} (CI {h['ci'][0]:.4f}-"
              f"{h['ci'][1]:.4f}) n={h['n_picks']:,}")
    print(f"  BRO gap vs mean(TMT,SOS): {gap_vs_others:.4f} "
          f"({100 * gap_vs_others:.1f}pp)")

    print("\n== A: per-(pack,pick) curve comparison ==")
    curve = curve_comparison(experts)
    print(curve["per_pack"].to_string(index=False))
    print("raw-top1 gap~pick_number corr within pack:", curve["gap_pick_corr_by_pack"])
    print("raw-top1 gap~pick_number corr overall:", curve["gap_pick_corr_overall"])
    print("lift-over-floor gap~pick_number corr within pack (corrects for BRO's "
          "15-card vs. TMT/SOS's 14-card pack):", curve["lift_gap_pick_corr_by_pack"])
    print("lift-over-floor gap~pick_number corr overall:", curve["lift_gap_pick_corr_overall"])

    print("\n== B: bonus-sheet-slice accuracy ==")
    brr_names, cardfeats_brr_names = bro_bonus_sheet_names()
    print(f"BRR bonus-sheet names: {len(brr_names)} (raw Scryfall 'brr' printings, "
          f"all present in BRO's curated vocab)")
    print(f"cardfeats-derived 'set==brr' names: {len(cardfeats_brr_names)} "
          f"(undercount vs. the true {len(brr_names)}, see docstring)")

    bonus_flags = bro_pack_bonus_flags(brr_names)
    bonus_result, merged = bonus_slice_accuracy(experts["BRO"], bonus_flags)
    for label in ("bonus_present", "bonus_absent"):
        b = bonus_result[label]
        print(f"  {label}: top1={b['top1']:.4f} (CI {b['ci'][0]:.4f}-{b['ci'][1]:.4f}) "
              f"n_picks={b['n_picks']:,} ({100 * b['frac_of_picks']:.1f}% of picks) "
              f"n_drafts={b['n_drafts']:,}")
    diff = bonus_result["bonus_absent"]["top1"] - bonus_result["bonus_present"]["top1"]
    print(f"  bonus_absent - bonus_present top1: {diff:.4f} ({100 * diff:.1f}pp)")

    print("\n== B.1: pick-depth confound in has_bonus ==")
    confound = pick_number_confound(merged)
    print(f"  mean pick_number: present={confound['mean_pick_number_present']:.2f} "
          f"absent={confound['mean_pick_number_absent']:.2f}")
    print(f"  has_bonus rate by pick_number: {confound['has_bonus_rate_by_pick_number']}")

    print("\n== B.2: pick-number-stratified bonus gap (corrects the B confound) ==")
    strat_point, strat_lo, strat_hi = evalproto.cluster_bootstrap(
        merged, stratified_bonus_gap)
    print(f"  stratified bonus_absent - bonus_present top1: {strat_point:.4f} "
          f"(CI {strat_lo:.4f}-{strat_hi:.4f}) ({100 * strat_point:.1f}pp), "
          f"vs. raw pooled {100 * diff:.1f}pp")

    report = {
        "run": str(args.run),
        "headline": headline,
        "gap_vs_others": gap_vs_others,
        "pick_number_confound": confound,
        "bonus_slice_stratified_gap": {
            "point": strat_point, "ci": [strat_lo, strat_hi]},
        "per_pack": curve["per_pack"].to_dict(orient="records"),
        "gap_pick_corr_by_pack": curve["gap_pick_corr_by_pack"],
        "gap_pick_corr_overall": curve["gap_pick_corr_overall"],
        "lift_gap_pick_corr_by_pack": curve["lift_gap_pick_corr_by_pack"],
        "lift_gap_pick_corr_overall": curve["lift_gap_pick_corr_overall"],
        "brr_names_raw_scryfall": brr_names,
        "brr_names_cardfeats_undercount": cardfeats_brr_names,
        "bonus_slice": bonus_result,
        "bonus_absent_minus_present_top1": diff,
    }
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2, default=str))
        print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
