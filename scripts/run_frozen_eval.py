#!/usr/bin/env python
"""Execute the frozen DraftFM evaluation (docs/eval_protocol.md, tag
eval-protocol-v1.1). This script IS the protocol enforcer: it refuses to run
unless every pre-registered condition holds.

Real mode (default; the eval set is MSH, exactly once):
  (a) mtga/foundation/evalproto.py must match the eval-protocol-v1.1 git tag
  (b) every battery artifact sha256 must verify AND have an
      experiments/ledger.jsonl entry that predates the snapshot's
      fetched_at (committed-before-T0); the frozen snapshot's sha256/ETag
      must match experiments/frozen_battery.json
  (c) T0 quality gates on the curated snapshot: modern schema, >= 2,500
      expert-slice drafts, >= 99% pack-name join to card features, P1P1
      presence recorded (annotation only)
  (d) one inference pass per battery member -> cached predictions parquets
  (e) evalproto summaries per slice/conditioning + per-(pack,pick) curves,
      all under <data root>/foundation/frozen_eval/<snapshot_sha>/

Rehearsal mode (--rehearse SET, e.g. SOS): treats SET as a stand-in for
MSH and exercises the full pipeline, skipping only the committed-before-T0
checks. --rehearse MSH is refused — MSH data is touched exactly once, by
the real run.
"""

import argparse
import datetime
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_TAG = "eval-protocol-v1.1"
PROTOCOL_FILE = "mtga/foundation/evalproto.py"
BATTERY_PATH = REPO_ROOT / "experiments" / "frozen_battery.json"
LEDGER_PATH = REPO_ROOT / "experiments" / "ledger.jsonl"

EVAL_SET = "MSH"
MIN_EXPERT_DRAFTS = 2500
MIN_NAME_JOIN = 0.99
BASELINE_KINDS = {"baseline-random": "random", "baseline-rarity": "rarity"}


class RefusalError(RuntimeError):
    """A pre-registered condition failed; the frozen eval must not run."""


# ---------------------------------------------------------------------------
# (a) Protocol freeze — pure checks first, git plumbing second.


def check_protocol(current_bytes, tagged_bytes):
    """Refuse when the working evalproto.py drifted from the tagged blob."""
    if tagged_bytes is None:
        raise RefusalError(f"cannot read {PROTOCOL_FILE} at tag {PROTOCOL_TAG}")
    if current_bytes != tagged_bytes:
        current = hashlib.sha256(current_bytes).hexdigest()
        tagged = hashlib.sha256(tagged_bytes).hexdigest()
        raise RefusalError(
            f"{PROTOCOL_FILE} drifted from tag {PROTOCOL_TAG} "
            f"(sha256 {current[:12]} vs tagged {tagged[:12]}); a changed "
            f"protocol invalidates the frozen eval"
        )


def tagged_protocol_bytes(repo=REPO_ROOT, tag=PROTOCOL_TAG, path=PROTOCOL_FILE):
    result = subprocess.run(
        ["git", "cat-file", "blob", f"{tag}:{path}"],
        capture_output=True,
        cwd=repo,
        timeout=30,
    )
    if result.returncode != 0:
        return None
    return result.stdout


# ---------------------------------------------------------------------------
# (b) Battery integrity + committed-before-T0.


def is_baseline(member):
    return member.get("kind", "").startswith("baseline-")


def check_battery_hashes(battery):
    """Real mode refuses when any artifact-backed member lacks a sha256."""
    missing = [
        m.get("name", "?")
        for m in battery.get("models", [])
        if not is_baseline(m) and not m.get("sha256")
    ]
    if missing:
        raise RefusalError(
            f"battery members missing sha256 (freeze them before T0): " f"{missing}"
        )
    snapshot = battery.get("frozen_snapshot") or {}
    absent = [k for k in ("path", "sha256", "etag") if not snapshot.get(k)]
    if absent:
        raise RefusalError(
            f"frozen_snapshot is missing {absent}; freeze the T0 snapshot "
            f"spec into frozen_battery.json first"
        )


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_artifact_path(path):
    """Resolve a battery member's artifact path portably (T2.7).

    Absolute paths are honored as-is (back-compat + per-machine overrides). A
    RELATIVE path resolves against ``<DATA_ROOT>/foundation``, so a released
    battery need not hard-code one box's home directory: point MTGA_DATA_ROOT
    at the unpacked weights. The sha256 in the battery is the authoritative
    anchor regardless of where the file physically lives.
    """
    from mtga.lands import paths

    p = Path(path)
    return p if p.is_absolute() else (paths.DATA_ROOT / "foundation" / p)


