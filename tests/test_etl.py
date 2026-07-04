"""mtga/lands/etl.py: header classification and duckdb curation."""

import gzip
import json

import pandas as pd
import pytest

import _synth
from _synth import FMT, SET, VOCAB
from mtga.lands import etl, paths


def test_classify_columns_draft_header():
    header = [
        "draft_id", "pick", "event_match_wins", "mystery_meta",
        f"pack_card_{VOCAB[0]}", f"pack_card_{VOCAB[1]}",
        f"pool_{VOCAB[0]}", f"pool_{VOCAB[1]}",
    ]
    columns, cards = etl.classify_columns(
        header, [etl.PACK_PREFIX, etl.POOL_PREFIX], etl.DRAFT_META_TYPES
    )
    assert list(columns) == header  # file order preserved
    assert columns["draft_id"] == "VARCHAR"
    assert columns["event_match_wins"] == "TINYINT"
    assert columns["mystery_meta"] == "VARCHAR"  # unknown meta -> VARCHAR
    assert columns[f"pack_card_{VOCAB[0]}"] == "TINYINT"
    assert columns[f"pool_{VOCAB[1]}"] == "TINYINT"
    assert cards[etl.PACK_PREFIX] == VOCAB[:2]
    assert cards[etl.POOL_PREFIX] == VOCAB[:2]


def test_classify_columns_game_header():
    header = ["won", "num_turns", f"opening_hand_{VOCAB[0]}", f"deck_{VOCAB[0]}"]
    columns, cards = etl.classify_columns(
        header, etl.GAME_CARD_PREFIXES, etl.GAME_META_TYPES
    )
    assert columns["won"] == "BOOLEAN"
    assert columns["num_turns"] == "SMALLINT"
    assert cards["opening_hand_"] == [VOCAB[0]]
    assert cards["deck_"] == [VOCAB[0]]
    assert cards["drawn_"] == []


def test_curate_draft_writes_parquet_vocab_and_pick_index(draft_raw, capsys):
    result = etl.curate_draft(SET, FMT)
    assert result["status"] == "CURATED"
    assert result["rows"] == 9
    assert result["vocab"] == 4
    # One pick ("Unknown Card") is outside the vocabulary -> warning printed.
    assert "1/9 picks did not match the vocabulary" in capsys.readouterr().out

    # vocab.json preserves the pack_card_ column order exactly (it is the
    # model vocabulary; NOT sorted).
    vocab = json.loads(paths.vocab_path(SET, FMT).read_text())
    assert vocab == {"set": SET, "format": FMT, "names": VOCAB}

    out = paths.curated_path("draft", SET, FMT)
    frame = pd.read_parquet(out)
    assert len(frame) == 9
    # Card-count columns landed as TINYINT (int8), incl. quoted/comma names.
    for name in VOCAB:
        assert frame[f"pack_card_{name}"].dtype == "int8"
        assert frame[f"pool_{name}"].dtype == "int8"
    # pick_index joins pick name -> vocab position; unknown names get -1.
    # (Row order is not guaranteed: preserve_insertion_order=false.)
    for row in frame.itertuples():
        expected = VOCAB.index(row.pick) if row.pick in VOCAB else -1
        assert row.pick_index == expected
    assert (frame["pick_index"] == -1).sum() == 1

    # Curated meta now also records the schema era and empirical pack shape
    # (the fixture's drafts sit in pack 1, so pack-0-pick-0 is absent).
    meta = json.loads(paths.meta_path(out).read_text())
    assert meta == {"source_etag": "etag-draft-1", "rows": 9,
                    "schema_era": "modern", "p1p1_missing": True,
                    "picks_per_pack": 4}


def test_curate_draft_skips_on_matching_source_etag(curated_draft, draft_raw):
    assert etl.curate_draft(SET, FMT)["status"] == "SKIPPED"

    # force bypasses the etag check ...
    assert etl.curate_draft(SET, FMT, force=True)["status"] == "CURATED"

    # ... and a new raw etag invalidates the curated file.
    with open(paths.meta_path(draft_raw), "w") as fh:
        json.dump({"etag": "etag-draft-2"}, fh)
    assert etl.curate_draft(SET, FMT)["status"] == "CURATED"


def test_curate_draft_without_raw_meta_never_skips(data_root):
    # No .meta.json on the raw file -> unknown etag -> always re-curate.
    dest = paths.raw_dataset_path("draft", SET, FMT)
    _synth.write_draft_csv(dest, _synth.hand_draft_rows(), etag=None)
    assert etl.curate_draft(SET, FMT)["status"] == "CURATED"
    assert etl.curate_draft(SET, FMT)["status"] == "CURATED"


def test_curate_draft_missing_raw(data_root):
    result = etl.curate_draft("NOP", FMT)
    assert result["status"] == "MISSING_RAW"


def test_curate_draft_pack_pool_order_mismatch_raises(data_root):
    dest = paths.raw_dataset_path("draft", SET, FMT)
    _synth.write_draft_csv(
        dest, _synth.hand_draft_rows(), pool_order=list(reversed(VOCAB))
    )
    with pytest.raises(ValueError, match="pack/pool column order mismatch"):
        etl.curate_draft(SET, FMT)


def test_curate_game_writes_typed_parquet(curated_game):
    assert curated_game["rows"] == 6
    assert curated_game["cards"] == 4

    frame = pd.read_parquet(paths.curated_path("game", SET, FMT))
    assert len(frame) == 6
    assert frame["won"].dtype == bool
    assert frame["won"].sum() == 4  # games 1,2,4,6
    assert frame["num_turns"].dtype == "int16"
    for prefix in etl.GAME_CARD_PREFIXES:
        for name in VOCAB:
            assert frame[f"{prefix}{name}"].dtype == "int8"
    # Spot check a tricky column: A was in the deck in games 1-5, twice in g3.
    assert sorted(frame[f"deck_{_synth.CARD_A}"]) == [0, 1, 1, 1, 1, 2]

    assert etl.curate_game(SET, FMT)["status"] == "SKIPPED"


def test_curate_game_prefix_mismatch_raises(data_root):
    # deck_* covers one card fewer than opening_hand_* -> hard error.
    dest = paths.raw_dataset_path("game", SET, FMT)
    _synth.write_game_csv(dest, prefix_names={"deck_": VOCAB[:-1]})
    with pytest.raises(ValueError, match="card column mismatch"):
        etl.curate_game(SET, FMT)


def test_curate_game_missing_raw(data_root):
    assert etl.curate_game("NOP", FMT)["status"] == "MISSING_RAW"


def test_read_header_handles_gzip_and_quoting(data_root):
    dest = paths.RAW_DIR / "h.csv.gz"
    with gzip.open(dest, "wt", newline="") as fh:
        fh.write('a,"pack_card_Alibou, Ancient Witness",c\r\n1,2,3\r\n')
    assert etl.read_header(dest) == ["a", "pack_card_Alibou, Ancient Witness", "c"]
