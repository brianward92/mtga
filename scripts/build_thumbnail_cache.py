#!/usr/bin/env python3
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path

import requests

REQUEST_TIMEOUT = 20
DEFAULT_WORKERS = 6
HEADERS = {
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "User-Agent": "mtga/0.2 (brian.ward.92@gmail.com)",
}


def create_parser():
    parser = argparse.ArgumentParser(
        description="Build local thumbnail cache for MTG Registry."
    )
    parser.add_argument(
        "--app-data-dir",
        type=Path,
        help="Path to app/data. Defaults to this repo's app/data.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help="Persistent thumbnail cache directory.",
    )
    parser.add_argument(
        "--sets",
        nargs="*",
        help="Set codes to cache. Defaults to manifest defaultSetCode.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Cache every set in the manifest.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Redownload thumbnails even when local files exist.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Concurrent image downloads. Defaults to {DEFAULT_WORKERS}.",
    )
    return parser


def read_json(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resolve_app_data_dir(args):
    if args.app_data_dir:
        return args.app_data_dir
    script_dir = Path(__file__).resolve().parent
    return script_dir.parent / "app" / "data"


def resolve_cache_dir(args, app_data_dir):
    if args.cache_dir:
        cache_dir = args.cache_dir
    else:
        user = os.getenv("USER", "unknown")
        cache_dir = Path(f"/opt/{user}/dat/mtga/app-thumbnails")

    app_data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    public_dir = app_data_dir / "images"

    if public_dir.is_symlink():
        if public_dir.resolve() != cache_dir.resolve():
            public_dir.unlink()
            public_dir.symlink_to(cache_dir, target_is_directory=True)
    elif public_dir.exists():
        if not public_dir.is_dir():
            raise ValueError(f"Refusing to replace non-directory at {public_dir}")
        cache_dir = public_dir
    else:
        public_dir.symlink_to(cache_dir, target_is_directory=True)

    return cache_dir


def select_set_codes(manifest, args):
    manifest_sets = manifest.get("sets") or []
    known_codes = [
        set_meta["setCode"] for set_meta in manifest_sets if set_meta.get("setCode")
    ]
    known_set = set(known_codes)

    if args.all:
        return known_codes
    if args.sets:
        requested_codes = [code.upper() for code in args.sets]
        missing_codes = [code for code in requested_codes if code not in known_set]
        if missing_codes:
            raise ValueError(f"Sets not found in manifest: {', '.join(missing_codes)}")
        return requested_codes

    default_set_code = manifest.get("defaultSetCode")
    if not default_set_code:
        raise ValueError("Manifest has no defaultSetCode.")
    return [default_set_code]


def decode_set_cards(payload):
    cards = payload.get("cards")
    if not isinstance(cards, list):
        raise ValueError("Set payload has no cards array.")

    if not cards:
        return []
    if not isinstance(cards[0], list):
        return cards

    fields = payload.get("fields") or []
    if not fields:
        raise ValueError("Compact set payload has no fields array.")
    return [dict(zip(fields, row)) for row in cards]


def collect_jobs(app_data_dir, manifest, set_codes, cache_dir, refresh):
    set_by_code = {
        set_meta["setCode"]: set_meta
        for set_meta in manifest.get("sets") or []
        if set_meta.get("setCode")
    }

    jobs = []
    total_cards = 0
    for set_code in set_codes:
        set_meta = set_by_code[set_code]
        set_path = app_data_dir / set_meta["cardsPath"]
        payload = read_json(set_path)
        cards = decode_set_cards(payload)
        total_cards += len(cards)
        for card in cards:
            card_id = card.get("id")
            image_url = card.get("imageSmallUrl") or card.get("imageUrl")
            if not card_id or not image_url:
                continue
            dest_path = cache_dir / f"{card_id}.jpg"
            if not refresh and dest_path.exists() and dest_path.stat().st_size > 0:
                continue
            jobs.append((image_url, dest_path))

    return jobs, total_cards


def download_thumbnail(job):
    image_url, dest_path = job
    response = requests.get(image_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    if not response.content:
        raise ValueError(f"Empty response for {image_url}")

    tmp_path = dest_path.with_name(f".{dest_path.name}.{os.getpid()}.tmp")
    with tmp_path.open("wb") as f:
        f.write(response.content)
    tmp_path.replace(dest_path)
    return dest_path


def download_jobs(jobs, workers):
    if not jobs:
        return 0, 0

    completed_count = 0
    failed_count = 0
    worker_count = max(1, min(workers, len(jobs)))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_to_job = {executor.submit(download_thumbnail, job): job for job in jobs}
        for future in as_completed(future_to_job):
            image_url, _ = future_to_job[future]
            try:
                future.result()
                completed_count += 1
            except Exception as exc:
                failed_count += 1
                print(f"Could not cache {image_url}: {exc}")

    return completed_count, failed_count


if __name__ == "__main__":
    args = create_parser().parse_args()
    app_data_dir = resolve_app_data_dir(args)
    manifest_path = app_data_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    manifest = read_json(manifest_path)
    set_codes = select_set_codes(manifest, args)
    cache_dir = resolve_cache_dir(args, app_data_dir)
    jobs, total_cards = collect_jobs(
        app_data_dir,
        manifest,
        set_codes,
        cache_dir,
        args.refresh,
    )

    print(f"Thumbnail cache: {cache_dir}")
    print(f"Set thumbnails requested: {', '.join(set_codes)}")
    print(f"Cards scanned: {total_cards:,}; missing thumbnails: {len(jobs):,}")
    completed_count, failed_count = download_jobs(jobs, args.workers)
    print(
        "Thumbnail cache complete: "
        f"{completed_count:,} downloaded, {failed_count:,} failed, "
        f"{len(jobs) - completed_count - failed_count:,} skipped in-flight."
    )
