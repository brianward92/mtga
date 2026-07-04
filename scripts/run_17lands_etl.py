#!/usr/bin/env python
"""Curate raw 17Lands CSV dumps into typed parquet (+ vocab sidecars)."""

import argparse

from mtga.lands import config, etl


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=",".join(config.TRACKED_SETS))
    parser.add_argument("--formats", default=",".join(config.FORMATS))
    parser.add_argument("--types", default=",".join(config.DATA_TYPES))
    parser.add_argument("--force", action="store_true")
    return parser


def main():
    args = create_parser().parse_args()
    sets = [s.strip().upper() for s in args.sets.split(",") if s.strip()]
    formats = [f.strip() for f in args.formats.split(",") if f.strip()]
    data_types = [t.strip() for t in args.types.split(",") if t.strip()]

    for set_code in sets:
        for fmt in formats:
            if "draft" in data_types:
                result = etl.curate_draft(set_code, fmt, force=args.force)
                print(f"draft {set_code} {fmt}: {result}")
            if "game" in data_types:
                result = etl.curate_game(set_code, fmt, force=args.force)
                print(f"game  {set_code} {fmt}: {result}")


if __name__ == "__main__":
    main()
