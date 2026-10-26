/** pnpm backtest --market btc-updown-5m --windows 25 --samples 3 [--predictor heuristic] */
import { enabledMarkets, findMarket } from "@kronos/core";
import { getDb } from "@kronos/db";
import { buildConfig, num, parseArgs, str } from "../args";
import { runBacktest } from "../backtest";
import { persistBacktest } from "../persist";
import { printRun } from "./print";

const args = parseArgs(process.argv.slice(2));
const cfg = buildConfig(args);
if (typeof args.samples !== "string") cfg.sampleCount = 3; // backtests need speed, not 20 samples

async function main() {
  const db = getDb(cfg.dbPath);
  const ids = str(args, "market", "all");
  const markets = ids === "all" ? enabledMarkets() : ids.split(",").map((id) => findMarket(id.trim()) ?? id);
  for (const m of markets) {
    if (typeof m === "string") throw new Error(`Unknown market "${m}"`);
    console.log(`\n  Backtest · ${m.name} · ${cfg.predictor} · ${num(args, "windows", 25)} windows`);
    const res = await runBacktest({
      cfg,
      marketId: m.id,
      nWindows: num(args, "windows", 25),
      seed: num(args, "seed", Math.floor(Math.random() * 1e9)),
    });
    const id = persistBacktest(db, res);
    printRun(res.run, id, "backtest_runs");
  }
}
main().catch((err) => {
  console.error(`\n  ${(err as Error).message}\n`);
  process.exit(1);
});
