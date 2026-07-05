#!/usr/bin/env python
"""Curate 17Lands replay dumps into mulligan-decision + turn-state parquet.

Corpus-aware: with no --sets, runs every corpus set/format whose replay raw
file is on disk (17Lands publishes replay dumps for only a subset of sets).
EVAL_ONLY sets (MSH) are refused without --allow-eval-only, mirroring
build_data_manifest.py: replay data is not draft-pick data, but the held-out
gate stays consistent across every ETL entry point.
"""

import argparse

from mtga.lands import corpus, paths
from mtga.replay import etl


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=None,
                        help="comma-separated set codes (default: every corpus "
                             "set whose replay raw file exists)")
    parser.add_argument("--formats", default="PremierDraft,TradDraft")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--allow-eval-only", action="store_true",
                        help="permit EVAL_ONLY sets (mirrors "
                             "build_data_manifest.py's T0-freeze override)")
    return parser


def main():
    parser = create_parser()
    args = parser.parse_args()
    formats = [f.strip() for f in args.formats.split(",") if f.strip()]

    explicit = args.sets is not None
    if explicit:
        sets = [s.strip().upper() for s in args.sets.split(",") if s.strip()]
    else:
        sets = list(corpus.CORPUS)  # registry order; never includes EVAL_ONLY

    known = set(corpus.CORPUS) | corpus.EVAL_ONLY
    for code in sets:
        if code in corpus.EVAL_ONLY and not args.allow_eval_only:
            parser.error(
                f"{code} is EVAL_ONLY (held out from all training); pass "
                f"--allow-eval-only to curate its replay data deliberately")
        if code not in known:
            parser.error(f"{code} is not in the corpus registry")

    pairs = [(code, fmt) for code in sets for fmt in formats]
    if not explicit:
        pairs = [(code, fmt) for code, fmt in pairs
                 if paths.raw_dataset_path("replay", code, fmt).exists()]

    for set_code, fmt in pairs:
        # Old-era (2021) replay files lack some column families (e.g. STX has
        # no candidate_hand_*/num_mulligans). Each curation degrades
        # independently: a set contributes what its era recorded.
        for label, curate in [("replay_mull ", etl.curate_mulligans),
                              ("replay_turns", etl.curate_turn_states)]:
            try:
                result = curate(set_code, fmt, force=args.force)
            except Exception as error:  # noqa: BLE001 — era schema drift shows
                # up as ValueError OR duckdb Binder errors (missing per-turn
                # columns in older files); one bad set must not stop the corpus.
                result = {"status": "SKIPPED_SCHEMA",
                          "reason": f"{type(error).__name__}: {str(error)[:110]}"}
            print(f"{label} {set_code} {fmt}: {result}", flush=True)


if __name__ == "__main__":
    main()
