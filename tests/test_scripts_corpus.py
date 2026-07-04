"""--corpus flag wiring on run_17lands_download.py / run_17lands_etl.py."""

import importlib.util
import sys
from pathlib import Path

import pytest

from mtga.lands import corpus

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def download_script():
    return _load("run_17lands_download")


@pytest.fixture(scope="module")
def etl_script():
    return _load("run_17lands_etl")


def test_download_corpus_dry_run_expands_registry(download_script, monkeypatch,
                                                  capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--corpus", "--dry-run"])
    download_script.main()
    lines = [l for l in capsys.readouterr().out.splitlines() if l]
    assert len(lines) == 59  # 31 Premier + 28 Trad shards, draft type only
    assert lines[0] == "would sync: ('STX', 'PremierDraft', 'draft')"
    assert lines[-1] == "would sync: ('SOS', 'TradDraft', 'draft')"
    assert all("'draft'" in l for l in lines)  # never game data
    assert not any("MSH" in l for l in lines)


def test_download_corpus_narrowed_by_sets(download_script, monkeypatch, capsys):
    monkeypatch.setattr(
        sys, "argv", ["prog", "--corpus", "--sets", "AFR,SOS", "--dry-run"]
    )
    download_script.main()
    lines = [l for l in capsys.readouterr().out.splitlines() if l]
    assert lines == [
        "would sync: ('AFR', 'PremierDraft', 'draft')",
        "would sync: ('SOS', 'PremierDraft', 'draft')",
        "would sync: ('SOS', 'TradDraft', 'draft')",
    ]


def test_download_corpus_refuses_msh(download_script, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--corpus", "--sets", "MSH"])
    with pytest.raises(SystemExit) as excinfo:
        download_script.main()
    assert excinfo.value.code == 2
    assert "EVAL_ONLY" in capsys.readouterr().err


def test_download_corpus_forces_no_ratings(download_script, monkeypatch):
    calls = []
    monkeypatch.setattr(download_script.download, "sync_cards_csv",
                        lambda force=False: "SKIPPED")
    monkeypatch.setattr(download_script.download, "sync_abilities_csv",
                        lambda force=False: "SKIPPED")
    monkeypatch.setattr(download_script.download, "sync_dataset",
                        lambda s, f, t, force=False: calls.append((s, f, t)) or "SKIPPED")
    monkeypatch.setattr(download_script.download, "fetch_card_ratings",
                        lambda *a: pytest.fail("ratings fetched under --corpus"))
    monkeypatch.setattr(download_script.download, "fetch_color_ratings",
                        lambda *a: pytest.fail("ratings fetched under --corpus"))
    monkeypatch.setattr(sys, "argv", ["prog", "--corpus", "--sets", "STX"])
    download_script.main()
    assert calls == [("STX", "PremierDraft", "draft"), ("STX", "TradDraft", "draft")]


def test_etl_corpus_curates_draft_shards_only(etl_script, monkeypatch, capsys):
    called = []
    monkeypatch.setattr(etl_script.etl, "curate_draft",
                        lambda s, f, force=False: called.append((s, f)) or {"status": "X"})
    monkeypatch.setattr(etl_script.etl, "curate_game",
                        lambda *a, **k: pytest.fail("game curation under --corpus"))
    monkeypatch.setattr(sys, "argv", ["prog", "--corpus"])
    etl_script.main()
    assert called == corpus.corpus_jobs()
    assert len(called) == 59


def test_etl_corpus_refuses_msh(etl_script, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--corpus", "--sets", "SOS,MSH"])
    with pytest.raises(SystemExit) as excinfo:
        etl_script.main()
    assert excinfo.value.code == 2
    assert "EVAL_ONLY" in capsys.readouterr().err
