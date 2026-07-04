"""Sync 17Lands public data to the local data root.

Bulk S3 dumps (CC BY 4.0) are the sanctioned bulk path: conditional download
via ETag, atomic .part rename, .meta.json sidecars. The site JSON endpoints
(card_ratings / color_ratings) are fetched at most once per day per
(set, format) and cached forever — never scraped in a loop.
"""

import datetime
import json

import requests

from mtga.lands import config, paths

CHUNK_BYTES = 1 << 20

HEADERS = {"User-Agent": config.USER_AGENT}

# Sync result states
DOWNLOADED = "DOWNLOADED"
SKIPPED = "SKIPPED"
NOT_PUBLISHED = "NOT_PUBLISHED"
CACHED_TODAY = "CACHED_TODAY"


def _read_meta(path):
    meta = paths.meta_path(path)
    if meta.exists():
        with open(meta) as file:
            return json.load(file)
    return {}


def _write_meta(path, remote):
    meta = paths.meta_path(path)
    payload = {
        "etag": remote.get("ETag"),
        "last_modified": remote.get("Last-Modified"),
        "size": remote.get("Content-Length"),
        "fetched_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    with open(meta, "w") as file:
        json.dump(payload, file, indent=2)
    return payload


def _stream_download(url, dest, remote_headers):
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.parent / f"{dest.name}.part"
    with requests.get(
        url, headers=HEADERS, timeout=config.REQUEST_TIMEOUT, stream=True
    ) as response:
        response.raise_for_status()
        with open(part, "wb") as file:
            for chunk in response.iter_content(CHUNK_BYTES):
                file.write(chunk)
    part.replace(dest)
    _write_meta(dest, remote_headers)


def sync_url(url, dest, force=False):
    """Conditionally download url -> dest. Returns a sync-state string."""
    head = requests.head(url, headers=HEADERS, timeout=config.REQUEST_TIMEOUT)
    if head.status_code in (403, 404):
        # S3 returns 403 for missing keys without list permission; both mean
        # "not published yet", the normal state for a new set's first weeks.
        return NOT_PUBLISHED
    head.raise_for_status()

    if not force and dest.exists():
        meta = _read_meta(dest)
        if meta.get("etag") and meta["etag"] == head.headers.get("ETag"):
            return SKIPPED

    print(f"Downloading {url}")
    _stream_download(url, dest, head.headers)
    return DOWNLOADED


def sync_dataset(set_code, limited_type, data_type, force=False):
    url = f"{config.S3_BASE}/{data_type}_data/{data_type}_data_public.{set_code}.{limited_type}.csv.gz"
    dest = paths.raw_dataset_path(data_type, set_code, limited_type)
    return sync_url(url, dest, force=force)


def sync_cards_csv(force=False):
    return sync_url(f"{config.S3_BASE}/cards/cards.csv", paths.CARDS_CSV, force=force)


def sync_abilities_csv(force=False):
    return sync_url(
        f"{config.S3_BASE}/cards/abilities.csv", paths.ABILITIES_CSV, force=force
    )


def _set_release_date(set_code):
    """Set release date from the nightly Scryfall sets.parquet, else a wide net."""
    try:
        import pandas as pd

        sets = pd.read_parquet(paths.SCRYFALL_SETS_PARQUET)
        row = sets[sets["set"].str.upper() == set_code.upper()]
        if len(row):
            return str(row.iloc[0]["released_at"])[:10]
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: could not resolve release date for {set_code}: {e}")
    return "2020-01-01"


def _fetch_site_json(url, params, dest):
    """Once-per-day cached fetch of a 17Lands site endpoint."""
    if dest.exists():
        return CACHED_TODAY
    print(f"Fetching {url} {params}")
    response = requests.get(
        url, params=params, headers=HEADERS, timeout=config.REQUEST_TIMEOUT
    )
    response.raise_for_status()
    payload = response.json()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.parent / f"{dest.name}.part"
    with open(tmp, "w") as file:
        json.dump(payload, file)
    tmp.replace(dest)
    paths.repoint_latest(dest)
    return DOWNLOADED


def fetch_card_ratings(set_code, limited_type):
    today = datetime.date.today().isoformat()
    dest = paths.card_ratings_path(set_code, limited_type, today)
    params = {
        "expansion": set_code,
        "format": limited_type,
        "start_date": _set_release_date(set_code),
        "end_date": today,
    }
    return _fetch_site_json(f"{config.SITE_BASE}/card_ratings/data", params, dest)


def fetch_color_ratings(set_code, limited_type):
    today = datetime.date.today().isoformat()
    dest = paths.color_ratings_path(set_code, limited_type, today)
    params = {
        "expansion": set_code,
        "event_type": limited_type,  # note: event_type, not format
        "start_date": _set_release_date(set_code),
        "end_date": today,
        "combine_splash": "true",
    }
    return _fetch_site_json(f"{config.SITE_BASE}/color_ratings/data", params, dest)
