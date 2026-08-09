"""Pairwise creator agreement on a common 13-level letter ladder.

RULE CHANGE 2026-08-09: this supersedes the mapping frozen earlier the same
day in `creator_agreement.py`. That script compared sources on their native
scales and reported only rank statistics (tau_b, Spearman, top-k). It stays in
the tree unmodified as the record of the superseded rules; this script is the
current spec. Nothing here reads or writes model scores.

Normalization
-------------
Every source is placed on one 13-level ladder: A+ A A- B+ B B- C+ C C- D+ D D-
F (only F is unsigned). Letter sources pass through verbatim; a source that
never uses a rung is simply sparse there (Nizzahon never assigns D-, which is
fine and is not imputed).

Numeric sources (Draftsim review 0-10, Draftsim pick order ~0-5, and any future
float-valued source such as the sealed DraftFM forecast) are mapped to letters
by PER-SOURCE RANK QUANTILES using the frozen band percentages the DraftFM
forecast uses:

    A+ 2  A 3  A- 5  B+ 8  B 12  B- 12  C+ 13  C 15  C- 12  D+ 8  D 5  D- 3  F 2

Bands are percentages of the source's own graded cards and sum to 100.

Tie handling. Cards sharing a raw score always receive the SAME letter: each
tie group is assigned by the group's AVERAGE rank, so a group is never split
across a band boundary. Boundary rounding: a card at fractional rank p (1/n =
best) takes the first band whose cumulative share is >= p, i.e. a rank landing
exactly on a boundary rounds toward the BETTER grade.

A coarse numeric source cannot always realize the target bands -- Draftsim's
review grade puts 47 of 188 cards (25%) on a single integer, which is wider
than any band -- so the achieved distribution is reported per source alongside
the target. This is a property of the source, not an error.

Carried forward unchanged from the superseded rules: a slash grade ("D / B")
contributes its primary (first) grade; "SB" (sideboard-only) carries no
main-deck rank and is excluded, with the exclusion reported; missing grades are
never imputed; statistics use only the cards a pair shares.

Metrics
-------
Per pair, on matched cards only, ordered clearest to least clear:

1. exact_match_rate   share of matched cards given the identical letter
2. within_one_rate    share within one ladder step
3. spearman_rho       rank correlation, tie-corrected
4. kendall_tau_b      rank agreement
5. top10_overlap      shared cards among each side's top 10 by rank

Metrics 1-2 are computed on the NORMALIZED LETTERS. Metrics 3-5 are computed on
the UNDERLYING RANKS: raw scores where the source is numeric, ladder rungs
where the source is letters. So the quantile mapping never perturbs 3-5, and
those figures remain comparable with the superseded table.

Top-10 tie rule: the reported overlap is INCLUSIVE -- each side's set is every
card whose score is >= the 10th-best score, so a tie spanning the 10th position
keeps all tied cards and the set may exceed 10. Each side's realized set size
is reported. `top10_overlap_strict` gives the conservative alternative counting
only cards strictly better than the 10th-best score. The inclusive rule is the
headline because the coarse letter scales tie heavily at the boundary and any
tie-break by name would decide most of the set arbitrarily.

Usage:
    python scripts/creator_letter_agreement.py \
        --grades data/external/creator_grades/creator_grades_hob.csv \
        --out-dir data/external/creator_grades

Adding the sealed forecast later needs no edit to this file: append its rows to
the combined CSV, or pass `--grades extra.csv` a second time. A source whose
grades all parse as floats is detected as numeric and quantile-mapped with the
same bands. `--drop` removes non-draftable names (the five basic lands by
default) from EVERY source before mapping, so a forecast delivered over all 193
Scryfall names does not spend its bottom bands on unpickable cards.
"""

import argparse
import csv
import itertools
from collections import defaultdict

from scipy.stats import kendalltau, spearmanr

LADDER = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"]
RUNG = {g: i for i, g in enumerate(LADDER)}

# Frozen band percentages, best grade first. Must sum to 100.
BANDS = [
    ("A+", 2),
    ("A", 3),
    ("A-", 5),
    ("B+", 8),
    ("B", 12),
    ("B-", 12),
    ("C+", 13),
    ("C", 15),
    ("C-", 12),
    ("D+", 8),
    ("D", 5),
    ("D-", 3),
    ("F", 2),
]

