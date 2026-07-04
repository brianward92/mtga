"""Decode 17Lands raw files whose .csv.gz actually wraps a ustar tarball.

The 2021-era dumps (STX/AFR/MID/VOW) are gzipped tarballs containing a single
CSV, so gzip.open on them yields a 512-byte ustar header instead of a CSV
header. Raw files keep 17Lands' exact bytes (their ETag sidecars drive the
conditional download), so decoding happens into a parallel copy:
RAW_DIR/decoded/<same name>, re-gzipped as a plain csv.gz with the repo's
atomic .part-rename convention. The decoded file's .meta.json sidecar records
the SOURCE file's etag, which makes ensure_decoded idempotent.

Detection is by content (ustar magic at offset 257 of the gunzipped stream);
the corpus registry's tar_in_gzip flag is only a cross-check that warns on
mismatch — robust if 17Lands ever re-uploads clean files.
"""

import gzip
import json
import re
import shutil
import tarfile

from mtga.lands import corpus, paths

TAR_MAGIC_OFFSET = 257  # ustar magic position inside a tar header block
GZIP_LEVEL = 6
CHUNK_BYTES = 1 << 20

_RAW_NAME = re.compile(r"^[a-z]+_data_public\.([A-Za-z0-9]+)\.")


def is_tar_in_gzip(path):
    """True if gunzipping `path` yields a ustar tarball, not a bare CSV."""
    with gzip.open(path, "rb") as file:
        head = file.read(TAR_MAGIC_OFFSET + 8)
    return head[TAR_MAGIC_OFFSET:TAR_MAGIC_OFFSET + 5] == b"ustar"


def decoded_path(raw_path):
    return raw_path.parent / "decoded" / raw_path.name


def _source_etag(raw_path):
    meta = paths.meta_path(raw_path)
    if meta.exists():
        with open(meta) as file:
            return json.load(file).get("etag")
    return None


def _registry_expectation(raw_path):
    """corpus tar_in_gzip flag for the set named in a 17Lands raw filename."""
    match = _RAW_NAME.match(raw_path.name)
    if not match:
        return None
    spec = corpus.CORPUS.get(match.group(1))
    return spec.tar_in_gzip if spec else None


def ensure_decoded(raw_path):
    """Return a plain csv.gz for curation: raw_path itself, or its decoded twin.

    Non-tar files are returned unchanged. Tar-in-gzip files are extracted
    (streaming, never fully in memory) into decoded_path(raw_path); repeat
    calls are no-ops while the source file's etag is unchanged.
    """
    is_tar = is_tar_in_gzip(raw_path)
    expected = _registry_expectation(raw_path)
    if expected is not None and expected != is_tar:
        print(
            f"WARNING: {raw_path.name}: tar_in_gzip mismatch — corpus registry "
            f"says {expected}, content detection says {is_tar}; trusting content"
        )
    if not is_tar:
        return raw_path

    source_etag = _source_etag(raw_path)
    dest = decoded_path(raw_path)
    dest_meta = paths.meta_path(dest)
    if dest.exists() and dest_meta.exists() and source_etag is not None:
        with open(dest_meta) as file:
            if json.load(file).get("source_etag") == source_etag:
                return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.parent / f"{dest.name}.part"
    extracted = False
    with tarfile.open(raw_path, mode="r|gz") as tar:
        for member in tar:
            if not member.isreg():
                continue
            if extracted:
                part.unlink(missing_ok=True)
                raise ValueError(
                    f"{raw_path.name}: multiple files inside tarball; expected a single CSV"
                )
            with tar.extractfile(member) as src, \
                    gzip.open(part, "wb", compresslevel=GZIP_LEVEL) as out:
                shutil.copyfileobj(src, out, CHUNK_BYTES)
            extracted = True
    if not extracted:
        raise ValueError(f"{raw_path.name}: no file members inside tarball")
    part.replace(dest)

    with open(dest_meta, "w") as file:
        json.dump(
            {"source_etag": source_etag, "source": raw_path.name,
             "decoded_from": "tar_in_gzip"},
            file, indent=2,
        )
    return dest