def member_artifact_path(member):
    """Resolved checkpoint path for a battery member, or None for
    artifact-less members (baselines carry neither path nor run)."""
    spec = member.get("path") or member.get("run")
    return resolve_artifact_path(spec) if spec else None


def check_artifact_sha(path, expected, label):
    path = Path(path)
    if not path.is_file():
        raise RefusalError(
            f"{label}: no artifact FILE at {path} (freeze the file itself, "
            f"e.g. runs/<id>/best.pt, not its directory)"
        )
    actual = file_sha256(path)
    if actual != expected:
        raise RefusalError(
            f"{label}: sha256 mismatch ({actual[:12]} vs frozen "
            f"{expected[:12]}) — the artifact changed after the freeze"
        )


def ledger_logged_at(sha256, ledger_path=LEDGER_PATH):
    """Earliest logged_at among ledger lines mentioning the sha256."""
    if not Path(ledger_path).exists():
        return None
    earliest = None
    with open(ledger_path) as fh:
        for line in fh:
            if sha256 not in line:
                continue
            logged = json.loads(line).get("logged_at")
            if logged and (earliest is None or logged < earliest):
                earliest = logged
    return earliest


def check_ledger_predates(sha256, fetched_at, label, ledger_path=LEDGER_PATH):
    logged = ledger_logged_at(sha256, ledger_path)
    if logged is None:
        raise RefusalError(
            f"{label}: sha256 {sha256[:12]} has no experiments/ledger.jsonl "
            f"entry — the artifact was never committed"
        )
    if datetime.datetime.fromisoformat(logged) >= datetime.datetime.fromisoformat(
        fetched_at
    ):
        raise RefusalError(
            f"{label}: ledger entry ({logged}) does not predate the T0 "
            f"snapshot download ({fetched_at})"
        )
    return logged


