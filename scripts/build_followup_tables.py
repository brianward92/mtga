#!/usr/bin/env python
"""Build the follow-up paper's tables from the existing frozen results."""

import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def escape(value):
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(c, c) for c in str(value))


def read_csv(path):
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def write_rows(path, columns, header, rows):
    content = [
        r"\begin{tabular}{" + columns + "}",
        r"\toprule",
        " & ".join(escape(x) for x in header) + r" \\",
        r"\midrule",
    ]
    content += [" & ".join(escape(x) for x in row) + r" \\" for row in rows]
    content += [r"\bottomrule", r"\end{tabular}"]
    path.write_text("\n".join(content) + "\n")


def main():
    hob = ROOT / "docs/results/hob_oos_20260920"
    fra = ROOT / "data/forecast_20260919/fra"
    out = ROOT / "paper/data/followup_20260920"
    out.mkdir(parents=True, exist_ok=True)
    # The included forecast lets a checkout rebuild the paper without private
    # feature caches or the original local scoring directory.
    if not (fra / "fra_p1p1_forecast.csv").exists():
        fra = out
    inputs = [
        hob / "headline.csv",
        hob / "shared_p1p1.csv",
        hob / "fitted_comparisons.csv",
        fra / "fra_p1p1_forecast.csv",
        fra / "fra_uncommons.csv",
        fra / "forecast_manifest.json",
    ]
    manifest = json.loads(inputs[-1].read_text())
    forecast_hash = hashlib.sha256(inputs[3].read_bytes()).hexdigest()
    if forecast_hash != manifest["outputs"]["fra_p1p1_forecast.csv"]:
        raise ValueError("FRA forecast differs from its recorded manifest")
    headline = read_csv(inputs[0])
    labels = {r["source"]: r["label"] for r in headline}
    write_rows(
        out / "headline.tex",
        "lrr",
        ["Predictor", "Experienced", "All players"],
        [
            [
                r["label"],
                f"{100 * float(r['expert']):.2f}%",
                f"{100 * float(r['all_players']):.2f}%",
            ]
            for r in headline
        ],
    )
    paired = [r for r in read_csv(inputs[1]) if r["population"] == "expert"]
    rows = [
        [
            labels[r["source"]],
            f"{100 * float(r['delta']):+.2f}",
            f"[{100 * float(r['delta_ci_low']):+.2f}, {100 * float(r['delta_ci_high']):+.2f}]",
        ]
        for r in paired
    ]
    b = next(
        r
        for r in read_csv(inputs[2])
        if r["population"] == "expert" and r["source"] == "draftfm"
    )
    rows.append(
        [
            "HOB-trained choice model",
            f"{-100 * float(b['hob_fitted_minus_source']):+.2f}",
            f"[{-100 * float(b['delta_ci_high']):+.2f}, {-100 * float(b['delta_ci_low']):+.2f}]",
        ]
    )
    write_rows(
        out / "paired.tex",
        "lrr",
        ["Comparator", "DraftFM minus comparator", "95% interval"],
        rows,
    )
    forecast = read_csv(inputs[3])
    write_rows(
        out / "fra_top10.tex",
        "rlcc",
        ["Rank", "Card", "Rarity", "Grade"],
        [
            [r["rank"], r["name"], r["rarity"].title(), r["letter"]]
            for r in forecast[:10]
        ],
    )
    uncommons = [r for r in forecast if r["set"] == "FRA" and r["rarity"] == "uncommon"]
    assert len(uncommons) == 109
    write_rows(
        out / "fra_uncommons10.tex",
        "rlrc",
        ["U rank", "Card", "Overall rank", "Grade"],
        [
            [i, r["name"], r["rank"], r["letter"]]
            for i, r in enumerate(uncommons[:10], 1)
        ],
    )
    for name in [
        "fra_p1p1_forecast.csv",
        "fra_uncommons.csv",
        "forecast_manifest.json",
    ]:
        (out / name).write_bytes((fra / name).read_bytes())
    # Record the forecast's canonical source paths even when a clean checkout
    # reads the identical included copies instead of the local scoring cache.
    canonical_inputs = inputs[:3] + [
        ROOT / "data/forecast_20260919/fra" / path.name for path in inputs[3:]
    ]
    provenance = {
        str(canonical.relative_to(ROOT)): hashlib.sha256(
            actual.read_bytes()
        ).hexdigest()
        for canonical, actual in zip(canonical_inputs, inputs)
    }
    (out / "table_inputs.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(out)


if __name__ == "__main__":
    main()