BASIC_LANDS = ("Plains", "Island", "Swamp", "Mountain", "Forest")
TOP_K = 10
EPS = 1e-12

# Display names for the LaTeX block, matching tab:hob-expert-sources in the
# paper. An unlisted source falls back to its key with underscores spaced out.
DISPLAY = {
    "nizzahon": "Nizzahon Magic",
    "cardgamebase": "Card Game Base",
    "draftsim_review": "Draftsim (set review)",
    "draftsim_pickorder": "Draftsim (pick order)",
    "limited_resources": "Limited Resources",
    "limited_level_ups": "Limited Level-Ups",
    "nicolai_bola": "NicolaiBolas",
}


def primary(grade):
    """Slash grades contribute their primary (first) grade."""
    return grade.split("/")[0].strip()


def as_float(token):
    try:
        return float(token)
    except ValueError:
        return None


def cumulative_bands():
    acc, out = 0.0, []
    for letter, pct in BANDS:
        acc += pct / 100.0
        out.append((letter, acc))
    return out


def quantile_letters(scores):
    """Map raw numeric scores to ladder letters by per-source rank quantiles.

    Tie groups share their average rank and therefore one letter; a rank
    landing exactly on a band boundary rounds toward the better grade.
    """
    n = len(scores)
    cum = cumulative_bands()
    order = sorted(scores.items(), key=lambda kv: -kv[1])
    letters, i = {}, 0
    while i < len(order):
        j = i
        while j < len(order) and order[j][1] == order[i][1]:
            j += 1
        avg_rank = (i + 1 + j) / 2.0  # ranks i+1 .. j inclusive
        p = avg_rank / n
        letter = next((L for L, ub in cum if p <= ub + EPS), BANDS[-1][0])
        for k in range(i, j):
            letters[order[k][0]] = letter
        i = j
    return letters


def load_sources(paths, drop):
    """Read tidy (source, card_name, grade) rows; split numeric from letters."""
    raw, dropped, excluded = defaultdict(dict), defaultdict(list), defaultdict(list)
    for path in paths:
        with open(path) as f:
            for row in csv.DictReader(f):
                src, name = row["source"], row["card_name"]
                if name in drop:
                    dropped[src].append(name)
                    continue
                raw[src][name] = primary(row["grade"])

    letters, underlying, kinds = {}, {}, {}
    for src, items in raw.items():
        keep = {}
        for name, token in items.items():
            if token in RUNG or as_float(token) is not None:
                keep[name] = token
            else:
                excluded[src].append((name, token))  # e.g. "SB"
        numeric = keep and all(as_float(t) is not None for t in keep.values())
        kinds[src] = "numeric" if numeric else "letter"
        if numeric:
            scores = {n: as_float(t) for n, t in keep.items()}
            letters[src] = quantile_letters(scores)
            underlying[src] = scores
        else:
            letters[src] = dict(keep)
            underlying[src] = {n: float(RUNG[t]) for n, t in keep.items()}
    return letters, underlying, kinds, dropped, excluded


def top_set(scores, pool, k, inclusive):
    ranked = sorted(pool, key=lambda c: -scores[c])
    cut = scores[ranked[min(k, len(ranked)) - 1]]
    if inclusive:
        return {c for c in pool if scores[c] >= cut}
    return {c for c in pool if scores[c] > cut}


def compare(a, b, letters, underlying):
    shared = sorted(set(letters[a]) & set(letters[b]))
    la = [letters[a][c] for c in shared]
    lb = [letters[b][c] for c in shared]
    xa = [underlying[a][c] for c in shared]
    xb = [underlying[b][c] for c in shared]
    n = len(shared)
    exact = sum(p == q for p, q in zip(la, lb)) / n
    within = sum(abs(RUNG[p] - RUNG[q]) <= 1 for p, q in zip(la, lb)) / n
    ta = top_set(underlying[a], shared, TOP_K, True)
    tb = top_set(underlying[b], shared, TOP_K, True)
    sa = top_set(underlying[a], shared, TOP_K, False)
    sb = top_set(underlying[b], shared, TOP_K, False)
    return {
        "source_a": a,
        "source_b": b,
        "matched_n": n,
        "exact_match_rate": round(exact, 4),
        "within_one_rate": round(within, 4),
        "spearman_rho": round(spearmanr(xa, xb).statistic, 4),
        "kendall_tau_b": round(kendalltau(xa, xb, variant="b").statistic, 4),
        "top10_overlap": len(ta & tb),
        "top10_n_a": len(ta),
        "top10_n_b": len(tb),
        "top10_overlap_strict": len(sa & sb),
    }


