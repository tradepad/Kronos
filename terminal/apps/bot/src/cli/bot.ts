/**
 * pnpm bot --once  --predictor kronos --model base --samples 3
 * pnpm bot --loop  --predictor kronos --model base --samples 3 \
 *          --backtest-windows 25 --backtest-interval 10 --min-confidence 0.55 --min-edge 0.02
 *
 * Paper trading only. Nothing here can submit an order.
 */
import { enabledMarkets, fetchCandles, findMarket, makePredictor, sidecarHealth, type Config } from "@kronos/core";
import { getDb, patchRuntimeConfig, setMeta, readRuntimeConfig, type DB } from "@kronos/db";
import { buildConfig, flag, log, num, parseArgs, str } from "../args";
import { Scanner } from "../scanner";
import { BacktestWorker } from "../worker";

const args = parseArgs(process.argv.slice(2));

// In loop mode the dashboard owns the four live gates. Flags given on the
// command line seed data/runtime-config.json once at startup, then drop out
// of the per-cycle config so dashboard edits are never silently overridden.
const RUNTIME_FLAGS = {
  "min-confidence": "minConfidence",
  "min-edge": "minEdge",
  "kelly-fraction": "kellyFraction",
  "max-bet-pct": "maxBetPct",
} as const;
if (flag(args, "loop")) {
  const seed: Record<string, number> = {};
  for (const [f, key] of Object.entries(RUNTIME_FLAGS)) {
    if (typeof args[f] === "string") {
      seed[key] = num(args, f, NaN);
      delete args[f];
    }
  }
  if (Object.keys(seed).length) patchRuntimeConfig(seed);
}
const cfgFactory = () => buildConfig(args);

async function once(): Promise<void> {
  const cfg = cfgFactory();
  const market = findMarket(str(args, "market", "btc-updown-5m")) ?? enabledMarkets()[0]!;
  const { candles, source } = await fetchCandles(cfg, { symbol: market.bybitSymbol, interval: market.bybitInterval });
  const predictor = makePredictor(cfg, { horizonMinutes: market.horizonMinutes });
  const p = await predictor.predict(candles, cfg);
  const out = {
    market: market.id,
    predictor: predictor.name,
    mock: p.mock,
    candleSource: source,
    candles: candles.length,
    lastCandle: candles[candles.length - 1]?.timestamp.toISOString(),
    direction: p.direction,
    probUp: Number(p.probUp.toFixed(4)),
    confidence: Number(p.confidence.toFixed(4)),
    currentClose: p.currentClose,
    predictedCloseAvg: Number(p.predictedCloseAvg.toFixed(2)),
    predictedChangePct: Number(p.predictedChangePct.toFixed(4)),
    samples: p.sampleCount,
    durationMs: p.durationMs,
  };
  if (flag(args, "json")) console.log(JSON.stringify(out));
  else {
    console.log(`\n  KRONOS · ${market.name}`);
    for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(20)} ${v}`);
    console.log();
  }
  if (flag(args, "scan")) {
    const db = getDb(cfg.dbPath);
    await new Scanner(db, cfgFactory).cycle({ force: true });
  }
}

async function heartbeat(db: DB, cfg: Config, mode: string, extra: Record<string, unknown> = {}) {
  const health = cfg.predictor === "kronos" ? await sidecarHealth(cfg.kronosSidecarUrl) : null;
  setMeta(db, "bot", {
    pid: process.pid,
    mode,
    predictor: cfg.predictor === "kronos" ? `kronos-${cfg.modelName}` : "heuristic",
    sampleCount: cfg.sampleCount,
    sidecar: health,
    paused: readRuntimeConfig().paused,
    at: new Date().toISOString(),
    ...extra,
  });
}

async function loop(): Promise<void> {
  const cfg = cfgFactory();
  const db = getDb(cfg.dbPath);
  const scanInterval = num(args, "scan-interval", 15);
  log(`Kronos research terminal bot · predictor=${cfg.predictor} model=${cfg.modelName} samples=${cfg.sampleCount}`);
  log(`PAPER TRADING ONLY — no orders are ever submitted. Markets: ${enabledMarkets().map((m) => m.id).join(", ")}`);

  if (cfg.predictor === "kronos") {
    const h = await sidecarHealth(cfg.kronosSidecarUrl);
    if (!h.ok) {
      console.error(`\n  Kronos sidecar is not answering at ${cfg.kronosSidecarUrl} (${h.error}).`);
      console.error(`  Start it first:  cd services/kronos-sidecar && ./run.sh`);
      console.error(`  Or run the baseline:  pnpm bot --loop --predictor heuristic\n`);
      process.exit(1);
    }
    log(`sidecar ok · device=${h.device} · loaded=${h.loadedVariants.join(",") || "none yet"}`);
  }

  const scanner = new Scanner(db, cfgFactory);
  let worker: BacktestWorker | null = null;
  if (!flag(args, "no-worker")) {
    worker = new BacktestWorker(db, cfgFactory, {
      windows: num(args, "backtest-windows", 25),
      intervalSec: num(args, "backtest-interval", 10),
    });
  }

  let stopping = false;
  const shutdown = () => {
    if (stopping) process.exit(0);
    stopping = true;
    log("stopping…");
    worker?.stop();
    setMeta(db, "bot", { pid: process.pid, mode: "stopped", at: new Date().toISOString() });
    setTimeout(() => process.exit(0), 300);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Scanner first so the dashboard gets a signal immediately, then the worker.
  let scanning = false;
  const scan = async () => {
    if (scanning || stopping) return;
    scanning = true;
    try {
      await scanner.resolve(cfgFactory());
      await scanner.cycle();
      await heartbeat(db, cfgFactory(), "loop", { scanIntervalSec: scanInterval });
    } catch (err) {
      log(`scan ERROR ${(err as Error).message}`);
    } finally {
      scanning = false;
    }
  };
  await scan();
  worker?.start();
  setInterval(() => void scan(), scanInterval * 1000);
}

const main = flag(args, "loop") ? loop : once;
main().catch((err) => {
  console.error(`\n  ${(err as Error).message}\n`);
  process.exit(1);
});
