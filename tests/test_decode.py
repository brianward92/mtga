"""mtga/lands/decode.py: tar-in-gzip detection, extraction, idempotency."""

import gzip
import io
import json
import tarfile

import pytest

from mtga.lands import decode, etl, paths

CSV_BYTES = (
    b"expansion,draft_id,pack_number,pick_number,pick\r\n"
    b"TST,d1,0,0,Lightning Bolt\r\n"
)


def tar_gz_bytes(members=None):
    """Gzipped tarball, by default holding a single small CSV member."""
    members = {"draft.csv": CSV_BYTES} if members is None else members
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def write_raw(path, data, etag="etag-raw-1"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if etag is not None:
        with open(paths.meta_path(path), "w") as fh:
            json.dump({"etag": etag}, fh)
    return path


def test_is_tar_in_gzip_detects_by_content(data_root):
    tar_raw = write_raw(paths.RAW_DIR / "t.csv.gz", tar_gz_bytes())
    plain_raw = write_raw(paths.RAW_DIR / "p.csv.gz", gzip.compress(CSV_BYTES))
    assert decode.is_tar_in_gzip(tar_raw)
    assert not decode.is_tar_in_gzip(plain_raw)


def test_ensure_decoded_extracts_single_csv_member(data_root):
    raw = write_raw(
        paths.raw_dataset_path("draft", "STX", "PremierDraft"), tar_gz_bytes()
    )
    decoded = decode.ensure_decoded(raw)

    # Decoded twin lands in RAW_DIR/decoded/ under the same name, as plain gz.
    assert decoded == paths.RAW_DIR / "decoded" / raw.name
    assert not decode.is_tar_in_gzip(decoded)
    with gzip.open(decoded, "rb") as fh:
        assert fh.read() == CSV_BYTES
    assert etl.read_header(decoded) == [
        "expansion",
        "draft_id",
        "pack_number",
        "pick_number",
        "pick",
    ]
    # Sidecar records the SOURCE file's etag; no .part debris left behind.
    meta = json.loads(paths.meta_path(decoded).read_text())
    assert meta["source_etag"] == "etag-raw-1"
    assert not list(decoded.parent.glob("*.part"))


def test_ensure_decoded_is_idempotent_until_source_etag_changes(data_root):
    raw = write_raw(
        paths.raw_dataset_path("draft", "STX", "PremierDraft"), tar_gz_bytes()
    )
    decoded = decode.ensure_decoded(raw)

    # Same source etag -> untouched (marker content survives the call).
    decoded.write_bytes(b"marker")
    assert decode.ensure_decoded(raw) == decoded
    assert decoded.read_bytes() == b"marker"

    # New source etag -> re-extracted, sidecar updated.
    with open(paths.meta_path(raw), "w") as fh:
        json.dump({"etag": "etag-raw-2"}, fh)
    assert decode.ensure_decoded(raw) == decoded
    with gzip.open(decoded, "rb") as fh:
        assert fh.read() == CSV_BYTES
    meta = json.loads(paths.meta_path(decoded).read_text())
    assert meta["source_etag"] == "etag-raw-2"


def test_ensure_decoded_without_raw_sidecar_always_reextracts(data_root):
    raw = write_raw(
        paths.raw_dataset_path("draft", "STX", "PremierDraft"),
        tar_gz_bytes(),
        etag=None,
    )
    decoded = decode.ensure_decoded(raw)
    decoded.write_bytes(b"marker")
    decode.ensure_decoded(raw)  # unknown etag -> cannot trust the twin
    assert decoded.read_bytes() != b"marker"


def test_plain_gz_passes_through_unchanged(data_root):
    raw = write_raw(
        paths.raw_dataset_path("draft", "SOS", "PremierDraft"),
        gzip.compress(CSV_BYTES),
    )
    assert decode.ensure_decoded(raw) == raw
    assert not (paths.RAW_DIR / "decoded").exists()


def test_registry_mismatch_warns_but_trusts_content(data_root, capsys):
    # STX is flagged tar_in_gzip in the corpus registry, but the file is a
    # plain gz (as if 17Lands re-uploaded clean files): warn + passthrough.
    raw = write_raw(
        paths.raw_dataset_path("draft", "STX", "PremierDraft"),
        gzip.compress(CSV_BYTES),
    )
    assert decode.ensure_decoded(raw) == raw
    assert "tar_in_gzip mismatch" in capsys.readouterr().out

    # Converse: a modern set arriving as a tarball still decodes, with warning.
    raw2 = write_raw(
        paths.raw_dataset_path("draft", "SOS", "TradDraft"), tar_gz_bytes()
    )
    decoded = decode.ensure_decoded(raw2)
    assert "tar_in_gzip mismatch" in capsys.readouterr().out
    with gzip.open(decoded, "rb") as fh:
        assert fh.read() == CSV_BYTES


def test_unknown_set_gets_no_cross_check_warning(data_root, capsys):
    raw = write_raw(
        paths.raw_dataset_path("draft", "TST", "PremierDraft"), tar_gz_bytes()
    )
    decoded = decode.ensure_decoded(raw)
    assert "mismatch" not in capsys.readouterr().out
    assert decoded.name == raw.name and decoded != raw


def test_multiple_members_raise(data_root):
    raw = write_raw(
        paths.raw_dataset_path("draft", "STX", "PremierDraft"),
        tar_gz_bytes({"a.csv": CSV_BYTES, "b.csv": CSV_BYTES}),
    )
    with pytest.raises(ValueError, match="multiple files"):
        decode.ensure_decoded(raw)
    assert not list((paths.RAW_DIR / "decoded").glob("*.part"))
