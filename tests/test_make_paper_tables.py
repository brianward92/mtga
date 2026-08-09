import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_paper_tables.py"
SPEC = importlib.util.spec_from_file_location("make_paper_tables", SCRIPT)
mpt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mpt)


def entry(run_id, config_name, summary=None, best_sha256="best-hash"):
    return {
        "run_id": run_id,
        "record": {
            "run_id": run_id,
            "config": {"name": config_name},
            "artifacts": {"best_sha256": best_sha256},
        },
        "summary": summary,
    }


def manifest(
    run_id="pinned", config_name="f_dev", require_summary=False, best_sha256="best-hash"
):
    return {
        "schema_version": 1,
        "runs": {
            "f_dev": {
                "run_id": run_id,
                "config_name": config_name,
                "best_sha256": best_sha256,
                "require_summary": require_summary,
            }
        },
    }


def test_manifest_selects_exact_run_not_newest_matching_config():
    runs = {
        "pinned": entry("pinned", "f_dev", {"value": "pinned"}),
        "newer": entry("newer", "f_dev", {"value": "newer"}),
    }

    selected = mpt.runs_by_manifest(
        runs, manifest(require_summary=True), required_roles={"f_dev"}
    )

    assert selected["f_dev"]["run_id"] == "pinned"
    assert selected["f_dev"]["summary"] == {"value": "pinned"}


def test_manifest_fails_when_pinned_run_is_missing():
    with pytest.raises(mpt.PaperSourceError, match="not found"):
        mpt.runs_by_manifest(
            {"newer": entry("newer", "f_dev")},
            manifest(),
            required_roles={"f_dev"},
        )


def test_manifest_fails_when_required_role_is_not_pinned():
    with pytest.raises(mpt.PaperSourceError, match="missing required roles: s1"):
        mpt.runs_by_manifest(
            {"pinned": entry("pinned", "f_dev")},
            manifest(),
            required_roles={"f_dev", "s1"},
        )


def test_manifest_fails_when_pinned_config_mismatches_record():
    with pytest.raises(mpt.PaperSourceError, match="declares config 'other'"):
        mpt.runs_by_manifest(
            {"pinned": entry("pinned", "other")},
            manifest(),
            required_roles={"f_dev"},
        )


def test_manifest_fails_when_pinned_artifact_hash_mismatches_record():
    with pytest.raises(mpt.PaperSourceError, match="declares 'other-hash'"):
        mpt.runs_by_manifest(
            {"pinned": entry("pinned", "f_dev", best_sha256="other-hash")},
            manifest(),
            required_roles={"f_dev"},
        )


def test_manifest_fails_when_required_summary_is_missing():
    with pytest.raises(mpt.PaperSourceError, match="summary.json is missing"):
        mpt.runs_by_manifest(
            {"pinned": entry("pinned", "f_dev")},
            manifest(require_summary=True),
            required_roles={"f_dev"},
        )
