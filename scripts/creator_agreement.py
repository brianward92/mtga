"""Pairwise agreement among normalized HOB creator forecasts.

Frozen rules (recorded 2026-08-09, before any model comparison):
- Letters map to a 13-level ordinal scale: F=0, D-=1, ..., A+=12.
- A slash grade like "D / B" is a primary grade with a secondary
  designation; the primary (first) grade is used for statistics.
- "SB" (sideboard-only) carries no main-deck rank and is excluded.
- Numeric sources (Draftsim) are used on their native scales; all
  statistics are rank-based, so scale differences do not matter.
- Statistics are computed on the cards shared by each pair; shared
  counts are reported. Missing grades are never imputed.
- Top-k overlap uses score ties broken by canonical name order, which
  is deterministic but arbitrary; tau_b and Spearman handle ties
  properly and are the primary measures.

Usage:
    python scripts/creator_agreement.py \
        --grades data/external/creator_grades/creator_grades_hob.csv \
        --out data/external/creator_grades/agreement_pairwise.csv
"""

import argparse
import csv
import itertools
from collections import defaultdict

from scipy.stats import kendalltau, spearmanr

LETTER = {g: i for i, g in enumerate(
    ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"]
)}
TOP_K = (10, 25, 50)


def to_value(grade: str):
    primary = grade.split("/")[0].strip()
    if primary in LETTER:
        return float(LETTER[primary])
    try:
        return float(primary)
    except ValueError:
        return None  # e.g. "SB"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    scores = defaultdict(dict)
    dropped = defaultdict(list)
    with open(args.grades) as f:
        for row in csv.DictReader(f):
            v = to_value(row["grade"])
            if v is None:
                dropped[row["source"]].append((row["card_name"], row["grade"]))
            else:
                scores[row["source"]][row["card_name"]] = v

    for src, items in dropped.items():
        print(f"note: {src} excluded {items}")

    results = []
    for a, b in itertools.combinations(sorted(scores), 2):
        shared = sorted(set(scores[a]) & set(scores[b]))
        xa = [scores[a][c] for c in shared]
        xb = [scores[b][c] for c in shared]
        tau = kendalltau(xa, xb, variant="b").statistic
        rho = spearmanr(xa, xb).statistic
        row = {"source_a": a, "source_b": b, "shared_cards": len(shared),
               "kendall_tau_b": round(tau, 4), "spearman_rho": round(rho, 4)}
        for k in TOP_K:
            top_a = set(sorted(shared, key=lambda c: (-scores[a][c], c))[:k])
            top_b = set(sorted(shared, key=lambda c: (-scores[b][c], c))[:k])
            row[f"top{k}_overlap"] = len(top_a & top_b)
        results.append(row)

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0]))
        w.writeheader()
        w.writerows(results)

    for r in results:
        print(f"{r['source_a']:>20} vs {r['source_b']:<20} n={r['shared_cards']:<4}"
              f" tau_b={r['kendall_tau_b']:+.3f} rho={r['spearman_rho']:+.3f}"
              f" top10/25/50={r['top10_overlap']}/{r['top25_overlap']}/{r['top50_overlap']}")


if __name__ == "__main__":
    main()
