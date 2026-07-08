"""scripts/run_frozen_eval.py: the pure protocol-gate units.

The heavy pipeline (curation, shards, inference) is exercised by rehearsal
runs on real data; these tests pin the REFUSAL behavior — the reason the
script exists — as fast, hermetic units.
"""

import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "scripts"

spec = importlib.util.spec_from_file_location(
    "run_frozen_eval", SCRIPTS / "run_frozen_eval.py")
rfe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rfe)


# -- (a) protocol freeze ------------------------------------------------------

def test_check_protocol_accepts_identical_bytes():
    rfe.check_protocol(b"frozen protocol", b"frozen protocol")


def test_check_protocol_refuses_drift():
    with pytest.raises(rfe.RefusalError, match="drifted"):
        rfe.check_protocol(b"frozen protocol", b"frozen protocol EDITED")


def test_check_protocol_refuses_unreadable_tag():
    with pytest.raises(rfe.RefusalError, match="cannot read"):
        rfe.check_protocol(b"anything", None)


def test_tagged_blob_from_fabricated_git_object(tmp_path):
    """End-to-end against a real (fabricated) git tag, not the repo's."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "proto.py").write_bytes(b"THE FROZEN CONTENT\n")
    for cmd in [
        ["git", "init", "-q"],
        ["git", "add", "proto.py"],
        ["git", "-c", "user.email=t@t", "-c", "user.name=t",
         "commit", "-qm", "freeze"],
        ["git", "tag", "fake-protocol-v1"],
    ]:
        subprocess.run(cmd, cwd=repo, check=True, capture_output=True)
    tagged = rfe.tagged_protocol_bytes(repo=repo, tag="fake-protocol-v1",
                                       path="proto.py")
    rfe.check_protocol(b"THE FROZEN CONTENT\n", tagged)
    with pytest.raises(rfe.RefusalError, match="drifted"):
        rfe.check_protocol(b"THE FROZEN CONTENT\n# edited\n", tagged)
    assert rfe.tagged_protocol_bytes(repo=repo, tag="no-such-tag",
                                     path="proto.py") is None


def test_working_evalproto_matches_the_real_tag():
    """The actual freeze guard: evalproto.py must equal eval-protocol-v1.1."""
    tagged = rfe.tagged_protocol_bytes()
    if tagged is None:
        pytest.skip("eval-protocol-v1.1 tag not reachable here")
    rfe.check_protocol((REPO / rfe.PROTOCOL_FILE).read_bytes(), tagged)


# -- (b) battery integrity ----------------------------------------------------

def _battery(models=None, snapshot=None):
    return {
        "models": models if models is not None else [
            {"name": "baseline-random", "kind": "baseline-random"},
            {"name": "f-full", "kind": "draftfm", "path": "runs/x/best.pt",
             "sha256": "a" * 64},
        ],
        "frozen_snapshot": snapshot if snapshot is not None else {
            "path": "raw/draft_data_public.MSH.PremierDraft.csv.gz",
            "sha256": "b" * 64, "etag": '"etag"',
        },
    }


def test_battery_hashes_ok_when_artifacts_frozen():
    rfe.check_battery_hashes(_battery())


def test_baselines_need_no_hash_but_models_do():
    battery = _battery(models=[
        {"name": "baseline-rarity", "kind": "baseline-rarity"},
        {"name": "f-full", "kind": "draftfm", "path": "runs/x/best.pt"},
    ])
    with pytest.raises(rfe.RefusalError, match="missing sha256.*f-full"):
        rfe.check_battery_hashes(battery)


def test_unfrozen_snapshot_spec_refused():
    battery = _battery(snapshot={"path": None, "sha256": None, "etag": None})
    with pytest.raises(rfe.RefusalError, match="frozen_snapshot"):
        rfe.check_battery_hashes(battery)


def test_artifact_sha_verifies_file_bytes(tmp_path):
    artifact = tmp_path / "best.pt"
    artifact.write_bytes(b"weights")
    good = rfe.file_sha256(artifact)
    rfe.check_artifact_sha(artifact, good, "f-full")
    with pytest.raises(rfe.RefusalError, match="mismatch"):
        rfe.check_artifact_sha(artifact, "0" * 64, "f-full")
    with pytest.raises(rfe.RefusalError, match="no artifact FILE"):
        rfe.check_artifact_sha(tmp_path / "gone.pt", good, "f-full")
    with pytest.raises(rfe.RefusalError, match="no artifact FILE"):
        rfe.check_artifact_sha(tmp_path, good, "f-full")  # dir, not file


def test_ledger_must_predate_t0(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    sha = "c" * 64
    ledger.write_text(
        json.dumps({"run_id": "r1", "logged_at": "2026-07-05T10:00:00",
                    "artifacts": {"best_sha256": sha}}) + "\n"
        + json.dumps({"run_id": "r2", "logged_at": "2026-07-01T09:00:00",
                      "artifacts": {"best_sha256": sha}}) + "\n")
    # Earliest mention wins; it predates T0.
    assert rfe.ledger_logged_at(sha, ledger) == "2026-07-01T09:00:00"
    rfe.check_ledger_predates(sha, "2026-07-07T00:00:00", "f-full", ledger)
    with pytest.raises(rfe.RefusalError, match="does not predate"):
        rfe.check_ledger_predates(sha, "2026-06-30T00:00:00", "f-full",
                                  ledger)
    with pytest.raises(rfe.RefusalError, match="never committed"):
        rfe.check_ledger_predates("d" * 64, "2026-07-07T00:00:00", "f-full",
                                  ledger)


def test_ledger_git_predates_uses_commit_history(tmp_path):
    """T1.4: committed-before-T0 must be proven by git history, not a
    self-reported logged_at field. Fabricate a repo with a ledger committed
    at a controlled date and check accept/refuse/uncommitted paths."""
    repo = tmp_path / "repo"
    (repo / "experiments").mkdir(parents=True)
    ledger_rel = "experiments/ledger.jsonl"
    sha = "e" * 64
    (repo / ledger_rel).write_text(
        json.dumps({"run_id": "r1", "logged_at": "2026-07-01T09:00:00",
                    "artifacts": {"best_sha256": sha}}) + "\n")
    env = {**os.environ,
           "GIT_AUTHOR_DATE": "2026-07-01T09:00:00",
           "GIT_COMMITTER_DATE": "2026-07-01T09:00:00"}
    for cmd in [
        ["git", "init", "-q"],
        ["git", "add", ledger_rel],
        ["git", "-c", "user.email=t@t", "-c", "user.name=t",
         "commit", "-qm", "ledger"],
    ]:
        subprocess.run(cmd, cwd=repo, check=True, capture_output=True, env=env)
    # Committed 2026-07-01; a T0 on 2026-07-07 postdates it -> accepted.
    assert rfe.check_ledger_git_predates(
        sha, "2026-07-07T00:00:00", "f-full",
        repo=repo, ledger_rel=ledger_rel) is not None
    # A T0 on 2026-06-30 predates the commit -> refused (would be backdated).
    with pytest.raises(rfe.RefusalError, match="does not predate"):
        rfe.check_ledger_git_predates(sha, "2026-06-30T00:00:00", "f-full",
                                      repo=repo, ledger_rel=ledger_rel)
    # A sha256 present only in the uncommitted working tree -> refused: git
    # history cannot vouch for it (this is the honor-system hole T1.4 closes).
    wt_sha = "f" * 64
    with (repo / ledger_rel).open("a") as fh:
        fh.write(json.dumps({"run_id": "r2",
                             "artifacts": {"best_sha256": wt_sha}}) + "\n")
    with pytest.raises(rfe.RefusalError,
                       match="not introduced by any git commit"):
        rfe.check_ledger_git_predates(wt_sha, "2026-07-07T00:00:00", "f-full",
                                      repo=repo, ledger_rel=ledger_rel)


def test_resolve_artifact_path_is_portable(monkeypatch, tmp_path):
    """T2.7: absolute member paths pass through unchanged; relative paths
    resolve against <DATA_ROOT>/foundation so a released battery isn't tied
    to one box's home directory."""
    from mtga.lands import paths

    abs_p = tmp_path / "runs" / "x" / "best.pt"
    assert rfe.resolve_artifact_path(str(abs_p)) == abs_p

    monkeypatch.setattr(paths, "DATA_ROOT", tmp_path)
    assert rfe.resolve_artifact_path("runs/x/best.pt") == \
        tmp_path / "foundation" / "runs" / "x" / "best.pt"
    # baselines carry no artifact; draftfm members resolve portably
    assert rfe.member_artifact_path({"kind": "baseline-random"}) is None
    assert rfe.member_artifact_path({"path": "runs/x/best.pt"}) == \
        tmp_path / "foundation" / "runs" / "x" / "best.pt"


