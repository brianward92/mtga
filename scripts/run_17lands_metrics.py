#!/usr/bin/env python
"""Compute per-card and color-pair metrics from curated 17Lands parquet."""

import argparse

from mtga.lands import config, metrics, paths


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=",".join(config.TRACKED_SETS))
    parser.add_argument("--formats", default=",".join(config.FORMATS))
    parser.add_argument(
        "--prior-strength",
        type=float,
        default=None,
        help="override the method-of-moments shrinkage prior",
    )
    parser.add_argument(
        "--as-of", default=None, help="date stamp override (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="print the top-20 table for each set/format and exit",
    )
    parser.add_argument("--force", action="store_true")
    return parser


def main():
    args = create_parser().parse_args()
    sets = [s.strip().upper() for s in args.sets.split(",") if s.strip()]
    formats = [f.strip() for f in args.formats.split(",") if f.strip()]

    for set_code in sets:
        for fmt in formats:
            if args.report:
                print(f"\n== {set_code} {fmt} ==")
                metrics.report(set_code, fmt)
                continue
            curated = paths.curated_path("game", set_code, fmt)
            if not curated.exists():
                print(f"skip {set_code} {fmt}: no curated game data")
                continue
            link = paths.latest_symlink(
                paths.metrics_cards_path(set_code, fmt, "x"), prefix="cards_"
            )
            if link.exists() and not args.force and args.as_of is None:
                import json

                curated_meta = paths.meta_path(curated)
                dated = link.resolve()
                if dated.exists() and curated_meta.exists():
                    if dated.stat().st_mtime >= curated_meta.stat().st_mtime:
                        print(f"skip {set_code} {fmt}: metrics newer than curated data")
                        continue
            metrics.build_metrics(
                set_code, fmt, prior_strength=args.prior_strength, as_of=args.as_of
            )


if __name__ == "__main__":
    main()
