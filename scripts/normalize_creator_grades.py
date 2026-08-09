"""Normalize creator HOB grade transcriptions to canonical Scryfall names.

Reads per-source grade TSVs from a private data root, resolves every card
name to the canonical Scryfall name for the HOB expansion, and writes:

- one normalized TSV per source under data/external/creator_grades/
- a combined long-format CSV (source, card_name, grade) for analysis
- a match report listing any unmatched names per source

Raw grades are copied verbatim. No score-to-letter or letter-to-number
mapping is applied here; that mapping is frozen separately.

Usage:
    python scripts/normalize_creator_grades.py \
        --data-root ~/dat/mtga \
        --scryfall ~/dat/mtga/limited-resources/data/hob_scryfall.json \
        --out data/external/creator_grades
"""

import argparse
import csv
import difflib
import json
import unicodedata
from pathlib import Path

# A grade a source assigns to a named cycle rather than to individual cards
# is expanded to the cycle members, and the expansion is noted in the report.
CYCLE_EXPANSIONS = {
    "common land cycle": [
        "Elvenking's Halls",
        "Goblin-town",
        "Iron Hills",
        "Lake-town",
        "Mirkwood",
    ],
}

SOURCES = [
    # (source key, relative path, value column name in the input)
    ("nizzahon", "nizzahon/hob_grades_20260803.csv", "Card Grade"),
    (
        "limited_resources",
        "limited-resources/data/lr865_hob_grades_20260804.csv",
        "Card Grade",
    ),
    ("draftsim_review", "draftsim/draftsim_grades_20260803.tsv", "Card Grade"),
    ("draftsim_pickorder", "draftsim/draftsim_pickorder_20260806.tsv", "Card Rating"),
    (
        "limited_level_ups",
        "Chord_O_Calls/Chord_O_Calls_grades_20260805.tsv",
        "Card Grade",
    ),
    ("cardgamebase", "cardgamebase/cardgamebase_grades_20260801.tsv", "Card Grade"),
    ("nicolai_bola", "nicolai-bola/nicolai-bola_grades_20260809.tsv", "Card Grade"),
]


def fold(name: str) -> str:
    """Matching key: front face only, accents stripped, quotes straightened."""
    name = name.split(" // ")[0]
    name = name.replace("’", "'").replace("‘", "'")
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    return " ".join(name.lower().split())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", required=True, type=Path)
    ap.add_argument("--scryfall", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    cards = json.loads(args.scryfall.read_text())
    canonical = {}
    for card in cards:
        canonical.setdefault(fold(card["name"]), card["name"])

    args.out.mkdir(parents=True, exist_ok=True)
    combined = []
    report = {"scryfall_records": len(cards), "sources": {}}

    for key, rel, value_col in SOURCES:
        path = args.data_root / rel
        with path.open() as f:
            rows = list(csv.DictReader(f, delimiter="\t"))
        matched, unmatched, fuzzy = [], [], {}
        for row in rows:
            raw_name = row["Card Name"].strip()
            grade = row[value_col].strip()
            key_ = fold(raw_name)
            if key_ in CYCLE_EXPANSIONS:
                for member in CYCLE_EXPANSIONS[key_]:
                    matched.append((canonical[fold(member)], grade))
                fuzzy[raw_name] = (
                    f"expanded to {len(CYCLE_EXPANSIONS[key_])} cycle members"
                )
                continue
            canon = canonical.get(key_)
            if canon is None:
                close = difflib.get_close_matches(key_, canonical, n=2, cutoff=0.75)
                if len(close) >= 1 and (
                    len(close) == 1
                    or difflib.SequenceMatcher(None, key_, close[0]).ratio()
                    - difflib.SequenceMatcher(None, key_, close[1]).ratio()
                    > 0.05
                ):
                    canon = canonical[close[0]]
                    fuzzy[raw_name] = canon
            if canon is None:
                unmatched.append(raw_name)
            else:
                matched.append((canon, grade))
        matched.sort()
        out_path = args.out / f"{key}_hob.tsv"
        with out_path.open("w", newline="") as f:
            w = csv.writer(f, delimiter="\t")
            w.writerow(["Card Name", value_col])
            w.writerows(matched)
        combined += [(key, n, g) for n, g in matched]
        report["sources"][key] = {
            "input": rel,
            "rows": len(rows),
            "matched": len(matched),
            "fuzzy_or_expanded": fuzzy,
            "unmatched": unmatched,
        }

    with (args.out / "creator_grades_hob.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source", "card_name", "grade"])
        w.writerows(combined)
    (args.out / "match_report.json").write_text(json.dumps(report, indent=2) + "\n")

    for key, info in report["sources"].items():
        print(f"{key}: {info['matched']}/{info['rows']} matched", end="")
        print(f", unmatched: {info['unmatched']}" if info["unmatched"] else "")


if __name__ == "__main__":
    main()
