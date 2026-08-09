"""scripts/build_data_manifest.py: freezing and re-verifying the raw corpus."""

import gzip
import importlib.util
import json
from pathlib import Path

import pytest

from _synth import FMT, SET
from mtga.lands import paths

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"

spec = importlib.util.spec_from_file_location(
    "build_data_manifest", SCRIPTS / "build_data_manifest.py"
)
bdm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bdm)


def _write_raw(set_code=SET, fmt=FMT, payload=b"raw,rows\n1,2\n", etag='"abc123"'):
    dest = paths.raw_dataset_path("draft", set_code, fmt)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wb") as fh:
        fh.write(payload)
    with open(paths.meta_path(dest), "w") as fh:
        json.dump({"etag": etag, "fetched_at": "2026-07-01T00:00:00"}, fh)
    return dest


@pytest.fixture
def corpus_on_disk(data_root):
    raw = _write_raw()
    curated = paths.curated_path("draft", SET, FMT)
    curated.parent.mkdir(parents=True, exist_ok=True)
    with open(paths.meta_path(curated), "w") as fh:
        json.dump({"source_etag": '"abc123"', "rows": 8, "schema_era": "modern"}, fh)
    paths.FEATURIZER_MANIFEST.write_text(
        json.dumps({"content_hash": "manifest-hash-1"})
    )
    paths.CARDFEATS_PARQUET.write_bytes(b"not-really-parquet")
    paths.TEXT_EMB_CACHE.parent.mkdir(parents=True, exist_ok=True)
    paths.TEXT_EMB_CACHE.write_bytes(b"not-really-npz")
    return raw


def test_build_records_etag_sha_size_rows_and_features(corpus_on_disk):
    manifest = bdm.build()
    (entry,) = manifest["files"]
    assert entry["filename"] == f"draft_data_public.{SET}.{FMT}.csv.gz"
    assert entry["etag"] == '"abc123"'
    assert entry["sha256"] == bdm.file_sha256(corpus_on_disk)
    assert entry["size"] == corpus_on_disk.stat().st_size
    assert entry["rows"] == 8
    assert manifest["features"]["featurizer_manifest_hash"] == "manifest-hash-1"
    assert manifest["features"]["cardfeats_sha256"] == bdm.file_sha256(
        paths.CARDFEATS_PARQUET
    )
    assert manifest["features"]["text_emb_sha256"] == bdm.file_sha256(
        paths.TEXT_EMB_CACHE
    )
    assert manifest["content_hash"] == bdm.content_hash(manifest)


def test_manifest_v1_states_msh_absent(corpus_on_disk):
    manifest = bdm.build()
    assert manifest["eval_only"]["MSH"]["present"] is False
    assert "files" not in manifest["eval_only"]["MSH"]


def test_build_refuses_eval_only_raw_data(corpus_on_disk):
    _write_raw(set_code="MSH")
    with pytest.raises(SystemExit, match="EVAL_ONLY"):
        bdm.build()
    # The T0 freeze records the snapshot in the eval_only section instead.
    manifest = bdm.build(allow_eval_only=True)
    assert manifest["eval_only"]["MSH"]["present"] is True
    assert len(manifest["eval_only"]["MSH"]["files"]) == 1
    assert [e["filename"] for e in manifest["files"]] == [
        f"draft_data_public.{SET}.{FMT}.csv.gz"
    ]


def test_check_passes_then_catches_drift(corpus_on_disk, capsys):
    bdm.main([])
    assert bdm.manifest_path().exists()
    bdm.main(["--check"])  # clean: no SystemExit
    assert "OK" in capsys.readouterr().out

    # Tamper with the raw bytes: sha256 (and size) drift must be caught.
    _write_raw(payload=b"raw,rows\n1,2\n3,4\n")
    with pytest.raises(SystemExit):
        bdm.main(["--check"])
    err = capsys.readouterr().err
    assert "sha256 drift" in err


def test_check_catches_new_and_missing_files(corpus_on_disk):
    bdm.main([])
    extra = _write_raw(set_code="ZZZ")
    problems = bdm.check(json.loads(bdm.manifest_path().read_text()))
    assert any("on disk but not in the manifest" in p for p in problems)
    extra.unlink()

    recorded = json.loads(bdm.manifest_path().read_text())
    corpus_on_disk.unlink()
    problems = bdm.check(recorded)
    assert any("missing from" in p for p in problems)
