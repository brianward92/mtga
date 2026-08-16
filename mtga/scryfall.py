import datetime
import gzip
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import requests

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"
REQUEST_TIMEOUT = 30
SCRYFALL_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "mtga/0.2 (brian.ward.92@gmail.com)",
}

_BULK_DATA = None


def get_bulk_data_urls(refresh=False):
    global _BULK_DATA
    if refresh or (_BULK_DATA is None):
        print(f"Fetching bulk data info from {BULK_DATA_URL}.")
        response = requests.get(
            BULK_DATA_URL, headers=SCRYFALL_HEADERS, timeout=REQUEST_TIMEOUT
        )
        response.raise_for_status()
        _BULK_DATA = response.json()
    return _BULK_DATA


def get_bulk_data_item(data_type, refresh=False):
    """Return the unique bulk-data listing entry for ``data_type``."""
    found = None
    for item in get_bulk_data_urls(refresh=refresh)["data"]:
        if item.get("type") != data_type:
            continue
        if found is not None:
            raise ValueError(f"Multiple `{data_type}` entries!")
        found = item
    if found is None:
        raise ValueError(f"No `{data_type}` entries!")
    return found


def bulk_item_download_uri(item):
    """Download URI from either generation of Scryfall's bulk API."""
    # In July 2026 Scryfall replaced the JSON-array `download_uri` with a
    # gzipped JSONL `jsonl_download_uri`. Keep old snapshots reproducible.
    uri = item.get("jsonl_download_uri") or item.get("download_uri")
    if not uri:
        raise ValueError(
            f"`{item.get('type')}` entry has no download uri " f"(keys: {sorted(item)})"
        )
    return str(uri)


def bulk_item_date(item):
    """UTC ``YYYY-MM-DD`` from a listing entry's required ``updated_at``."""
    stamp = str(item.get("updated_at") or "")
    try:
        # ``Z`` is accepted by recent Python, but +00:00 also works on the
        # older interpreters used by a few data jobs.
        parsed = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as err:
        raise ValueError(
            f"`{item.get('type')}` entry has invalid updated_at {stamp!r}"
        ) from err
    return parsed.date().isoformat()


def bulk_item_extension(item):
    """A supported local suffix matching the listing's actual payload."""
    path = urlparse(bulk_item_download_uri(item)).path.lower()
    for suffix in (".jsonl.gz", ".json.gz", ".jsonl", ".json"):
        if path.endswith(suffix):
            return suffix
    # The field itself is authoritative when a CDN URI has no useful suffix.
    return ".jsonl.gz" if item.get("jsonl_download_uri") else ".json"


_DOWNLOAD_URLS = dict()


def get_download_url(data_type, refresh=False):
    global _DOWNLOAD_URLS
    if refresh or (data_type not in _DOWNLOAD_URLS):
        item = get_bulk_data_item(data_type, refresh=refresh)
        _DOWNLOAD_URLS[data_type] = bulk_item_download_uri(item)
    print(f"`{data_type}` available at {_DOWNLOAD_URLS[data_type]}.")
    return _DOWNLOAD_URLS[data_type]


def bulk_meta_path(path):
    return Path(f"{path}.meta.json")


def download_bulk_data(
    data_type, dest_path, refresh=False, chunk_size=1 << 20, item=None
):
    """Stream a bulk payload and atomically publish it plus provenance.

    ``item`` lets callers use the exact listing entry they already inspected,
    avoiding a second API request racing to a different snapshot.
    """
    if chunk_size <= 0:
        raise ValueError(f"chunk_size must be positive, got {chunk_size}")
    item = get_bulk_data_item(data_type, refresh=refresh) if item is None else item
    if item.get("type") != data_type:
        raise ValueError(
            f"bulk item type {item.get('type')!r} does not match {data_type!r}"
        )
    uri = bulk_item_download_uri(item)
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    part = dest_path.with_name(dest_path.name + ".part")
    print(f"Downloading `{data_type}` ({item.get('updated_at')}) from {uri}.")
    try:
        with requests.get(
            uri, headers=SCRYFALL_HEADERS, timeout=REQUEST_TIMEOUT, stream=True
        ) as response:
            response.raise_for_status()
            with open(part, "wb") as fh:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        fh.write(chunk)
        expected = item.get("size")
        if expected is not None and part.stat().st_size != int(expected):
            raise IOError(
                f"downloaded `{data_type}` size {part.stat().st_size} != "
                f"listing size {expected}"
            )
        os.replace(part, dest_path)
    except Exception:
        part.unlink(missing_ok=True)
        raise

    meta = {
        "type": data_type,
        "updated_at": item.get("updated_at"),
        "download_uri": uri,
        "size": item.get("size"),
        "downloaded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
    }
    meta_path = bulk_meta_path(dest_path)
    meta_tmp = meta_path.with_name(meta_path.name + ".tmp")
    try:
        with open(meta_tmp, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2)
        os.replace(meta_tmp, meta_path)
    except Exception:
        meta_tmp.unlink(missing_ok=True)
        raise
    return item


def get_latest_all_cards_data():
    download_url = get_download_url("all_cards")
    data_response = requests.get(
        download_url, headers=SCRYFALL_HEADERS, timeout=REQUEST_TIMEOUT
    )
    data_response.raise_for_status()
    content = data_response.content
    if content[:2] == b"\x1f\x8b":  # gzip magic (jsonl.gz bulk files)
        content = gzip.decompress(content)
    return content


def parse_cards_payload(data):
    """Parse an all_cards payload: legacy JSON array or JSONL (one card
    object per line, the format Scryfall bulk data switched to 2026-07-29).
    Returns a list of card dicts."""
    text = data.decode("utf-8-sig")
    head = text.lstrip()[:1]
    if head == "[":
        return json.loads(text)
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def iter_bulk_cards(path):
    """Yield cards from JSONL or a JSON array, with optional gzip.

    Compression is detected by magic bytes rather than the filename so a
    legacy API URI or an explicitly supplied path cannot be misclassified.
    """
    path = Path(path)
    with open(path, "rb") as raw:
        compressed = raw.read(2) == b"\x1f\x8b"
    opener = gzip.open if compressed else open
    with opener(path, "rt", encoding="utf-8-sig") as fh:
        first = fh.read(1)
        while first and first.isspace():
            first = fh.read(1)
        if not first:
            raise ValueError(f"empty Scryfall bulk file: {path}")
        fh.seek(0)
        if first == "[":
            try:
                payload = json.load(fh)
            except json.JSONDecodeError as err:
                raise ValueError(f"invalid JSON array in {path}: {err}") from err
            if not isinstance(payload, list):
                raise ValueError(f"Scryfall JSON payload in {path} is not an array")
            yield from payload
            return
        for line_number, line in enumerate(fh, start=1):
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as err:
                    raise ValueError(
                        f"invalid JSONL in {path} at line {line_number}: {err}"
                    ) from err
