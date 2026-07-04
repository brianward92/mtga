#!/bin/bash
# Idempotent setup for the ML venv (.venv-ml) used by the draft assistant:
# 17Lands pipeline, model training, and the draft API on :8100.
#
# Kept separate from .venv on purpose: torch 2.2.2 (the last Intel-Mac wheel)
# pins numpy<2, and those pins must never constrain the web-app path. This
# venv is disposable — nuke and re-run freely.
#
# After running, point the draft API/cron at: <repo>/.venv-ml/bin/python
# (run_draft_api.sh honors MTGA_DRAFT_PYTHON; this script prints the path.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
VENV="$REPO_ROOT/.venv-ml"
PY_VERSION="3.12"

echo "==> mtga ML setup (repo: $REPO_ROOT)"

# 1. Resolve a base interpreter that is NOT the sbwco env (same logic as setup.sh).
pick_base_python() {
    if command -v brew >/dev/null 2>&1; then
        local prefix
        if ! brew list --formula "python@${PY_VERSION}" >/dev/null 2>&1; then
            echo "==> Installing python@${PY_VERSION} via Homebrew..." >&2
            brew install "python@${PY_VERSION}" >&2
        fi
        prefix="$(brew --prefix "python@${PY_VERSION}" 2>/dev/null)"
        if [ -x "$prefix/bin/python${PY_VERSION}" ]; then
            echo "$prefix/bin/python${PY_VERSION}"
            return 0
        fi
    fi
    # Fallback: a uv-managed standalone CPython (user-space, no sudo/brew needed).
    # On this box brew's python@3.12 install is blocked by admin-owned dirs under
    # /usr/local (fix: sudo chown -R $(whoami):admin $(brew --prefix)/*).
    local uv_bin="$HOME/.local/bin/uv"
    if [ ! -x "$uv_bin" ] && command -v uv >/dev/null 2>&1; then
        uv_bin="$(command -v uv)"
    fi
    if [ -x "$uv_bin" ]; then
        echo "==> brew python unavailable; using uv-managed CPython ${PY_VERSION}" >&2
        "$uv_bin" python install "$PY_VERSION" >&2
        local uv_python
        uv_python="$("$uv_bin" python find "$PY_VERSION" 2>/dev/null)"
        if [ -x "$uv_python" ]; then
            echo "$uv_python"
            return 0
        fi
    fi
    echo "ERROR: no brew python@${PY_VERSION} and no uv; install either (torch needs 3.12)" >&2
    return 1
}

BASE_PYTHON="$(pick_base_python)"
echo "==> Base interpreter: $BASE_PYTHON ($("$BASE_PYTHON" --version 2>&1))"

case "$BASE_PYTHON" in
    /opt/sbwco/*) echo "ERROR: refusing to build venv from the sbwco env ($BASE_PYTHON)" >&2; exit 1 ;;
esac

# 2. Create the venv if missing (idempotent).
if [ ! -x "$VENV/bin/python" ]; then
    echo "==> Creating venv at $VENV"
    "$BASE_PYTHON" -m venv "$VENV"
else
    echo "==> Reusing existing venv at $VENV"
fi
VENV_PY="$VENV/bin/python"

# 3. Install dependencies (torch wheel is ~150MB; first run takes a few minutes).
echo "==> Installing dependencies from requirements.txt + requirements-ml.txt"
"$VENV_PY" -m pip install --upgrade pip >/dev/null
"$VENV_PY" -m pip install -r "$REPO_ROOT/requirements-ml.txt"

# 4. Make the `mtga` package importable (same .pth mechanism as setup.sh).
SITE_PACKAGES="$("$VENV_PY" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
PTH_FILE="$SITE_PACKAGES/mtga_repo.pth"
if [ "$(cat "$PTH_FILE" 2>/dev/null)" != "$REPO_ROOT" ]; then
    echo "==> Writing path file: $PTH_FILE -> $REPO_ROOT"
    printf '%s\n' "$REPO_ROOT" > "$PTH_FILE"
else
    echo "==> Path file already correct: $PTH_FILE"
fi

# 5. Verify: imports plus a tiny torch training step (the smoke test that matters).
echo "==> Verifying imports and a torch MLP fit"
"$VENV_PY" - <<'PY'
import importlib, sys

mods = ["numpy", "pandas", "scipy", "sklearn", "pyarrow", "duckdb", "requests",
        "torch", "onnx", "onnxruntime", "mtga"]
missing = []
for m in mods:
    try:
        importlib.import_module(m)
    except Exception as e:  # noqa: BLE001
        missing.append(f"{m}: {e}")
if missing:
    print("FAILED:\n  " + "\n  ".join(missing), file=sys.stderr)
    sys.exit(1)

import numpy as np
import torch

assert torch.__version__.startswith("2.2.2"), torch.__version__
assert np.__version__.startswith("1.26"), np.__version__

torch.manual_seed(17)
x = torch.randn(256, 32)
y = (x[:, 0] > 0).long()
model = torch.nn.Sequential(torch.nn.Linear(32, 16), torch.nn.ReLU(), torch.nn.Linear(16, 2))
opt = torch.optim.Adam(model.parameters(), lr=1e-2)
loss0 = None
for _ in range(50):
    opt.zero_grad()
    loss = torch.nn.functional.cross_entropy(model(x), y)
    loss.backward()
    opt.step()
    loss0 = loss0 if loss0 is not None else loss.item()
assert loss.item() < loss0, "torch MLP did not learn"
print(f"OK: {', '.join(mods)} | torch {torch.__version__} fit: {loss0:.3f} -> {loss.item():.3f}")
PY

echo
echo "==> Done. Use this interpreter for the draft API and ML cron:"
echo "    $VENV_PY"
