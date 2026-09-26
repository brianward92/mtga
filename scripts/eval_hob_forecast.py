#!/usr/bin/env python
"""Evaluate the sealed HOB P1P1 forecast on a frozen public draft snapshot.

See docs/hob_out_of_sample_protocol_20260919.md. Needs pandas, numpy, scipy,
and pyarrow (available together in .venv-embed). Never reruns or fits a model.
"""

import argparse
import csv
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import kendalltau, spearmanr

from mtga.lands.names import norm_17lands

SEALED_SHA = "a16c34767aa382e7703f480207f8480484e29ad22bbab2142aa2195e9b9a94a9"
RUNG = {
    g: i
    for i, g in enumerate(
        ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"]
    )
}
BASICS = {norm_17lands(n) for n in ["Plains", "Island", "Swamp", "Mountain", "Forest"]}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def software_versions():
    return {name: version(name) for name in ["numpy", "pandas", "scipy", "pyarrow"]}


def grade_value(raw):
    token = raw.split("/")[0].strip()
    if token in RUNG:
        return float(RUNG[token])
    if token == "SB":
        return None
    value = float(token)  # unknown tokens must fail, never silently drop
    if not np.isfinite(value):
        raise ValueError(f"nonfinite grade {raw}")
    return value


def aliases_for(names):
    aliases = {}
    for name in names:
        full = norm_17lands(name)
        for alias in [full, *[norm_17lands(s) for s in name.split(" // ")]]:
            if alias in aliases and aliases[alias] != full:
                raise ValueError(f"ambiguous name alias: {alias}")
            aliases[alias] = full
    return aliases


def load_forecasts(forecast, grades, nicolai):
    if sha256(forecast) != SEALED_SHA:
        raise ValueError("forecast bytes differ from the public HOB seal")
    model = pd.read_csv(forecast)
    aliases = aliases_for(model.name)
    sources = {
        "draftfm": {
            norm_17lands(r.name): float(r.score)
            for r in model.itertuples()
            if not r.display_only_basic
        }
    }
    exclusions = {}

    def add(source, name, grade):
        key = aliases[norm_17lands(name)]
        values = sources.setdefault(source, {})
        value = grade_value(grade)
        if value is None or key in BASICS:
            exclusions.setdefault(source, []).append({"name": name, "grade": grade})
        elif key in values:
            raise ValueError(f"duplicate forecast row: {source} {name}")
        else:
            values[key] = value

    with grades.open() as f:
        for row in csv.DictReader(f):
            add(row["source"], row["card_name"], row["grade"])
    if nicolai:
        with nicolai.open() as f:
            for row in csv.DictReader(f, delimiter="\t"):
                add("nicolai_bola", row["Card Name"], row["Card Grade"])
    return sources, aliases, exclusions


def load_picks(path):
    meta = {
        "draft_id",
        "draft_time",
        "pack_number",
        "pick_number",
        "pick",
        "user_n_games_bucket",
        "user_game_win_rate_bucket",
    }
    chunks = []
    total = 0
    for chunk in pd.read_csv(
        path,
        usecols=lambda c: c in meta or c.startswith("pack_card_"),
        chunksize=100000,
    ):
        total += len(chunk)
        chunks.append(chunk[(chunk.pack_number == 0) & (chunk.pick_number == 0)].copy())
    picks = pd.concat(chunks, ignore_index=True)
    if picks.empty or picks.draft_id.isna().any() or picks.draft_id.duplicated().any():
        raise ValueError("empty P1P1 population or missing/duplicate draft IDs")
    return picks, total


def evaluate_pack_scores(offered, picked, scores):
    """Coverage mask, fair tie credit, inclusive credit, and best-tie size."""
    known = np.isfinite(scores)
    eligible = ~np.any(offered & ~known[None, :], axis=1)
    n = offered.sum(axis=1)
    valid_pick = (picked >= 0) & (picked < offered.shape[1])
    safe_pick = np.clip(picked, 0, offered.shape[1] - 1)
    eligible &= valid_pick & offered[np.arange(len(picked)), safe_pick] & (n > 0)
    values = np.where(offered & known[None, :], scores[None, :], -np.inf)
    best = values.max(axis=1)
    winners = offered & known[None, :] & (values == best[:, None])
    ties = winners.sum(axis=1)
    hit = winners[np.arange(len(picked)), safe_pick] & valid_pick
    credit = np.divide(
        hit.astype(float), ties, out=np.zeros(len(picked)), where=ties > 0
    )
    return eligible, credit, hit.astype(float), ties


