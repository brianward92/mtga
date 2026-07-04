"""mtga/lands/download.py: conditional S3 sync + once-per-day site JSON cache.

All HTTP is mocked at mtga.lands.download.requests — nothing touches the
network.
"""

import datetime
import json
from unittest import mock

import pandas as pd
import pytest

from _synth import SET
from mtga.lands import download, paths


def _head_response(status=200, etag='"abc123"'):
    response = mock.Mock()
    response.status_code = status
    response.headers = {"ETag": etag, "Last-Modified": "Mon, 01 Jan 2026",
                        "Content-Length": "12"}
    return response


def _mock_requests(etag='"abc123"', status=200, chunks=(b"hello ", b"world")):
    requests = mock.MagicMock()  # MagicMock: get() is used as a context manager
    requests.head.return_value = _head_response(status, etag)
    stream = requests.get.return_value.__enter__.return_value
    stream.iter_content.return_value = list(chunks)
    return requests


def test_sync_url_downloads_and_writes_meta(data_root):
    dest = paths.RAW_DIR / "file.csv.gz"
    requests = _mock_requests()
    with mock.patch.object(download, "requests", requests):
        assert download.sync_url("http://x/file", dest) == download.DOWNLOADED

    assert dest.read_bytes() == b"hello world"
    assert not (dest.parent / f"{dest.name}.part").exists()  # atomic rename
    meta = json.loads(paths.meta_path(dest).read_text())
    assert meta["etag"] == '"abc123"'
    assert meta["size"] == "12"


def test_sync_url_skips_when_etag_matches(data_root):
    dest = paths.RAW_DIR / "file.csv.gz"
    requests = _mock_requests()
    with mock.patch.object(download, "requests", requests):
        assert download.sync_url("http://x/file", dest) == download.DOWNLOADED
        assert download.sync_url("http://x/file", dest) == download.SKIPPED
    requests.get.assert_called_once()  # second call was HEAD-only

    # A changed remote ETag must re-download.
    requests.head.return_value = _head_response(etag='"changed"')
    with mock.patch.object(download, "requests", requests):
        assert download.sync_url("http://x/file", dest) == download.DOWNLOADED
    assert requests.get.call_count == 2


def test_sync_url_force_redownloads_despite_matching_etag(data_root):
    dest = paths.RAW_DIR / "file.csv.gz"
    requests = _mock_requests()
    with mock.patch.object(download, "requests", requests):
        download.sync_url("http://x/file", dest)
        assert download.sync_url("http://x/file", dest, force=True) == (
            download.DOWNLOADED
        )
    assert requests.get.call_count == 2


def test_sync_url_redownloads_when_meta_sidecar_missing(data_root):
    # dest exists but there is no .meta.json -> no recorded etag -> download.
    dest = paths.RAW_DIR / "file.csv.gz"
    dest.write_bytes(b"stale")
    requests = _mock_requests()
    with mock.patch.object(download, "requests", requests):
        assert download.sync_url("http://x/file", dest) == download.DOWNLOADED
    assert dest.read_bytes() == b"hello world"


@pytest.mark.parametrize("status", [403, 404])
def test_sync_url_not_published(data_root, status):
    # S3 answers 403 for missing keys without list permission; both mean
    # "not published yet" and must not be treated as an error.
    dest = paths.RAW_DIR / "file.csv.gz"
    requests = _mock_requests(status=status)
    with mock.patch.object(download, "requests", requests):
        assert download.sync_url("http://x/file", dest) == download.NOT_PUBLISHED
    requests.get.assert_not_called()
    assert not dest.exists()


def test_sync_dataset_builds_s3_url_and_raw_path(data_root):
    requests = _mock_requests()
    with mock.patch.object(download, "requests", requests):
        assert download.sync_dataset(SET, "PremierDraft", "draft") == (
            download.DOWNLOADED
        )
    url = requests.head.call_args[0][0]
    assert url.endswith(f"/draft_data/draft_data_public.{SET}.PremierDraft.csv.gz")
    assert paths.raw_dataset_path("draft", SET, "PremierDraft").exists()


def test_fetch_card_ratings_once_per_day(data_root):
    requests = mock.Mock()
    requests.get.return_value.json.return_value = [{"name": "Card"}]
    today = datetime.date.today().isoformat()

    with mock.patch.object(download, "requests", requests):
        assert download.fetch_card_ratings(SET, "PremierDraft") == (
            download.DOWNLOADED
        )
        # Today's file now exists: the endpoint must NOT be hit again.
        assert download.fetch_card_ratings(SET, "PremierDraft") == (
            download.CACHED_TODAY
        )
    requests.get.assert_called_once()

    dated = paths.card_ratings_path(SET, "PremierDraft", today)
    assert json.loads(dated.read_text()) == [{"name": "Card"}]
    assert not (dated.parent / f"{dated.name}.part").exists()
    link = paths.latest_symlink(dated)
    assert link.is_symlink() and link.resolve() == dated.resolve()

    # No Scryfall sets.parquet in this layout -> wide-net start_date fallback.
    params = requests.get.call_args.kwargs["params"]
    assert params["expansion"] == SET
    assert params["format"] == "PremierDraft"
    assert params["start_date"] == "2020-01-01"
    assert params["end_date"] == today


def test_fetch_color_ratings_params_and_release_date(data_root):
    # color_ratings uses event_type (not format) and combine_splash, and the
    # start_date comes from the Scryfall sets parquet when present.
    pd.DataFrame({"set": ["tst"], "released_at": ["2025-05-02"]}).to_parquet(
        paths.SCRYFALL_SETS_PARQUET
    )
    requests = mock.Mock()
    requests.get.return_value.json.return_value = []
    with mock.patch.object(download, "requests", requests):
        assert download.fetch_color_ratings(SET, "TradDraft") == (
            download.DOWNLOADED
        )
    params = requests.get.call_args.kwargs["params"]
    assert params["event_type"] == "TradDraft"
    assert "format" not in params
    assert params["combine_splash"] == "true"
    assert params["start_date"] == "2025-05-02"
    today = datetime.date.today().isoformat()
    assert paths.color_ratings_path(SET, "TradDraft", today).exists()
