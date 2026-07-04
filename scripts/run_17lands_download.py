#!/usr/bin/env python
"""Sync 17Lands public data (bulk S3 dumps + once-daily site ratings cache)."""

import argparse

from mtga.lands import config, download


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=",".join(config.TRACKED_SETS),
                        help="comma-separated set codes")
    parser.add_argument("--formats", default=",".join(config.FORMATS),
                        help="comma-separated limited formats")
    parser.add_argument("--types", default=",".join(config.DATA_TYPES),
                        help="comma-separated data types (draft,game)")
    parser.add_argument("--include-sealed", action="store_true",
                        help="also sync Sealed game data (metrics only, no picks)")
    parser.add_argument("--no-ratings", dest="ratings", action="store_false",
                        help="skip the once-daily card/color ratings cache")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main():
    args = create_parser().parse_args()
    sets = [s.strip().upper() for s in args.sets.split(",") if s.strip()]
    formats = [f.strip() for f in args.formats.split(",") if f.strip()]
    data_types = [t.strip() for t in args.types.split(",") if t.strip()]

    jobs = [(s, f, t) for s in sets for f in formats for t in data_types]
    if args.include_sealed:
        jobs += [(s, "Sealed", "game") for s in sets]

    results = []
    if args.dry_run:
        for job in jobs:
            print("would sync:", job)
        return

    results.append(("cards.csv", "", download.sync_cards_csv(force=args.force)))
    results.append(("abilities.csv", "", download.sync_abilities_csv(force=args.force)))
    for set_code, fmt, dtype in jobs:
        status = download.sync_dataset(set_code, fmt, dtype, force=args.force)
        results.append((f"{dtype}_data {set_code}", fmt, status))
    if args.ratings:
        for set_code in sets:
            for fmt in formats:
                results.append((f"card_ratings {set_code}", fmt,
                                download.fetch_card_ratings(set_code, fmt)))
                results.append((f"color_ratings {set_code}", fmt,
                                download.fetch_color_ratings(set_code, fmt)))

    width = max(len(f"{n} {f}") for n, f, _ in results)
    for name, fmt, status in results:
        print(f"{f'{name} {fmt}':<{width}}  {status}")


if __name__ == "__main__":
    main()
