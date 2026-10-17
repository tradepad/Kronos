#!/usr/bin/env bash
#
# Start the Kronos sidecar. Run `./bootstrap.sh` first.
#
#   KRONOS_VARIANT = mini | base    (which HuggingFace model to preload)
#   KRONOS_DEVICE  = mps | cuda | cpu   (auto-detected when unset)
#   KRONOS_PORT    = 5005
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SIDECAR_DIR"

if [[ ! -d ".venv" ]]; then
  echo "[run] .venv missing. Did you run ./bootstrap.sh?" >&2
  exit 1
fi

# shellcheck disable=SC1091
source ".venv/bin/activate"

export KRONOS_VARIANT="${KRONOS_VARIANT:-base}"
PORT="${KRONOS_PORT:-5005}"

echo "[run] variant=${KRONOS_VARIANT} port=${PORT}"
# Single worker on purpose: inference is GPU/MPS-bound and concurrency hurts.
exec python -m uvicorn server:app --host 127.0.0.1 --port "$PORT" --log-level info --workers 1
