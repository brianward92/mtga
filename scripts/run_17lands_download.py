import argparse

from mtga.lands import config, corpus, download


def csv_values(value):
    return [item.strip() for item in value.split(",") if item.strip()]


def set_values(value):
    return [item.upper() for item in csv_values(value)]


def create_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sets", type=set_values, help="comma-separated set codes")
    parser.add_argument("--formats", type=csv_values, default=config.FORMATS)
    parser.add_argument("--types", type=csv_values, default=config.DATA_TYPES)
    parser.add_argument(
        "--corpus",
        action="store_true",
        help="sync the DraftFM training corpus: corpus.TRAINING_SETS "
        "with per-set draft formats, draft data only, no site "
        "ratings (--sets may narrow it; eval-only sets refused)",
    )
    parser.add_argument(
        "--include-sealed",
        action="store_true",
        help="also sync Sealed game data (metrics only, no picks)",
    )
    parser.add_argument(
        "--no-ratings",
        dest="ratings",
        action="store_false",
        help="skip the once-daily card/color ratings cache",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main():
    parser = create_parser()
    args = parser.parse_args()
    sets = config.TRACKED_SETS if args.sets is None else args.sets

    ratings = args.ratings
    if args.corpus:
        try:
            pairs = corpus.corpus_jobs(args.sets)
        except ValueError as error:
            parser.error(str(error))
        jobs = [(s, f, "draft") for s, f in pairs]
        ratings = False  # bulk S3 only — never site JSON for historical sets
    else:
        jobs = [(s, f, t) for s in sets for f in args.formats for t in args.types]
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
    if ratings:
        for set_code in sets:
            for fmt in args.formats:
                results.append(
                    (
                        f"card_ratings {set_code}",
                        fmt,
                        download.fetch_card_ratings(set_code, fmt),
                    )
                )
                results.append(
                    (
                        f"color_ratings {set_code}",
                        fmt,
                        download.fetch_color_ratings(set_code, fmt),
                    )
                )

    width = max(len(f"{n} {f}") for n, f, _ in results)
    for name, fmt, status in results:
        print(f"{f'{name} {fmt}':<{width}}  {status}")


if __name__ == "__main__":
    main()