def pack_arrays(picks, aliases):
    """Resolve all pack columns exactly and remove only basic-land choices."""
    columns = [c for c in picks if c.startswith("pack_card_")]
    names = [aliases[norm_17lands(c[len("pack_card_") :])] for c in columns]
    if len(names) != len(set(names)):
        raise ValueError("duplicate normalized pack columns")
    keep = [i for i, n in enumerate(names) if n not in BASICS]
    names = [names[i] for i in keep]
    offered = picks[[columns[i] for i in keep]].to_numpy() > 0
    index = {n: i for i, n in enumerate(names)}
    picked = np.array([index.get(aliases.get(norm_17lands(n)), -1) for n in picks.pick])
    return names, offered, picked


def population_masks(picks):
    return {
        "all": np.ones(len(picks), dtype=bool),
        "expert": (
            (picks.user_n_games_bucket >= 100)
            & (picks.user_game_win_rate_bucket >= 0.55)
        ).to_numpy(),
    }


def paired_interval(delta, replicates=2000, seed=17):
    # One P1P1 per draft, verified in load_picks: row bootstrap = draft bootstrap.
    if len(delta) == 0:
        return [None, None]
    rng = np.random.default_rng(seed)
    means = []
    for start in range(0, replicates, 32):
        take = min(32, replicates - start)
        idx = rng.integers(0, len(delta), size=(take, len(delta)))
        means.extend(delta[idx].mean(axis=1))
    return np.quantile(means, [0.025, 0.975]).tolist()


def compare_rows(masks, results, random, sources, replicates):
    rows = []
    for population, mask in masks.items():
        for source in sorted(set(sources) - {"draftfm"}):
            eligible = mask & results["draftfm"][0] & results[source][0]
            n = int(eligible.sum())
            a, b = results["draftfm"][1][eligible], results[source][1][eligible]
            lo, hi = paired_interval(a - b, replicates)
            row = {
                "population": population,
                "source": source,
                "population_drafts": int(mask.sum()),
                "eligible_drafts": n,
                "excluded_drafts": int(mask.sum()) - n,
                "draftfm_accuracy": float(a.mean()) if n else None,
                "creator_accuracy": float(b.mean()) if n else None,
                "delta": float((a - b).mean()) if n else None,
                "delta_ci_low": lo,
                "delta_ci_high": hi,
                "random_accuracy": float(random[eligible].mean()) if n else None,
            }
            for key, src in [("draftfm", "draftfm"), ("creator", source)]:
                row[f"{key}_inclusive_accuracy"] = (
                    float(results[src][2][eligible].mean()) if n else None
                )
                row[f"{key}_mean_top_tie"] = (
                    float(results[src][3][eligible].mean()) if n else None
                )
            rows.append(row)
    return rows


