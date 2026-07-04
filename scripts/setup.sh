#!/bin/bash
# Idempotent setup for a project-local Python environment.
#
# Builds a self-contained .venv at the repo root so mtga no longer depends
# on the shared /opt/sbwco conda env or on ~/.zshrc for its interpreter or
# PYTHONPATH. Safe to re-run: each step is a no-op when already satisfied.
#
# After running, point the app/cron at: <repo>/.venv/bin/python
# (run_app.sh honors MTGA_PYTHON; this script prints the path to use.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
VENV="$REPO_ROOT/.venv"
PY_VERSION="3.12"

echo "==> mtga setup (repo: $REPO_ROOT)"

# 1. Resolve a base interpreter that is NOT the sbwco env. The sbwco conda
#    env owns `python3`/`python3.12` on PATH (via ~/.zshrc), so we resolve an
#    independent 3.12 explicitly rather than trusting a bare PATH lookup.
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
    # Fallback: a uv-managed standalone CPython (user-space, no sudo/brew).
    # On this box brew's python@3.12 install is blocked by admin-owned dirs
    # under /usr/local (fix: sudo chown -R $(whoami):admin $(brew --prefix)/*).
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
    # Last resort: Apple's system python3 (3.9 — too old for the ML stack).
    if [ -x /usr/bin/python3 ]; then
        echo "==> WARNING: falling back to /usr/bin/python3 (3.9)" >&2
        echo /usr/bin/python3
        return 0
    fi
    echo "ERROR: no suitable base Python found (brew python@${PY_VERSION}, uv, or /usr/bin/python3)" >&2
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

# 3. Install/upgrade dependencies (pip resolves no-ops cheaply on re-run).
echo "==> Installing dependencies from requirements.txt"
"$VENV_PY" -m pip install --upgrade pip >/dev/null
"$VENV_PY" -m pip install -r "$REPO_ROOT/requirements.txt"

# 4. Make the `mtga` package importable without relying on ~/.zshrc PYTHONPATH.
#    A .pth file in site-packages adds the repo root to sys.path for this venv.
SITE_PACKAGES="$("$VENV_PY" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
PTH_FILE="$SITE_PACKAGES/mtga_repo.pth"
if [ "$(cat "$PTH_FILE" 2>/dev/null)" != "$REPO_ROOT" ]; then
    echo "==> Writing path file: $PTH_FILE -> $REPO_ROOT"
    printf '%s\n' "$REPO_ROOT" > "$PTH_FILE"
else
    echo "==> Path file already correct: $PTH_FILE"
fi

# 5. Verify the environment is complete and self-contained.
echo "==> Verifying imports"
"$VENV_PY" - <<'PY'
import importlib, sys
mods = ["pandas", "numpy", "scipy", "requests", "pyarrow", "mtga"]
missing = []
for m in mods:
    try:
        importlib.import_module(m)
    except Exception as e:  # noqa: BLE001
        missing.append(f"{m}: {e}")
if missing:
    print("FAILED:\n  " + "\n  ".join(missing), file=sys.stderr)
    sys.exit(1)
print("OK:", ", ".join(mods))
PY

echo
echo "==> Done. Use this interpreter for the app and cron:"
echo "    $VENV_PY"
echo
echo "    e.g.  MTGA_PYTHON=$VENV_PY $REPO_ROOT/scripts/run_app.sh"