# -- (c) T0 quality gates ------------------------------------------------------

def test_expert_draft_volume_gate():
    assert rfe.check_expert_drafts(2500) == 2500
    with pytest.raises(rfe.RefusalError, match="volume gate"):
        rfe.check_expert_drafts(2499)


def test_name_join_gate():
    assert rfe.check_name_join(99, 100) == pytest.approx(0.99)
    assert rfe.check_name_join(300, 300) == pytest.approx(1.0)
    with pytest.raises(rfe.RefusalError, match="name-join gate"):
        rfe.check_name_join(98, 100)


def test_modern_schema_gate():
    rfe.check_modern_schema("modern")
    with pytest.raises(rfe.RefusalError, match="schema gate"):
        rfe.check_modern_schema("match_buckets")


# -- mode selection ------------------------------------------------------------

def test_real_mode_targets_msh():
    assert rfe.eval_set_for(None) == "MSH"


def test_rehearsal_uses_the_stand_in_set():
    assert rfe.eval_set_for("sos") == "SOS"
    assert rfe.eval_set_for(" TMT ") == "TMT"


def test_rehearsing_msh_is_forbidden():
    with pytest.raises(rfe.RefusalError, match="exactly once"):
        rfe.eval_set_for("MSH")
    with pytest.raises(rfe.RefusalError):
        rfe.eval_set_for("msh")
