#!/usr/bin/env bash
# Kronos Signal Desk: one-command start for macOS / Linux. Paper trading only.
#   ./scripts/start.sh             Kronos model + bot + dashboard
#   ./scripts/start.sh heuristic   baseline only, no model
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-kronos}"
SAMPLES="${SAMPLES:-3}"
command -v pnpm >/dev/null || npm install -g pnpm
pnpm install
PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
if [[ "$MODE" != "heuristic" ]]; then
  [[ -d services/kronos-sidecar/.venv ]] || services/kronos-sidecar/bootstrap.sh
  services/kronos-sidecar/run.sh > data/sidecar.log 2>&1 & PIDS+=($!)
  echo "Waiting for Kronos to load (log: data/sidecar.log)..."
  for _ in $(seq 1 120); do
    curl -s http://127.0.0.1:5005/health | grep -q '"loaded_variants":\["' && break
    sleep 2
  done
fi
pnpm bot --loop --predictor "$MODE" --model base --samples "$SAMPLES" \
  --backtest-windows 25 --backtest-interval 10 --min-confidence 0.55 --min-edge 0.02 > data/bot.log 2>&1 & PIDS+=($!)
pnpm web & PIDS+=($!)
sleep 6
(command -v open >/dev/null && open http://localhost:3337) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3337) || true
echo "Dashboard: http://localhost:3337  ·  bot log: data/bot.log  ·  Ctrl+C stops everything"
wait
