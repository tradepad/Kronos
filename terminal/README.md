# Kronos Signal Desk

A research terminal that runs the **Kronos** candlestick foundation model against Polymarket's short-horizon crypto
up/down markets (`btc-updown-5m`, `eth-updown-5m`, `btc-updown-15m`, `eth-updown-15m`), backtests every signal,
stores it all in SQLite and shows it live on a dashboard at <http://localhost:3337>.

> **Paper trading only.** Nothing in this folder can place an order. There is no exchange or wallet key anywhere.
> Backtest PnL uses **simulated** market odds (0.50 ± 4%) and is an upper bound, not a forecast. Live paper trades
> are priced against **real** Polymarket order books.

## Start it (Windows)

1. Install **Node.js LTS** from <https://nodejs.org> and **Python 3.12** from <https://www.python.org/downloads/>
   (tick *Add python.exe to PATH*).
2. Double-click **`START-WINDOWS.bat`** in this folder.

The first run installs packages and PyTorch, then downloads the Kronos-base weights (~400 MB). Three windows open
(model service, bot, dashboard) and your browser opens the desk. Close the three windows to stop.

No model yet, or just want to look around? `START-WINDOWS.bat -Heuristic` runs the momentum + RSI baseline instead.

macOS / Linux: `./scripts/start.sh` (or `./scripts/start.sh heuristic`).

## What's on the desk

| Panel | What it tells you |
|---|---|
| KPI row | Paper bankroll, backtest PnL, gated win rate, raw (ungated) accuracy, Brier score, model + device |
| Signal radar | One row per market: Kronos's call, confidence, the real Polymarket price, edge, Kelly, and either the paper stake or the exact gate that said no |
| Window clock | Countdown to the next window opening |
| Equity pulse | Animated cumulative equity of the backtest runs, per-run PnL bars, model hit rate against the 50% coin-flip line |
| Kronos forecast | Last 48 candles plus every Monte Carlo sample Kronos drew for the next window, with 10–90% and 25–75% bands |
| Model vote | The UP/DOWN split, expected move, live Polymarket prices and each indicator's vote |
| Calibration | Reliability diagram, Brier, log loss and PSI drift, for backtests or for live calls once they settle |
| Gate verdicts | Which of the six gates rejected the most windows — the most useful debugging view |
| Strategy lab | Four research strategies scored on the same windows, including the contrarian *fade* test |
| Lifetime equity | Per-market equity on 5-minute buckets, shared y-scale, gaps shown as breaks, CSV export |
| Settings (top-left sliders icon) | Live-edits `data/runtime-config.json`: thresholds, Kelly, pause, worker vs backfill source |

If the live stream drops, the numbers grey out rather than pretending to be live.

## Commands

Run from this folder (`terminal/`).

```bash
pnpm bot --once --predictor kronos --model base --samples 3     # one real forecast, prints mock: false
pnpm bot --loop --predictor kronos --samples 3 \
  --backtest-windows 25 --backtest-interval 10 --min-confidence 0.55 --min-edge 0.02
pnpm backtest --market btc-updown-5m --windows 25 --samples 3   # one walk-forward run → backtest_runs
pnpm backfill --predictor kronos --days 35 --runs 40 --windows 25  # history sweep → backfill_runs
pnpm lab --compare --market btc-updown-5m --windows 150 --seeds 3  # Kronos vs heuristic, same windows
pnpm db:stats                                                     # row counts, no sqlite3 needed
pnpm web                                                          # dashboard on :3337
pnpm typecheck && pnpm test
```

Switch the dashboard to the backfill table (also a button on the desk):

```bash
curl -s -X POST http://localhost:3337/api/config -H 'content-type: application/json' -d '{"backtestSource":"backfill"}'
```

On a CPU each Kronos sample takes 1–3 s, so keep `--samples 3` and expect a 35-day backfill to take hours.
An NVIDIA GPU or Apple Silicon is 10–20× faster. On Windows, `bootstrap.ps1` installs the CUDA build of torch when it
finds an NVIDIA card, and `START-WINDOWS.bat` then defaults to 12 samples. With 3 samples, P(up) can only be 0, 33, 67
or 100%, so the model looks far surer than it is.

## How it fits together

```
Bybit → Binance → Coinbase (candles, first that answers)     Polymarket Gamma + CLOB (real odds, read-only)
                     │                                                    │
                     ▼                                                    ▼
   services/kronos-sidecar  ◄──HTTP──  apps/bot  (scanner · backtest worker · backfill · lab)
   FastAPI + Kronos (Python)                 │  better-sqlite3, WAL
                                             ▼
                                    data/kronos.sqlite  ◄── apps/web (Next.js, SSE /api/stream)
```

- `packages/core` — types, config, the six decision gates, Kelly, indicators, metrics, market registry, candle and
  odds fetchers, the heuristic and Kronos predictors, research strategies.
- `packages/db` — schema (`backtest_runs`, `backfill_runs`, `prediction_samples`, `trades`, `events`,
  `odds_snapshots`, `meta`), source-aware queries, the atomic runtime config.
- `services/kronos-sidecar` — loads `NeoQuasar/Kronos-base` (or `-mini`) using the `model/` package from this repo
  and draws all Monte Carlo samples in one batched pass. `pytest test_server.py` checks the contract without weights.

Adding a market is one object in `packages/core/src/markets.ts`. Polymarket lists 5- and 15-minute windows (there
is no 10-minute one); SOL 15m is included but switched off.

## Honest limits

1. **Backtest odds are simulated.** The real price already contains everyone else's forecast. The bot records a
   real Polymarket price tape (`odds_snapshots`) every cycle so results can later be re-run on reality.
2. **Backfill runs overlap**, so their spread is a stability check, not a confidence interval.
3. **Costs are a flat 2% round trip** — thin 5-minute books can be worse.
4. **BTC and ETH up/down are nearly the same bet.** Sizing shrinks with open positions, crudely.
5. **Kronos was not trained for 5-minute binary direction.** Compare it with the heuristic (`pnpm lab --compare`)
   before believing it adds anything.
6. **Every strategy you test raises the odds your best one is luck.**