def band_report(letters, kinds):
    lines, n_target = [], dict(BANDS)
    for src in sorted(letters):
        counts = defaultdict(int)
        for g in letters[src].values():
            counts[g] += 1
        n = len(letters[src])
        lines.append(f"{src} ({kinds[src]}, n={n})")
        for letter, _ in BANDS:
            got = 100.0 * counts[letter] / n
            want = n_target[letter]
            mark = "  <-- target" if kinds[src] == "numeric" else ""
            lines.append(
                f"    {letter:<2} {counts[letter]:>4}  {got:5.1f}%"
                + (f"  target {want:>2}%{mark}" if kinds[src] == "numeric" else "")
            )
    return lines


def latex_block(results, separable):
    """Metrics ordered clearest to least clear; separable rows fenced off."""
    head = [
        r"\hline",
        r"Pair & $n$ & Exact & Within one & Spearman & "
        r"Kendall $\tau_b$ & Top-10 \\",
        r"\hline",
    ]

    def row(r):
        a = DISPLAY.get(r["source_a"], r["source_a"].replace("_", " "))
        b = DISPLAY.get(r["source_b"], r["source_b"].replace("_", " "))
        pair = f"{a} vs.\\ {b}"
        return (
            f"{pair} & {r['matched_n']} & {r['exact_match_rate']:.3f} & "
            f"{r['within_one_rate']:.3f} & {r['spearman_rho']:.3f} & "
            f"{r['kendall_tau_b']:.3f} & {r['top10_overlap']} \\\\"
        )

    main = [row(r) for r in results if not separable(r)]
    held = [row(r) for r in results if separable(r)]
    return "\n".join(head + main + ([r"\hline"] + held if held else []) + [r"\hline"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", required=True, action="append")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--drop", action="append", default=list(BASIC_LANDS))
    ap.add_argument("--separable", default="draftsim_pickorder")
    args = ap.parse_args()

    letters, underlying, kinds, dropped, excluded = load_sources(
        args.grades, set(args.drop)
    )
    for src, names in sorted(dropped.items()):
        print(f"note: {src} dropped {len(names)} non-draftable name(s)")
    for src, items in sorted(excluded.items()):
        print(f"note: {src} excluded off-ladder grade(s) {items}")

    print()
    for line in band_report(letters, kinds):
        print(line)

    results = [
        compare(a, b, letters, underlying)
        for a, b in itertools.combinations(sorted(letters), 2)
    ]
    results.sort(key=lambda r: -r["exact_match_rate"])

    out = f"{args.out_dir}/agreement_letters.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0]))
        w.writeheader()
        w.writerows(results)

    def separable(r):
        return args.separable in (r["source_a"], r["source_b"])

    tex = f"{args.out_dir}/agreement_letters_table.tex"
    with open(tex, "w") as f:
        f.write(latex_block(results, separable) + "\n")

    print()
    hdr = f"{'pair':<46}{'n':>5}{'exact':>8}{'w/in 1':>8}{'rho':>8}{'tau_b':>8}{'top10':>8}"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        pair = f"{r['source_a']} vs {r['source_b']}"
        flag = " *" if separable(r) else ""
        print(
            f"{pair:<46}{r['matched_n']:>5}{r['exact_match_rate']:>8.3f}"
            f"{r['within_one_rate']:>8.3f}{r['spearman_rho']:>+8.3f}"
            f"{r['kendall_tau_b']:>+8.3f}"
            f"{str(r['top10_overlap']) + '/' + str(r['top10_n_a']) + ',' + str(r['top10_n_b']):>8}{flag}"
        )
    print(f"\n* rows involving {args.separable} are fenced separately in {tex}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
