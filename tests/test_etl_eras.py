"""mtga/lands/etl.py schema-era normalization: every era curates to one
canonical modern column layout, so downstream code never branches."""

import gzip
import io
import json
import tarfile

import numpy as np
import pandas as pd
import pytest

import _synth
from _synth import FMT, SET, VOCAB
from mtga.lands import etl, paths


def _curate(set_code):
    result = etl.curate_draft(set_code, FMT)
    assert result["status"] == "CURATED"
    return pd.read_parquet(paths.curated_path("draft", set_code, FMT))


def _curated_meta(set_code):
    return json.loads(
        paths.meta_path(paths.curated_path("draft", set_code, FMT)).read_text()
    )


def test_detect_schema_era():
    assert etl.detect_schema_era(["expansion", "rank", "pick"]) == "modern"
    assert etl.detect_schema_era(["user_n_matches_bucket", "pick"]) == "match_buckets"
    assert etl.detect_schema_era(
        ["user_n_matches_bucket", "user_rank", "pick"]
    ) == "match_buckets_rank"


def test_old_schema_curates_to_identical_columns(data_root):
    _synth.write_draft_csv(
        paths.raw_dataset_path("draft", SET, FMT), _synth.hand_draft_rows()
    )
    modern = _curate(SET)

    _synth.write_old_draft_csv(
        paths.raw_dataset_path("draft", "OLD", FMT), _synth.hand_draft_rows()
    )
    old = _curate("OLD")

    # Identical canonical column set, order, and dtypes across eras.
    assert list(old.columns) == list(modern.columns)
    assert list(old.dtypes.astype(str)) == list(modern.dtypes.astype(str))

    # Match-bucket aliases mapped onto the modern game-bucket names
    # (values carried over unchanged: match == game for Bo1 Premier).
    assert (old["user_n_games_bucket"] == 100).all()
    assert np.allclose(old["user_game_win_rate_bucket"], 0.54)

    # Canonical columns absent from the old header land as NULLs...
    for column in ["rank", "pick_2", "pick_maindeck_rate", "pick_sideboard_in_rate"]:
        assert old[column].isna().all(), column
    # ...while genuinely present ones keep their values.
    assert (old["draft_time"] == "2021-04-20 12:00:00").all()
    assert (old["mystery_meta"] == "arbitrary").all()

    # pick_index logic is unchanged across eras.
    for row in old.itertuples():
        expected = VOCAB.index(row.pick) if row.pick in VOCAB else -1
        assert row.pick_index == expected

    assert _curated_meta("OLD")["schema_era"] == "match_buckets"
    assert _curated_meta(SET)["schema_era"] == "modern"


def test_mid_era_user_rank_maps_to_rank(data_root):
    rows = _synth.hand_draft_rows()
    _synth.write_old_draft_csv(
        paths.raw_dataset_path("draft", "OLDR", FMT), rows,
        era="match_buckets_rank",
    )
    frame = _curate("OLDR")
    assert (frame["rank"] == "platinum").all()
    assert _curated_meta("OLDR")["schema_era"] == "match_buckets_rank"
    # rank came via the alias; the other NULL fills still apply.
    assert frame["pick_2"].isna().all()


def test_meta_records_empirical_pack_shape(data_root):
    # Drafts that include pack 0 pick 0 -> P1P1 present, 4 picks per pack.
    rows = [
        dict(draft_id="d1", pack_number=pack, pick_number=i,
             pick=VOCAB[i], pack={VOCAB[i]: 1}, pool={})
        for pack in (0, 1) for i in range(4)
    ]
    _synth.write_draft_csv(paths.raw_dataset_path("draft", SET, FMT), rows)
    etl.curate_draft(SET, FMT)
    meta = _curated_meta(SET)
    assert meta["p1p1_missing"] is False
    assert meta["picks_per_pack"] == 4  # max(pick_number) + 1

    # Same drafts without any pack-0 rows -> flagged p1p1_missing.
    _synth.write_old_draft_csv(
        paths.raw_dataset_path("draft", "OLD", FMT),
        [r | {"pack_number": r["pack_number"] + 1} for r in rows],
    )
    etl.curate_draft("OLD", FMT)
    assert _curated_meta("OLD")["p1p1_missing"] is True


def test_missing_required_column_hard_fails(data_root):
    dest = paths.raw_dataset_path("draft", "BAD", FMT)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wt", newline="") as fh:
        fh.write("expansion,pack_number,pick_number,pick\r\nBAD,0,0,X\r\n")
    with pytest.raises(ValueError, match=r"required draft columns.*draft_id"):
        etl.curate_draft("BAD", FMT)


def test_tar_wrapped_old_schema_curates_end_to_end(data_root):
    """decode hook + era normalization + original-etag skip logic together."""
    plain = data_root / "plain.csv.gz"
    _synth.write_old_draft_csv(plain, _synth.hand_draft_rows(), etag=None)
    csv_bytes = gzip.decompress(plain.read_bytes())

    raw = paths.raw_dataset_path("draft", "STX", FMT)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        info = tarfile.TarInfo("draft_data_public.STX.PremierDraft.csv")
        info.size = len(csv_bytes)
        tar.addfile(info, io.BytesIO(csv_bytes))
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(buf.getvalue())
    with open(paths.meta_path(raw), "w") as fh:
        json.dump({"etag": "etag-tar-1"}, fh)

    result = etl.curate_draft("STX", FMT)
    assert result["status"] == "CURATED"
    assert result["schema_era"] == "match_buckets"
    assert (paths.RAW_DIR / "decoded" / raw.name).exists()

    # source_etag is the ORIGINAL raw file's etag, so --if-new-data style
    # skip logic still keys on the S3 file.
    meta = _curated_meta("STX")
    assert meta["source_etag"] == "etag-tar-1"
    assert meta["schema_era"] == "match_buckets"
    assert etl.curate_draft("STX", FMT)["status"] == "SKIPPED"
