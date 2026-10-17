/**
 * Fast historical backfill: fetch history ONCE per market, then run many
 * walk-forward backtests at random start offsets over the same candles.
 *
 *   pnpm backfill --predictor kronos --model base --samples 3 --days 35 --runs 500 --windows 25
 *
 * Runs overlap, so they are NOT independent samples: treat cross-run spread
 * as a stability check, not a confidence interval.
 */
import { enabledMarkets, fetchCandles, findMarket, lookback, makePredictor } from "@kronos/core";
import { getDb, insertEvent } from "@kronos/db";
import { buildConfig, log, num, parseArgs, str } from "../args";
import { runBacktest } from "../backtest";
import { persistBackfill } from "../persist";

const args = parseArgs(process.argv.slice(2));
const cfg = buildConfig(args, { useRuntime: false });
// Exploration defaults — looser than production, so the gates have something to say.
if (typeof args.samples !== "string") cfg.sampleCount = 3;
if (typeof args["min-confidence"] !== "string") cfg.minConfidence = 0.55;
if (typeof args["min-edge"] !== "string") cfg.minEdge = 0.02;

const days = num(args, "days", 35);
const runsPerMarket = num(args, "runs", 500);
const windows = num(args, "windows", 25);
const ids = str(args, "markets", "");
const markets = ids ? ids.split(",").map((id) => findMarket(id.trim())) : enabledMarkets();

async function main() {
  const db = getDb(cfg.dbPath);
  const t0 = Date.now();
  let total = 0;
  for (const market of markets) {
    if (!market) throw new Error(`Unknown market in --markets "${ids}"`);
    const candlesPerDay = (24 * 60) / Number(market.bybitInterval);
    log(`${market.id}: fetching ${days} days (${Math.ceil(days * candlesPerDay)} candles)…`);
    const { candles, source } = await fetchCandles(cfg, {
      symbol: market.bybitSymbol,
      interval: market.bybitInterval,
      extraCandles: Math.ceil(days * candlesPerDay),
    });
    const maxOffset = Math.max(0, candles.length - lookback(cfg) - windows - 2);
    log(`${market.id}: ${candles.length} candles from ${source}, ${runsPerMarket} runs × ${windows} windows`);
    const predictor = makePredictor(cfg, { horizonMinutes: market.horizonMinutes });

    for (let run = 0; run < runsPerMarket; run++) {
      const res = await runBacktest({
        cfg,
        marketId: market.id,
        nWindows: windows,
        seed: Math.floor(Math.random() * 1e9),
        candles, // reused, no refetch
        startOffset: Math.floor(Math.random() * maxOffset),
        quiet: true,
        predictor,
        clock: "historical",
      });
      persistBackfill(db, res);
      total++;
      const r = res.run;
      process.stdout.write(
        `\r  ${market.id}  run ${run + 1}/${runsPerMarket}  raw ${(r.rawAccuracy * 100).toFixed(0)}%  bets ${r.betsPlaced}  ` +
          `pnl ${r.totalPnl >= 0 ? "+" : ""}${r.totalPnl.toFixed(2)}   `,
      );
    }
    process.stdout.write("\n");
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  insertEvent(db, { kind: "info", message: `Backfill finished: ${total} runs in ${secs}s (${cfg.predictor})` });
  log(`done: ${total} rows inserted into backfill_runs in ${secs}s. Market odds are SIMULATED.`);
}
main().catch((err) => {
  console.error(`\n  ${(err as Error).message}\n`);
  process.exit(1);
});