def outcome_correlations(ratings_path, sources, aliases):
    outcomes = {}
    for row in json.loads(ratings_path.read_text()):
        key = aliases.get(norm_17lands(row["name"]))
        if key and key not in BASICS:
            if key in outcomes:
                raise ValueError(f"duplicate outcome row: {key}")
            outcomes[key] = row
    rows = []
    for outcome in ["gih_win_rate", "negative_average_taken_at"]:
        value = {}
        for name, r in outcomes.items():
            if outcome == "gih_win_rate":
                v = r.get("ever_drawn_win_rate")
                if r.get("ever_drawn_game_count", 0) < 200:
                    continue
            else:
                v = (
                    -r["avg_pick"]
                    if r.get("avg_pick") is not None and r.get("pick_count", 0) > 0
                    else None
                )
            if v is not None and np.isfinite(v):
                value[name] = v
        for source in sorted(set(sources) - {"draftfm"}):
            common = sorted(set(value) & set(sources[source]) & set(sources["draftfm"]))
            if len(common) < 3:
                continue
            y = [value[n] for n in common]
            row = {"outcome": outcome, "source": source, "matched_cards": len(common)}
            for key, src in [("draftfm", "draftfm"), ("creator", source)]:
                x = [sources[src][n] for n in common]
                row[key + "_spearman"] = float(spearmanr(x, y).statistic)
                row[key + "_kendall_tau_b"] = float(kendalltau(x, y).statistic)
            rows.append(row)
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ["forecast", "grades", "drafts", "ratings", "protocol", "out-dir"]:
        p.add_argument("--" + key, required=True, type=Path)
    p.add_argument("--nicolai", type=Path)
    p.add_argument("--bootstrap-replicates", type=int, default=2000)
    args = p.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    inputs = {
        key: {"path": str(path), "sha256": sha256(path)}
        for key in ["forecast", "grades", "drafts", "ratings", "protocol", "nicolai"]
        if (path := getattr(args, key)) is not None
    }
    for key in ["drafts", "ratings"]:
        sidecar = Path(str(getattr(args, key)) + ".meta.json")
        snapshot = json.loads(sidecar.read_text())
        if inputs[key]["sha256"] != snapshot["sha256"]:
            raise ValueError(f"{key} bytes differ from download snapshot")
        inputs[key]["download"] = snapshot
    sources, aliases, exclusions = load_forecasts(
        args.forecast, args.grades, args.nicolai
    )
    picks, total_rows = load_picks(args.drafts)
    names, offered, picked = pack_arrays(picks, aliases)
    results = {
        src: evaluate_pack_scores(
            offered, picked, np.array([values.get(n, np.nan) for n in names])
        )
        for src, values in sources.items()
    }
    n_offered = offered.sum(axis=1)
    random = np.divide(1.0, n_offered, out=np.zeros(len(picks)), where=n_offered > 0)
    masks = population_masks(picks)
    pairwise = compare_rows(masks, results, random, sources, args.bootstrap_replicates)
    # LR is explicitly a C/U-only source; every other archived source reviews
    # the full set. Shared eligibility still rejects all their SB/ungraded cards.
    broad = [s for s in sources if s != "limited_resources"]
    common_mask = np.logical_and.reduce([results[s][0] for s in broad])
    shared = compare_rows(
        {k: v & common_mask for k, v in masks.items()},
        results,
        random,
        broad,
        args.bootstrap_replicates,
    )
    correlations = outcome_correlations(args.ratings, sources, aliases)
    for name, rows in [
        ("pairwise_p1p1.csv", pairwise),
        ("shared_p1p1.csv", shared),
        ("outcome_correlations.csv", correlations),
    ]:
        pd.DataFrame(rows).to_csv(args.out_dir / name, index=False)
    prediction_rows = pd.DataFrame(
        {"draft_id": picks.draft_id, "expert": masks["expert"]}
    )
    for source, (eligible, credit, inclusive, ties) in results.items():
        prediction_rows[source + "_eligible"] = eligible
        prediction_rows[source + "_credit"] = credit
    prediction_rows.to_parquet(args.out_dir / "pick_scores.parquet", index=False)
    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "software": software_versions(),
        "inputs": inputs,
        "script_sha256": sha256(Path(__file__)),
        "raw_pick_rows": total_rows,
        "p1p1_drafts": len(picks),
        "expert_p1p1_drafts": int(masks["expert"].sum()),
        "draft_time_min": str(picks.draft_time.min()),
        "draft_time_max": str(picks.draft_time.max()),
        "forecast_coverage": {s: len(v) for s, v in sources.items()},
        "grade_exclusions": exclusions,
        "invalid_or_basic_human_picks": int((picked < 0).sum()),
        "shared_sources": broad,
        "shared_eligible_drafts": {
            k: int((v & common_mask).sum()) for k, v in masks.items()
        },
        "bootstrap": {
            "replicates": args.bootstrap_replicates,
            "seed": 17,
            "unit": "draft (one P1P1 each)",
            "interval": "95% percentile, marginal",
        },
        "pairwise": pairwise,
        "shared": shared,
        "outcome_correlations": correlations,
        "attribution": "Data from 17Lands.com (CC BY 4.0)",
        "outputs": {
            p.name: sha256(p)
            for p in sorted(args.out_dir.iterdir())
            if p.suffix in {".csv", ".parquet"}
        },
    }
    (args.out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, allow_nan=False) + "\n"
    )
    print(
        pd.DataFrame(shared)[
            [
                "population",
                "source",
                "eligible_drafts",
                "draftfm_accuracy",
                "creator_accuracy",
                "delta",
                "delta_ci_low",
                "delta_ci_high",
            ]
        ].to_string(index=False)
    )


if __name__ == "__main__":
    main()