def ledger_git_commit_ts(sha256, repo=REPO_ROOT, ledger_rel="experiments/ledger.jsonl"):
    """Unix committer-time of the EARLIEST git commit that introduced this
    sha256 into the tracked ledger, or None if it appears in no committed
    version (present only in the uncommitted working tree, or the ledger is
    untracked / not in a git repo).

    ``ledger_logged_at`` above trusts a self-reported ``logged_at`` JSON
    field, which can be typed to any value; a git committer date is anchored
    in history and is the actual "committed-before-T0" evidence the protocol
    claims. ``%ct`` (Unix seconds, UTC) is unambiguous across timezones.
    ``-S`` finds the commit that changed the occurrence count of the string,
    so the first (with ``--reverse``) is the one that introduced it.
    """
    result = subprocess.run(
        ["git", "log", "--reverse", "--format=%ct", "-S", sha256, "--", ledger_rel],
        capture_output=True,
        cwd=str(repo),
        timeout=30,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    return int(result.stdout.strip().splitlines()[0])


def check_ledger_git_predates(
    sha256, fetched_at, label, repo=REPO_ROOT, ledger_rel="experiments/ledger.jsonl"
):
    """Refuse unless a git commit that PREDATES T0 introduced this artifact's
    sha256 into the ledger. This is the authoritative anti-backdating guard:
    ``check_ledger_predates`` only trusts the ledger's own ``logged_at``
    field; this trusts git history, which is far harder to forge.
    """
    committed_ts = ledger_git_commit_ts(sha256, repo, ledger_rel)
    if committed_ts is None:
        raise RefusalError(
            f"{label}: sha256 {sha256[:12]} is not introduced by any git "
            f"commit to {ledger_rel} (it exists only in the uncommitted "
            f"working tree, or the ledger is untracked) — committed-before-T0 "
            f"cannot be established from git history; commit the ledger first"
        )
    fetched_ts = datetime.datetime.fromisoformat(fetched_at).timestamp()
    if committed_ts >= fetched_ts:
        committed_iso = datetime.datetime.fromtimestamp(committed_ts).isoformat(
            timespec="seconds"
        )
        raise RefusalError(
            f"{label}: the git commit introducing this artifact's ledger "
            f"entry ({committed_iso}) does not predate the T0 snapshot "
            f"download ({fetched_at}) — the entry was not committed before T0"
        )
    return committed_ts


# ---------------------------------------------------------------------------
# (c) T0 quality gates.


def check_expert_drafts(n_expert_drafts, minimum=MIN_EXPERT_DRAFTS):
    if n_expert_drafts < minimum:
        raise RefusalError(
            f"volume gate: {n_expert_drafts} expert-slice drafts < "
            f"{minimum}; wait exactly one snapshot cycle (the single "
            f"pre-declared contingency)"
        )
    return n_expert_drafts


def check_name_join(n_matched, n_total, minimum=MIN_NAME_JOIN):
    rate = n_matched / max(n_total, 1)
    if rate < minimum:
        raise RefusalError(
            f"name-join gate: {n_matched}/{n_total} = {rate:.4f} of pack "
            f"names join to card features (< {minimum})"
        )
    return rate


def check_modern_schema(schema_era):
    if schema_era != "modern":
        raise RefusalError(
            f"schema gate: curated snapshot era is {schema_era!r}, "
            f"expected 'modern'"
        )


def eval_set_for(rehearse):
    """Refuses --rehearse MSH; returns the effective eval set code."""
    if rehearse:
        code = rehearse.strip().upper()
        if code == EVAL_SET:
            raise RefusalError(
                f"--rehearse {EVAL_SET} is forbidden: {EVAL_SET} data is "
                f"touched exactly once, by the real run"
            )
        return code
    return EVAL_SET


# ---------------------------------------------------------------------------
# Pipeline plumbing (imports deferred so the pure gates stay unit-testable).


def ensure_curated(set_code, fmt):
    from mtga.lands import etl, paths

    parquet = paths.curated_path("draft", set_code, fmt)
    result = etl.curate_draft(set_code, fmt)
    if result["status"] == "MISSING_RAW":
        raise RefusalError(f"no raw snapshot at {result['path']}")
    return parquet


def snapshot_gates(set_code, fmt):
    """Run the T0 gates against the curated snapshot; returns annotations."""
    import duckdb

    from mtga.foundation import featurize
    from mtga.lands import paths

    parquet = paths.curated_path("draft", set_code, fmt)
    meta = json.loads(paths.meta_path(parquet).read_text())
    check_modern_schema(meta.get("schema_era"))

    con = duckdb.connect()
    n_expert = con.execute(f"""
        SELECT count(DISTINCT draft_id) FROM '{parquet}'
        WHERE pick_index >= 0 AND user_game_win_rate_bucket >= 0.55
          AND user_n_games_bucket >= 100
        """).fetchone()[0]
    con.close()
    check_expert_drafts(n_expert)

    vocab = json.loads(paths.vocab_path(set_code, fmt).read_text())["names"]
    try:
        featurize.resolve_names(vocab)
        unmatched = []
    except featurize.UnmatchedNamesError as err:
        unmatched = err.names
    rate = check_name_join(len(vocab) - len(unmatched), len(vocab))

    return {
        "schema_era": meta.get("schema_era"),
        "rows": meta.get("rows"),
        "expert_drafts": int(n_expert),
        "name_join_rate": rate,
        "unmatched_names": unmatched,
        "p1p1_missing": bool(meta.get("p1p1_missing")),  # annotation
        "picks_per_pack": meta.get("picks_per_pack"),
    }


def ensure_shard(set_code, fmt):
    """Shard + frozen-manifest features for the eval set (MSH is not in
    cardfeats, so features go through build_set_assets.feature_table)."""
    import numpy as np

    from mtga.foundation import dataset
    from mtga.lands import paths

    import build_set_assets

    vocab = json.loads(paths.vocab_path(set_code, fmt).read_text())["names"]
    out = dataset.shard_dir(set_code, fmt)
    out.mkdir(parents=True, exist_ok=True)
    features_file = out / "features.npz"
    if not features_file.exists():
        features, rarity_ids, manifest, text_missing = build_set_assets.feature_table(
            set_code, vocab
        )
        if text_missing:
            raise RefusalError(
                f"text embeddings missing for {len(text_missing)} names; "
                f"run the embed step first: {text_missing[:5]}"
            )
        np.savez(
            features_file,
            features=features,
            rarity_ids=rarity_ids,
            names=np.array(vocab, dtype=object),
            manifest_hash=manifest["content_hash"],
        )
    return dataset.build_shard(set_code, fmt)


def load_draftfm(path):
    from mtga.foundation.export import load_checkpoint

    path = Path(path)
    checkpoint = path if path.is_file() else path / "best.pt"
    model, _ = load_checkpoint(checkpoint)
    return model


def check_manifest_consistency(members, eval_manifest_sha, out=print):
    """Refuse if any DraftFM checkpoint records a featurizer manifest hash
    that differs from the one the eval shard was built through (T2.5).

    Legacy checkpoints (trained before train.py recorded this field) carry no
    hash: warn loudly with both hashes so it can be verified by hand, but do
    not block — the shipped f-full/f-dev predate the field. A recorded hash
    that *disagrees* is a hard refusal: the model would be scoring a feature
    space it never trained on, silently.
    """
    import torch

    for member in members:
        if member.get("kind") != "draftfm":
            continue
        label = member.get("name", "draftfm")
        path = member_artifact_path(member)
        ckpt_path = path if path.is_file() else path / "best.pt"
        if not ckpt_path.is_file():
            out(
                f"(c.6) WARNING {label}: checkpoint {ckpt_path} not found; "
                f"skipping manifest check (inference will surface this)"
            )
            continue
        trained = torch.load(ckpt_path, map_location="cpu", weights_only=False).get(
            "featurizer_manifest_sha"
        )
        if trained is None:
            out(
                f"(c.6) WARNING {label}: checkpoint records no featurizer "
                f"manifest hash (legacy); the eval shard's manifest is "
                f"{eval_manifest_sha}. Verify by hand that this model trained "
                f"through the same manifest before trusting the numbers."
            )
        elif eval_manifest_sha is not None and trained != eval_manifest_sha:
            raise RefusalError(
                f"{label}: model trained through featurizer manifest "
                f"{trained} but the eval shard was built through "
                f"{eval_manifest_sha} — a mismatched feature space; refusing"
            )
        else:
            out(f"(c.6) {label}: featurizer manifest matches " f"({eval_manifest_sha})")


def member_frames(member, set_code, fmt, temperature=1.0):
    """{mode_label: predictions frame} for one battery member.

    temperature: the frozen dev-only calibration temperature (battery's
    top-level "calibration" block, docs/eval_protocol.md section 3).
    Applied to both deployment and human mode for a DraftFM member, for
    consistency; never fitted or varied per-mode.
    """
    from mtga.foundation import predict

    kind = member.get("kind")
    if kind == "draftfm":
        model = load_draftfm(member_artifact_path(member))
        condition = member.get("condition") or {}
        return {
            "deployment": predict.foundation_predictions(
                model,
                set_code,
                fmt,
                condition_wr_id=condition.get("wr_id"),
                condition_games_id=condition.get("games_id"),
                temperature=temperature,
            ),
            "human": predict.foundation_predictions(
                model, set_code, fmt, temperature=temperature
            ),
        }
    if kind == "perset":
        return {
            "deployment": predict.per_set_model_predictions(
                set_code,
                fmt,
                version=member.get("version", "latest"),
                split=member.get("split", "val"),
            )
        }
    if kind in BASELINE_KINDS:
        return {
            "deployment": predict.baseline_predictions(
                set_code, fmt, BASELINE_KINDS[kind]
            )
        }
    raise RefusalError(f"unknown battery member kind: {kind!r}")


def summarize_frame(frame, label):
    from mtga.foundation import evalproto

    evalproto.validate(frame)
    expert = evalproto.expert_slice(frame)
    result = {"all": evalproto.summarize(frame, f"{label}/all")}
    if len(expert):
        result["expert"] = evalproto.summarize(expert, f"{label}/expert")
    return result


def ceiling_comparison(zeroshot, ceiling):
    """Normalized score + late-draft retention on identical picks."""
    from mtga.foundation import evalproto

    aligned_z, aligned_c = evalproto.align_on_picks(
        evalproto.expert_slice(zeroshot), evalproto.expert_slice(ceiling)
    )
    if not len(aligned_z):
        return None
    diff, lo, hi = evalproto.paired_bootstrap_diff(aligned_z, aligned_c, evalproto.top1)
    return {
        "n_shared_picks": int(len(aligned_z)),
        "zeroshot_top1": evalproto.top1(aligned_z),
        "ceiling_top1": evalproto.top1(aligned_c),
        "normalized_top1": (
            evalproto.top1(aligned_z) / max(evalproto.top1(aligned_c), 1e-12)
        ),
        "top1_diff": diff,
        "top1_diff_ci": [lo, hi],
        "late_draft_retention": evalproto.late_draft_retention(aligned_z, aligned_c),
    }


def write_report(out_dir, context, gates, results, comparisons):
    lines = [
        f"# Frozen DraftFM evaluation — {context['set']} " f"{context['format']}",
        "",
        f"- mode: {'REHEARSAL (fake-MSH)' if context['rehearse'] else 'REAL'}",
        f"- protocol: {PROTOCOL_TAG} (verified)",
        f"- snapshot sha256: `{context['snapshot_sha']}`",
        f"- snapshot etag: `{context.get('snapshot_etag')}`",
        f"- executed: {context['executed_at']}",
        "",
        "## T0 gates",
        "",
        f"- schema era: {gates['schema_era']} (PASS)",
        f"- expert-slice drafts: {gates['expert_drafts']:,} "
        f">= {MIN_EXPERT_DRAFTS} (PASS)",
        f"- pack-name join: {gates['name_join_rate']:.4f} "
        f">= {MIN_NAME_JOIN} (PASS)",
        f"- P1P1 missing: {gates['p1p1_missing']} (annotation)",
        "",
        "## Battery",
        "",
        "| member | mode | slice | n_picks | n_drafts | top1 [95% CI] | "
        "top3 | log_loss | ECE | top1 non-forced |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, modes in results.items():
        for mode, slices in modes.items():
            for slice_name, s in slices.items():
                lines.append(
                    f"| {name} | {mode} | {slice_name} | {s['n_picks']:,} "
                    f"| {s['n_drafts']:,} "
                    f"| {s['top1']:.4f} [{s['top1_ci'][0]:.4f}, "
                    f"{s['top1_ci'][1]:.4f}] | {s['top3']:.4f} "
                    f"| {s['log_loss']:.4f} | {s['ece']:.4f} "
                    f"| {s['top1_non_forced']:.4f} |"
                )
    if comparisons:
        lines += ["", "## Ceiling comparisons (identical picks, " "expert slice)", ""]
        for name, c in comparisons.items():
            lines.append(
                f"- **{name}**: normalized top-1 "
                f"{c['normalized_top1']:.4f} "
                f"({c['zeroshot_top1']:.4f} / {c['ceiling_top1']:.4f}), "
                f"diff {c['top1_diff']:.4f} "
                f"[{c['top1_diff_ci'][0]:.4f}, {c['top1_diff_ci'][1]:.4f}], "
                f"late-draft retention {c['late_draft_retention']:.4f} "
                f"over {c['n_shared_picks']:,} shared picks"
            )
    lines.append("")
    (out_dir / "report.md").write_text("\n".join(lines))


# ---------------------------------------------------------------------------


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rehearse",
        default=None,
        metavar="SET",
        help="treat SET as a stand-in for MSH (never MSH)",
    )
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--battery", default=str(BATTERY_PATH))
    parser.add_argument(
        "--out-root", default=None, help="default: <data root>/foundation/frozen_eval"
    )
    return parser


def main(argv=None):
    args = create_parser().parse_args(argv)
    try:
        run(args)
    except RefusalError as err:
        print(f"REFUSED: {err}", file=sys.stderr)
        sys.exit(1)


def run(args):
    from mtga.foundation import evalproto
    from mtga.lands import paths

    set_code = eval_set_for(args.rehearse)
    rehearse = args.rehearse is not None
    fmt = args.format

    # (a) the protocol implementation is exactly the tagged one.
    check_protocol((REPO_ROOT / PROTOCOL_FILE).read_bytes(), tagged_protocol_bytes())
    print(f"(a) {PROTOCOL_FILE} matches tag {PROTOCOL_TAG}")

    # (b) battery.
    battery_path = Path(args.battery)
    if not battery_path.exists():
        raise RefusalError(f"no battery file at {battery_path}")
    battery = json.loads(battery_path.read_text())
    members = battery.get("models", [])
    if not members:
        raise RefusalError("battery lists no models")
    if not rehearse:
        # Pre-registration must be complete before any data is touched.
        check_battery_hashes(battery)

    raw_snapshot = paths.raw_dataset_path("draft", set_code, fmt)
    if not raw_snapshot.exists():
        raise RefusalError(f"no raw snapshot at {raw_snapshot}")
    snapshot_sha = file_sha256(raw_snapshot)
    sidecar = paths.meta_path(raw_snapshot)
    snapshot_meta = json.loads(sidecar.read_text()) if sidecar.exists() else {}

    if rehearse:
        print(
            f"(b) REHEARSAL on {set_code}: committed-before-T0 checks "
            f"skipped; artifact sha256s verified when present"
        )
        for member in members:
            if member.get("sha256") and member_artifact_path(member):
                check_artifact_sha(
                    member_artifact_path(member),
                    member["sha256"],
                    member.get("name", "?"),
                )
    else:
        frozen = battery["frozen_snapshot"]
        if Path(frozen["path"]).name != raw_snapshot.name:
            raise RefusalError(
                f"frozen_snapshot.path {frozen['path']} is not the "
                f"{set_code} {fmt} snapshot"
            )
        if snapshot_sha != frozen["sha256"]:
            raise RefusalError(
                f"snapshot sha256 {snapshot_sha[:12]} != frozen "
                f"{frozen['sha256'][:12]} — the file was re-downloaded "
                f"over; the frozen bytes are gone"
            )
        if snapshot_meta.get("etag") != frozen["etag"]:
            raise RefusalError(
                f"snapshot etag {snapshot_meta.get('etag')!r} != frozen "
                f"{frozen['etag']!r}"
            )
        fetched_at = snapshot_meta.get("fetched_at")
        if not fetched_at:
            raise RefusalError(f"{sidecar} lacks fetched_at; T0 cannot be established")
        for member in members:
            if is_baseline(member):
                continue
            label = member.get("name", "?")
            check_artifact_sha(member_artifact_path(member), member["sha256"], label)
            check_ledger_predates(member["sha256"], fetched_at, label)
            # Authoritative check: the ledger entry must have been *git-
            # committed* before T0, not merely carry a self-reported
            # logged_at (T1.4 — the self-report alone is honor-system).
            check_ledger_git_predates(member["sha256"], fetched_at, label)
        print(
            f"(b) battery verified: {len(members)} members, all artifact "
            f"hashes frozen and ledger git-committed before {fetched_at}"
        )

    # (c) gates on the curated snapshot.
    ensure_curated(set_code, fmt)
    gates = snapshot_gates(set_code, fmt)
    print(
        f"(c) gates PASS: {gates['expert_drafts']:,} expert drafts, "
        f"name join {gates['name_join_rate']:.4f}, "
        f"p1p1_missing={gates['p1p1_missing']}"
    )
    ensure_shard(set_code, fmt)

    # (c.6) feature-space consistency: the eval shard and every DraftFM model
    # must share a featurizer manifest, else the model scores a feature space
    # it never trained on (T2.5). Read the hash the eval shard was built
    # through and compare against each checkpoint's recorded training hash.
    import numpy as np

    from mtga.foundation import dataset

    eval_feats = np.load(
        dataset.shard_dir(set_code, fmt) / "features.npz", allow_pickle=True
    )
    eval_manifest_sha = (
        str(eval_feats["manifest_hash"])
        if "manifest_hash" in eval_feats.files
        else None
    )
    check_manifest_consistency(members, eval_manifest_sha)

    out_root = (
        Path(args.out_root)
        if args.out_root
        else (paths.DATA_ROOT / "foundation" / "frozen_eval")
    )
    out_dir = out_root / snapshot_sha
    out_dir.mkdir(parents=True, exist_ok=True)

    # (c.5) frozen calibration temperature (docs/eval_protocol.md section 3:
    # "optional temperature fit on dev only, frozen into the battery
    # config"). Real (non-rehearsal) runs refuse to proceed without one, so
    # a temperature decision can't be skipped by omission once T0 exists;
    # the rehearsal defaults to 1.0 (no scaling) so it can validate the
    # pipeline before a calibration block is ever written.
    calibration = battery.get("calibration") or {}
    temperature = calibration.get("temperature")
    if temperature is None:
        if rehearse:
            temperature = 1.0
        else:
            raise RefusalError(
                'battery has no "calibration.temperature" -- the dev-only '
                "calibration decision (docs/eval_protocol.md section 3) "
                "must be frozen before a real (non-rehearsal) run"
            )
    print(
        f"(c.5) calibration temperature: {temperature}"
        + (" (rehearsal default, no calibration block)" if not calibration else "")
    )

    # (d) + (e): one inference pass per member, then the frozen analysis.
    results, comparisons, frames = {}, {}, {}
    for member in members:
        name = member.get("name", member.get("kind"))
        results[name] = {}
        for mode, frame in member_frames(
            member, set_code, fmt, temperature=temperature
        ).items():
            frame.to_parquet(out_dir / f"{name}.{mode}.parquet", index=False)
            results[name][mode] = summarize_frame(frame, f"{name}/{mode}")
            evalproto.per_pick_curve(frame).to_csv(
                out_dir / f"{name}.{mode}.curve.csv", index=False
            )
            frames[(name, mode)] = frame
            headline = results[name][mode].get("expert", results[name][mode]["all"])
            print(
                f"(d) {name}/{mode}: top1 {headline['top1']:.4f} "
                f"(n={headline['n_picks']:,})"
            )

    ceiling = next((m for m in members if m.get("kind") == "perset"), None)
    if ceiling is not None:
        ceiling_frame = frames[(ceiling.get("name", "perset"), "deployment")]
        for member in members:
            if member.get("kind") != "draftfm":
                continue
            name = member.get("name", "draftfm")
            comparison = ceiling_comparison(frames[(name, "deployment")], ceiling_frame)
            if comparison:
                comparisons[name] = comparison

    context = {
        "set": set_code,
        "format": fmt,
        "rehearse": rehearse,
        "snapshot_sha": snapshot_sha,
        "snapshot_etag": snapshot_meta.get("etag"),
        "protocol_tag": PROTOCOL_TAG,
        "battery": str(battery_path),
        "executed_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    summary = {
        "context": context,
        "gates": gates,
        "results": results,
        "ceiling_comparisons": comparisons,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    write_report(out_dir, context, gates, results, comparisons)
    print(f"(e) wrote {out_dir}/summary.json + report.md")


if __name__ == "__main__":
    main()
