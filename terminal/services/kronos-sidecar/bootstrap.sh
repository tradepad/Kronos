#!/usr/bin/env bash
#
# One-shot setup for the Kronos sidecar. Idempotent — safe to run repeatedly.
#
#   1. Find the Kronos `model/` package. This terminal lives inside a fork of
#      the Kronos repo, so it is normally already two folders up; otherwise
#      the upstream repo is cloned next to this script.
#   2. Create a local Python virtualenv.
#   3. Install the sidecar's requirements.
#
# Run `./bootstrap.sh` once, then `./run.sh` to start the service.
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SIDECAR_DIR"

REPO_ROOT="$(cd "$SIDECAR_DIR/../../.." && pwd)"
KRONOS_REPO_URL="https://github.com/shiyu-coder/Kronos.git"
VENV_DIR="$SIDECAR_DIR/.venv"

# 1. Kronos model package
if [[ -f "$REPO_ROOT/model/kronos.py" ]]; then
  echo "[bootstrap] Using Kronos model code from this repo: $REPO_ROOT/model"
elif [[ -d "$SIDECAR_DIR/Kronos/.git" ]]; then
  echo "[bootstrap] Kronos repo already present at $SIDECAR_DIR/Kronos"
else
  echo "[bootstrap] Cloning Kronos repo..."
  git clone --depth 1 "$KRONOS_REPO_URL" "$SIDECAR_DIR/Kronos"
fi

# 2. Python virtualenv — prefer 3.12 / 3.11, which have the widest wheel coverage.
PY=""
for cand in python3.12 python3.11 python3.13 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] else 1)'; then
      PY="$cand"; break
    fi
  fi
done
if [[ -z "$PY" ]]; then
  echo "[bootstrap] Python 3.10+ not found. Install Python 3.12 from https://www.python.org/downloads/" >&2
  exit 1
fi
if [[ ! -d "$VENV_DIR" ]]; then
  echo "[bootstrap] Creating Python virtualenv with $($PY --version)..."
  "$PY" -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install --quiet --upgrade pip wheel

# 3. Deps
echo "[bootstrap] Installing Python dependencies (torch is large — this can take a few minutes)..."
pip install --quiet -r "$SIDECAR_DIR/requirements.txt"

echo
echo "[bootstrap] Done. Start the sidecar with:  ./run.sh"
