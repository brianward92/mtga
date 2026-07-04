"""mtga/lands/paths.py: layout helpers and the atomic latest-symlink."""

import os
from pathlib import Path

from mtga.lands import paths


def test_data_root_comes_from_env_var():
    # conftest sets MTGA_DATA_ROOT before any mtga import; the module-level
    # constant must reflect it (this is what keeps the whole suite hermetic).
    assert paths.DATA_ROOT == Path(os.environ["MTGA_DATA_ROOT"])
    assert paths.LANDS_DIR == paths.DATA_ROOT / "17lands"


def test_path_helpers_shapes(data_root):
    raw = paths.raw_dataset_path("draft", "SOS", "PremierDraft")
    assert raw == data_root / "17lands/raw/draft_data_public.SOS.PremierDraft.csv.gz"
    assert paths.meta_path(raw).name == raw.name + ".meta.json"
    assert paths.curated_path("game", "SOS", "TradDraft") == (
        data_root / "17lands/curated/game/SOS.TradDraft.parquet"
    )
    assert paths.vocab_path("SOS", "TradDraft").name == "SOS.TradDraft.vocab.json"
    assert paths.card_ratings_path("SOS", "PremierDraft", "2026-01-02") == (
        data_root / "17lands/card_ratings/SOS/PremierDraft/2026-01-02.json"
    )
    assert paths.model_dir("SOS", "PremierDraft", "v1") == (
        data_root / "models/SOS/PremierDraft/v1"
    )


def test_latest_symlink_naming(data_root):
    dated = paths.metrics_cards_path("SOS", "PremierDraft", "2026-01-02")
    assert paths.latest_symlink(dated, prefix="cards_").name == "cards_latest.parquet"
    dated_json = paths.card_ratings_path("SOS", "PremierDraft", "2026-01-02")
    assert paths.latest_symlink(dated_json).name == "latest.json"


def test_repoint_latest_repoints_atomically(tmp_path):
    a = tmp_path / "2026-01-01.json"
    b = tmp_path / "2026-01-02.json"
    a.write_text('"a"')
    b.write_text('"b"')

    link = paths.repoint_latest(a)
    assert link.is_symlink()
    assert os.readlink(link) == a.name  # relative target, survives dir moves
    assert link.read_text() == '"a"'

    # Repointing over an existing symlink must swap, not fail.
    link = paths.repoint_latest(b)
    assert os.readlink(link) == b.name
    assert link.read_text() == '"b"'
    assert not (tmp_path / f".{link.name}.tmp").exists()


def test_repoint_latest_with_prefix(tmp_path):
    dated = tmp_path / "cards_2026-01-01.parquet"
    dated.write_bytes(b"x")
    link = paths.repoint_latest(dated, prefix="cards_")
    assert link.name == "cards_latest.parquet"
    assert os.readlink(link) == dated.name
