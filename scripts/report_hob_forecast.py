#!/usr/bin/env python
"""Build the factual HOB follow-up note, aggregate tables, and article figure."""

import argparse
import copy
import json
from pathlib import Path
import shutil

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

LABELS = {
    "draftfm": "DraftFM, sealed prerelease",
    "limited_level_ups": "Limited Level-Ups (Marc Anderson)",
    "nicolai_bola": "NicolaiBolas",
    "nizzahon": "Nizzahon",
    "cardgamebase": "Card Game Base (Anže Mlakar)",
    "draftsim_pickorder": "Draftsim app pick order",
    "draftsim_review": "Draftsim review (Andrew Quinn)",
    "limited_resources": "Limited Resources, C/U review",
    "hob_fitted": "HOB-trained choice model, out-of-fold",
    "random": "Uniform random",
}


def portable(summary):
    summary = copy.deepcopy(summary)
    for value in summary["inputs"].values():
        value["path"] = Path(value["path"]).name
    return summary


def pct(value):
    return f"{100 * value:.2f}%"


def plot(table, path):
    fig, ax = plt.subplots(figsize=(10.5, 6.5))
    y = np.arange(len(table))
    ax.hlines(
        y, table.all_players * 100, table.expert * 100, color="#c9d1d9", linewidth=2
    )
    ax.scatter(
        table.all_players * 100,
        y,
        color="#85929e",
        s=45,
        label="All players (41,093 drafts)",
        zorder=3,
    )
    ax.scatter(
        table.expert * 100,
        y,
        color="#176b92",
        s=65,
        label="Experienced winning players (6,493 drafts)",
        zorder=4,
    )
    for i, row in enumerate(table.itertuples()):
        ax.text(
            max(row.expert, row.all_players) * 100 + 1.2,
            i,
            f"{100 * row.expert:.1f}%",
            va="center",
            fontsize=10,
            color="#176b92",
        )
    ax.set_yticks(y, table.label)
    ax.invert_yaxis()
    ax.set_xlim(0, 80)
    ax.set_xlabel("P1P1 agreement, with fractional credit for tied top grades (%)")
    ax.set_title(
        "Hobbit: sealed forecasts meet actual first picks",
        loc="left",
        fontsize=15,
        pad=18,
    )
    ax.grid(axis="x", color="#e7ebef")
    ax.set_axisbelow(True)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    fig.text(
        0.025,
        0.025,
        "HOB-trained model: five-fold expert-only fitting; each scored draft held out. "
        "Other rankings frozen before Arena release.\n"
        "Numbers label the experienced-player slice. Data from 17Lands.com (CC BY 4.0).",
        fontsize=8,
        color="#52606d",
    )
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    svg = path.with_suffix(".svg")
    fig.savefig(svg, bbox_inches="tight")
    # Matplotlib leaves spaces at line ends inside SVG path data. Normalize
    # those generated lines so the checked-in figure passes whitespace checks.
    svg.write_text(
        "\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n"
    )
    fig.savefig(path.with_suffix(".png"), dpi=180, bbox_inches="tight")
    plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--eval-dir", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--note", type=Path, required=True)
    args = p.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    s = json.loads((args.eval_dir / "summary.json").read_text())
    b = json.loads((args.eval_dir / "fitted_benchmark/summary.json").read_text())
    shared = pd.DataFrame(s["shared"])
    expert = shared[shared.population == "expert"].set_index("source")
    everyone = shared[shared.population == "all"].set_index("source")
    # The fitted benchmark must reuse the original forecasts on identical packs.
    for row in b["comparisons"]:
        frame = expert if row["population"] == "expert" else everyone
        expected = (
            frame.draftfm_accuracy.iloc[0]
            if row["source"] == "draftfm"
            else frame.loc[row["source"], "creator_accuracy"]
        )
        assert abs(row["source_accuracy"] - expected) < 1e-12
        assert row["shared_drafts"] == int(frame.eligible_drafts.iloc[0])
    records = [
        (
            "hob_fitted",
            b["populations"]["expert"]["hob_fitted_accuracy"],
            b["populations"]["all"]["hob_fitted_accuracy"],
        ),
        ("draftfm", expert.draftfm_accuracy.iloc[0], everyone.draftfm_accuracy.iloc[0]),
        ("random", expert.random_accuracy.iloc[0], everyone.random_accuracy.iloc[0]),
    ]
    records += [
        (src, row.creator_accuracy, everyone.loc[src, "creator_accuracy"])
        for src, row in expert.iterrows()
    ]
    table = pd.DataFrame(records, columns=["source", "expert", "all_players"])
    table["label"] = table.source.map(LABELS)
    table = table.sort_values("expert", ascending=False).reset_index(drop=True)
    table.to_csv(args.out_dir / "headline.csv", index=False)
    plot(table, args.out_dir / "p1p1_comparison")
    for name in ["pairwise_p1p1.csv", "shared_p1p1.csv", "outcome_correlations.csv"]:
        shutil.copyfile(args.eval_dir / name, args.out_dir / name)
    shutil.copyfile(
        args.eval_dir / "fitted_benchmark/comparisons.csv",
        args.out_dir / "fitted_comparisons.csv",
    )
    for name, data in [("forecast_summary.json", s), ("fitted_summary.json", b)]:
        (args.out_dir / name).write_text(json.dumps(portable(data), indent=2) + "\n")
    assets = args.out_dir.relative_to(args.note.parent).as_posix()
    llu = expert.loc["limited_level_ups"]
    lines = [
        "# Hobbit: the prerelease forecast meets real drafts",
        "",
        "Factual working note, 2026-09-20. Results are local and have not been published.",
        "",
        f"The sealed DraftFM ranking agreed with {pct(expert.draftfm_accuracy.iloc[0])} "
        f"of experienced winning players’ first picks. Limited Level-Ups’ saved "
        f'review reached {pct(expert.loc["limited_level_ups", "creator_accuracy"])} '
        f"on the same packs. A separate model fitted after release to HOB first picks "
        f'reached {pct(b["populations"]["expert"]["hob_fitted_accuracy"])} out of fold.',
        "",
        f"Limited Level-Ups led DraftFM by {-100 * llu.delta:.2f} percentage "
        f"points (paired 95% interval: {-100 * llu.delta_ci_high:.2f}–"
        f"{-100 * llu.delta_ci_low:.2f}). That is about seven additional "
        "matching first picks per 100 packs under the tie-breaking rule below. "
        "This is a meaningful advantage on the primary evaluation.",
        "",
        "The prerelease model transferred useful preferences to an unseen set, but "
        "it did not match the strongest saved human review or the model trained on "
        "HOB data. It was close to Nizzahon and NicolaiBolas under this metric, and "
        "ahead of Card Game Base and the two Draftsim forecasts. Those statements "
        "describe agreement with observed picks, not win rates or optimal decisions.",
        "",
        f"![First-pick agreement by forecast and player population]({assets}/p1p1_comparison.svg)",
        "",
        "The main table uses **6,493 experienced-player drafts** and **41,093 drafts "
        "from all players**. Every predictor is scored on identical packs within "
        "each column. Experienced means the existing paper’s win-rate bucket >= "
        "0.55 and games-played bucket >= 100.",
        "",
        "| Predictor | Experienced players | All players |",
        "|---|---:|---:|",
    ]
    lines += [
        f"| {r.label} | {pct(r.expert)} | {pct(r.all_players)} |"
        for r in table.itertuples()
    ]
    lines += [
        "",
        "The all-player column tells a different story: DraftFM leads every "
        "saved full-coverage prerelease comparator there, including Limited "
        "Level-Ups. The experienced-player column is the primary comparison "
        "because it matches the forecast’s intended skill condition. The broader "
        "column is reported rather than choosing whichever population looks best.",
        "",
        "**Paired differences on experienced-player packs.** Positive numbers "
        "favor DraftFM. Intervals are 95% percentile intervals from 2,000 paired "
        "draft resamples, seed 17. They are marginal, with no correction for "
        "multiple comparisons.",
        "",
        "| Comparator | DraftFM minus comparator (percentage points) | 95% interval |",
        "|---|---:|---:|",
    ]
    for src, row in expert.iterrows():
        lines.append(
            f"| {LABELS[src]} | {100*row.delta:+.2f} | [{100*row.delta_ci_low:+.2f}, {100*row.delta_ci_high:+.2f}] |"
        )
    bb = next(
        r
        for r in b["comparisons"]
        if r["population"] == "expert" and r["source"] == "draftfm"
    )
    lines += [
        f'| HOB-trained choice model | {-100*bb["hob_fitted_minus_source"]:+.2f} | '
        f'[{-100*bb["delta_ci_high"]:+.2f}, {-100*bb["delta_ci_low"]:+.2f}] |',
        "",
        "The intervals against Nizzahon and NicolaiBolas cross zero; that is not "
        "an equivalence test. The advantage for Limited Level-Ups and the gap to "
        "the HOB-trained model are substantial under this analysis.",
        "",
        "**How a ranking makes a first pick.** Within each offered pack, choose "
        "the highest-rated non-basic card. DraftFM uses the raw score in the "
        "original sealed CSV, with no rerun or refit. Letter forecasts use their "
        "original 13-level ordinal grades, slash grades use the first grade, and "
        "numeric forecasts retain their original values. Basics are excluded "
        "consistently. If k cards tie for best, the forecast receives 1/k credit "
        "when the human picked one of those cards. This is expected accuracy "
        "under uniform tie-breaking, not a favorable alphabetical tie-break.",
        "",
        "For perspective, if any tied-best card instead counted as a full "
        f'success, Limited Level-Ups would score {pct(expert.loc["limited_level_ups", "creator_inclusive_accuracy"])} '
        f"and DraftFM would remain at {pct(expert.draftfm_accuracy.iloc[0])}. "
        "The complete tie-inclusive results and mean tie sizes are in the "
        f"[shared-pack table]({assets}/shared_p1p1.csv). Coarse letter scales "
        "contain less ordering information, so this measures the archived "
        "forecasts, not the reviewers’ full drafting ability.",
        "",
        "**Coverage and exclusions.** The frozen public snapshot contains "
        f'{s["raw_pick_rows"]:,} pick rows and {s["p1p1_drafts"]:,} distinct '
        f'P1P1 drafts, of which {s["expert_p1p1_drafts"]:,} meet the expert '
        f'thresholds. Its drafts run from {s["draft_time_min"]} through '
        f'{s["draft_time_max"]} (source timestamps). The dump was retrieved '
        "on September 19; it is not a September 19 playthrough sample.",
        "",
        "Limited Level-Ups marked The Black Arrow “SB.” Its 2,557 packs "
        "(409 expert packs) are excluded from the shared comparison because "
        "that source gives no main-deck rank for an offered card. All other "
        "full-coverage sources can also be compared with DraftFM on all 43,650 "
        "drafts (6,902 experts); those larger pairwise populations are preserved "
        f"in [pairwise_p1p1.csv]({assets}/pairwise_p1p1.csv). None of the observed "
        "P1P1 selections was a basic or an unknown card.",
        "",
        "The archived Limited Resources review covers only 120 commons and "
        "uncommons. It covers every offered non-basic card in zero P1P1 packs, "
        "so it has no comparable full-pack accuracy row. We did not remove "
        "ungraded rare choices to manufacture a comparison.",
        "",
        "**The post-release reference model.** It learns 188 card values from "
        "expert P1P1 choices, minimizing masked multinomial negative log "
        "likelihood plus a fixed unit ridge penalty. Five folds are assigned "
        "by CRC32 of draft ID. Each fit uses expert drafts from four folds and "
        "predicts only the other fold: no scored draft appears in its own fit. "
        "Each fit starts at zero, uses L-BFGS-B, and converged in "
        f'{min(r["iterations"] for r in b["folds"])}–{max(r["iterations"] for r in b["folds"])} iterations. '
        "The recipe was fixed before its results were computed, but after "
        "seeing the initial creator comparison; this is an exploratory addendum.",
        "",
        f'The fits used {min(r["training_expert_drafts"] for r in b["folds"]):,}–'
        f'{max(r["training_expert_drafts"] for r in b["folds"]):,} training expert '
        "drafts apiece. Their training-set agreement ranged from "
        f'{pct(min(r["training_agreement"] for r in b["folds"]))} to '
        f'{pct(max(r["training_agreement"] for r in b["folds"]))}; those are '
        "in-sample diagnostics, not the headline result. No hyperparameter "
        "search or selection among fitted models was performed.",
        "",
        "This benchmark has access to post-release behavior and is not a "
        "prerelease competitor, a theoretical ceiling, or a full draft agent. "
        "Random folds mix dates rather than forecast the future. Its paired "
        "intervals condition on the fitted predictions and do not include "
        "training variance or dependence from overlapping training folds. "
        "Draft resampling also does not account for repeat appearances of "
        "the same player.",
        "",
        "**Secondary outcome associations.** The separately cached ratings "
        "request covers August 11–September 19. Although it contains all 188 "
        "non-basic names, only 18 have both a non-null GIH win rate and at "
        "least 200 GIH observations; only 52 have a usable average-taken-at "
        "value with positive pick count. On the 18-card GIH subset DraftFM’s "
        "Spearman correlation is -0.232; on the 52-card negative-ATA subset "
        "it is 0.518. These small, selective subsets do not support a "
        "set-wide claim about predicting card win rates. Every computed "
        "creator comparison, including LR, is retained in "
        f"[outcome_correlations.csv]({assets}/outcome_correlations.csv). "
        "No causal card-strength interpretation is made.",
        "",
        "**What was frozen, and when.** The [public forecast](https://github.com/brianward92/draftfm/tree/draftfm-v1.0) "
        "was sealed on August 9, before HOB’s August 11 Arena release. The "
        "downloaded public CSV was checked again against the local forecast "
        "and its published digest. Creator transcriptions are the archived "
        "pre-Arena snapshots, not live tier lists. Draftsim’s app date comes "
        "from an asset header, and NicolaiBolas’s archive records retrieval "
        "rather than a verified publication date; the original paper discusses "
        "those timestamp limits. This note publishes aggregate comparisons, "
        "not the underlying creator grade tables.",
        "",
        "The [analysis rules](hob_out_of_sample_protocol_20260919.md) were "
        "written before calculating these results, but after release. The "
        "forecast is prospective; the detailed follow-up analysis is "
        "retrospective. The [fitted-model addendum](hob_postrelease_benchmark_protocol_20260920.md) "
        "records its later request and fixed recipe.",
        "",
        "**Reproducibility.** Source hashes, retrieval metadata, population "
        "counts, exclusions, package versions, outputs, and paired intervals are saved in "
        f"[forecast_summary.json]({assets}/forecast_summary.json) and "
        f"[fitted_summary.json]({assets}/fitted_summary.json). The public "
        "aggregate files contain no individual draft rows. Local inputs "
        "remain under `data/forecast_20260919/inputs/`, and full private "
        "results under `data/forecast_20260919/hob/`.",
        "",
        "| Input | SHA-256 |",
        "|---|---|",
    ]
    lines += [
        f'| {key} | `{s["inputs"][key]["sha256"]}` |'
        for key in ["forecast", "grades", "drafts", "ratings", "protocol"]
    ]
    lines += [
        "",
        "Install `requirements-forecast-eval.txt` in the analysis environment, then run:",
        "",
        "```bash",
        "PYTHONPATH=. .venv-embed/bin/python scripts/eval_hob_forecast.py \\",
        '  --forecast "$HOME/dat/mtga-draftfm-rebuild-20260808/seal/draftfm-v1.0/hob_p1p1_forecast.csv" \\',
        "  --grades data/external/creator_grades/creator_grades_hob.csv \\",
        "  --drafts data/forecast_20260919/inputs/draft_data_public.HOB.PremierDraft.csv.gz \\",
        "  --ratings data/forecast_20260919/inputs/hob_card_ratings_20260919.json \\",
        "  --protocol docs/hob_out_of_sample_protocol_20260919.md \\",
        "  --out-dir data/forecast_20260919/hob",
        "",
        "PYTHONPATH=. .venv-embed/bin/python scripts/eval_hob_fitted_benchmark.py \\",
        '  --forecast "$HOME/dat/mtga-draftfm-rebuild-20260808/seal/draftfm-v1.0/hob_p1p1_forecast.csv" \\',
        "  --grades data/external/creator_grades/creator_grades_hob.csv \\",
        "  --drafts data/forecast_20260919/inputs/draft_data_public.HOB.PremierDraft.csv.gz \\",
        "  --protocol docs/hob_postrelease_benchmark_protocol_20260920.md \\",
        "  --out-dir data/forecast_20260919/hob/fitted_benchmark",
        "",
        "PYTHONPATH=. .venv-embed/bin/python scripts/report_hob_forecast.py \\",
        "  --eval-dir data/forecast_20260919/hob \\",
        "  --out-dir docs/results/hob_oos_20260920 \\",
        "  --note docs/hob_out_of_sample_20260920.md",
        "```",
        "",
        "Exact reproduction requires the frozen raw snapshot and archived "
        "creator input with the hashes above; live downloads may have changed. "
        "The optional `--nicolai` flag is unnecessary here because the combined "
        "creator CSV already contains NicolaiBolas; duplicate source/card rows "
        "are deliberately rejected.",
        "",
        "Data from 17Lands.com (CC BY 4.0). Card identities and descriptions "
        "from Scryfall. These are draft working results for an independent "
        "follow-up article, not a published update to the original paper.",
    ]
    args.note.write_text("\n".join(lines) + "\n")
    print(args.note)
    print(table[["label", "expert", "all_players"]].to_string(index=False))


if __name__ == "__main__":
    main()
