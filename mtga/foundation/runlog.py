"""Append-only experiment ledger. Every training run writes one line; every
paper table cell maps back to a run_id here."""

import datetime
import hashlib
import json
import platform
import socket
import subprocess
from pathlib import Path

LEDGER = Path(__file__).resolve().parents[2] / "experiments" / "ledger.jsonl"


def git_sha():
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            cwd=LEDGER.parent.parent,
            timeout=10,
        ).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def file_sha256(path, limit_mb=None):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def new_run_id(name):
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{stamp}_{name}"


def append(record):
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    record = dict(record)
    record.setdefault(
        "logged_at", datetime.datetime.now().isoformat(timespec="seconds")
    )
    record.setdefault("host", socket.gethostname())
    record.setdefault("platform", platform.platform())
    record.setdefault("git_sha", git_sha())
    with open(LEDGER, "a") as fh:
        fh.write(json.dumps(record, default=str) + "\n")
    return record
