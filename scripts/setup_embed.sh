#!/bin/bash
# Idempotent setup for the text-embedding venv (.venv-embed): the ONLY env
# that carries sentence-transformers. mtga/foundation/textemb.embed_names
# runs here to build/extend the bge-small-en-v1.5 cache; every other venv
# (.venv, .venv-ml) serves embeddings from that cache and never imports
# sentence-transformers.
#
# On Intel x86_64 (n41) pip resolves torch to 2.2.2 — the last Intel-Mac
# wheel — which is fine for CPU inference of a 33M-param encoder. numpy is
# pinned <2 to match that torch. This venv is disposable; nuke and re-run.
#
# After running:
#   .venv-embed/bin/python scripts/build_card_features.py --sets SOS --embed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
VENV="$REPO_ROOT/.venv-embed"
PY_VERSION="3.12"

echo "==> mtga embed setup (repo: $REPO_ROOT)"

# 1. Resolve a base interpreter that is NOT the sbwco env (same logic as
#    setup_ml.sh: brew python@3.12, else a uv-managed standalone CPython).
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
    echo "ERROR: no brew python@${PY_VERSION} and no uv; install either" >&2
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

# 3. Install dependencies (first run pulls torch ~150MB + transformers).
echo "==> Installing sentence-transformers (+ pandas/pyarrow for the build script)"
"$VENV_PY" -m pip install --upgrade pip >/dev/null
"$VENV_PY" -m pip install "numpy<2" sentence-transformers pandas pyarrow

# 4. Make the `mtga` package importable (same .pth mechanism as setup.sh).
SITE_PACKAGES="$("$VENV_PY" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
PTH_FILE="$SITE_PACKAGES/mtga_repo.pth"
if [ "$(cat "$PTH_FILE" 2>/dev/null)" != "$REPO_ROOT" ]; then
    echo "==> Writing path file: $PTH_FILE -> $REPO_ROOT"
    printf '%s\n' "$REPO_ROOT" > "$PTH_FILE"
else
    echo "==> Path file already correct: $PTH_FILE"
fi

# 5. Verify imports (the bge model itself downloads ~130MB on first embed run).
echo "==> Verifying imports"
"$VENV_PY" - <<'PY'
import numpy, sentence_transformers, torch

from mtga.foundation import textemb

print(f"OK: sentence-transformers {sentence_transformers.__version__} | "
      f"torch {torch.__version__} | numpy {numpy.__version__} | "
      f"model {textemb.MODEL_NAME} (downloads on first embed run)")
PY

echo
echo "==> Done. Extend the embedding cache with:"
echo "    $VENV_PY scripts/build_card_features.py --sets SOS --embed"
