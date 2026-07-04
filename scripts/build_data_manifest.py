#!/usr/bin/env python
"""Freeze the DraftFM training-data universe into data_manifest.json.

Walks the raw 17Lands dump directory and records, per csv.gz: filename,
S3 ETag (from the .meta.json download sidecar), sha256, size, and curated
row count (from the curated parquet's .meta.json when present); plus the
featurizer manifest content hash and sha256s of the cardfeats parquet and
text-embedding cache. A top-level content hash pins the whole universe.

Manifest v1 pins the 31-set TRAINING universe: it must state that MSH (the
EVAL_ONLY set) is absent. If EVAL_ONLY raw files are on disk the build
refuses unless --allow-eval-only (the T0 freeze, when the MSH snapshot is
recorded in a separate eval_only section per the protocol).

  build_data_manifest.py            # build/refresh at $MTGA_DATA_ROOT
  build_data_manifest.py --check    # re-verify every hash; exit 1 on drift

Run on n42 (the box holding the full raw corpus).
"""

import argparse
import datetime
import hashlib
import json
import sys

from mtga.lands import corpus, paths

MANIFEST_VERSION = "data_manifest_v1"
HASH_KEYS = ["version", "files", "eval_only", "features"]


def manifest_path():
    return paths.DATA_ROOT / "data_manifest.json"


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sidecar(path):
    meta = paths.meta_path(path)
    if meta.exists():
        return json.loads(meta.read_text())
    return {}


def _parse_raw_name(filename):
    """('draft', 'SOS', 'PremierDraft') from a raw dump filename, else None."""
    parts = filename.split(".")
    if len(parts) != 5 or parts[3:] != ["csv", "gz"]:
        return None
    data_type = parts[0].removesuffix("_data_public")
    if data_type == parts[0]:
        return None
    return data_type, parts[1], parts[2]


def raw_entry(path):
    parsed = _parse_raw_name(path.name)
    entry = {
        "filename": path.name,
        "etag": _sidecar(path).get("etag"),
        "sha256": file_sha256(path),
        "size": path.stat().st_size,
        "rows": None,
    }
    if parsed:
        data_type, set_code, fmt = parsed
        curated_meta = _sidecar(paths.curated_path(data_type, set_code, fmt))
        entry["rows"] = curated_meta.get("rows")
    return entry


def feature_entries():
    features = {}
    if paths.FEATURIZER_MANIFEST.exists():
        manifest = json.loads(paths.FEATURIZER_MANIFEST.read_text())
        features["featurizer_manifest_hash"] = manifest.get("content_hash")
    if paths.CARDFEATS_PARQUET.exists():
        features["cardfeats_sha256"] = file_sha256(paths.CARDFEATS_PARQUET)
    if paths.TEXT_EMB_CACHE.exists():
        features["text_emb_sha256"] = file_sha256(paths.TEXT_EMB_CACHE)
    return features


def content_hash(manifest):
    frozen = {k: manifest.get(k) for k in HASH_KEYS}
    blob = json.dumps(frozen, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def build(allow_eval_only=False):
    raw_files = sorted(paths.RAW_DIR.glob("*.csv.gz"))
    files, eval_only_files = [], []
    for path in raw_files:
        parsed = _parse_raw_name(path.name)
        if parsed and parsed[1] in corpus.EVAL_ONLY:
            eval_only_files.append(path)
        else:
            files.append(raw_entry(path))

    if eval_only_files and not allow_eval_only:
        raise SystemExit(
            f"EVAL_ONLY raw data present ({[p.name for p in eval_only_files]}); "
            f"manifest v1 pins the training universe WITHOUT the held-out "
            f"set. Pass --allow-eval-only only for the T0 snapshot freeze.")

    eval_only = {
        code: {"present": False,
               "note": "held out per docs/eval_protocol.md; frozen at T0"}
        for code in sorted(corpus.EVAL_ONLY)
    }
    for path in eval_only_files:
        code = _parse_raw_name(path.name)[1]
        eval_only[code]["present"] = True
        eval_only[code].setdefault("files", []).append(raw_entry(path))

    manifest = {
        "version": MANIFEST_VERSION,
        "files": files,
        "eval_only": eval_only,
        "features": feature_entries(),
        "built_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "data_root": str(paths.DATA_ROOT),
    }
    manifest["content_hash"] = content_hash(manifest)
    return manifest


def check(recorded):
    """Re-verify a manifest against disk. Returns a list of drift strings."""
    problems = []
    if recorded.get("content_hash") != content_hash(recorded):
        problems.append("content_hash does not match the manifest body")

    current = build(allow_eval_only=True)
    current_files = {e["filename"]: e for e in current["files"]}
    recorded_files = {e["filename"]: e for e in recorded.get("files", [])}
    for name, entry in recorded_files.items():
        now = current_files.get(name)
        if now is None:
            problems.append(f"{name}: missing from {paths.RAW_DIR}")
            continue
        for key in ["etag", "sha256", "size", "rows"]:
            if now.get(key) != entry.get(key):
                problems.append(
                    f"{name}: {key} drift ({entry.get(key)!r} -> "
                    f"{now.get(key)!r})")
    for name in sorted(set(current_files) - set(recorded_files)):
        problems.append(f"{name}: on disk but not in the manifest")

    for key, value in recorded.get("features", {}).items():
        now = current["features"].get(key)
        if now != value:
            problems.append(f"features.{key}: drift ({value!r} -> {now!r})")

    for code, entry in recorded.get("eval_only", {}).items():
        present_now = any(
            (p := _parse_raw_name(f.name)) and p[1] == code
            for f in paths.RAW_DIR.glob("*.csv.gz"))
        if entry.get("present") != present_now:
            problems.append(
                f"eval_only.{code}: presence drift "
                f"({entry.get('present')} -> {present_now})")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="re-verify the existing manifest against disk")
    parser.add_argument("--allow-eval-only", action="store_true",
                        help="record EVAL_ONLY raw files instead of refusing "
                             "(T0 snapshot freeze only)")
    args = parser.parse_args(argv)
    out = manifest_path()

    if args.check:
        if not out.exists():
            sys.exit(f"no manifest at {out}")
        problems = check(json.loads(out.read_text()))
        if problems:
            print(f"DRIFT — {len(problems)} problem(s):", file=sys.stderr)
            for problem in problems:
                print(f"  {problem}", file=sys.stderr)
            sys.exit(1)
        print(f"OK: {out} matches disk")
        return

    manifest = build(allow_eval_only=args.allow_eval_only)
    with open(out, "w") as fh:
        json.dump(manifest, fh, indent=2)
    absent = [c for c, e in manifest["eval_only"].items() if not e["present"]]
    print(f"{out}: {len(manifest['files'])} raw files, "
          f"content hash {manifest['content_hash'][:12]}")
    if absent:
        print(f"EVAL_ONLY absent (universe pinned without): {absent}")
    else:
        print("WARNING: EVAL_ONLY data recorded (T0 freeze mode)")


if __name__ == "__main__":
    main()
