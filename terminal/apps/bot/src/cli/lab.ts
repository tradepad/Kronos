/**
 * Strategy lab: sweep the strategy set over identical windows and several
 * seeds, and report the spread — never the best seed.
 *
 *   pnpm lab --market btc-updown-5m --windows 200 --seeds 5 --predictor heuristic
 *   pnpm lab --compare --market btc-updown-5m --windows 150 --seeds 3   # heuristic vs Kronos
 *
 * Nothing is written to the database. Odds are SIMULATED.
 */
import { fetchCandles, findMarket, lookback, makePredictor, mean, stdev, type Config } from "@kronos/core";
import { buildConfig, flag, num, parseArgs, str } from "../args";
import { runBacktest } from "../backtest";

const args = parseArgs(process.argv.slice(2));
const market = findMarket(str(args, "market", "btc-updown-5m"));
if (!market) throw new Error("Unknown --market");
const windows = num(args, "windows", 200);
const seeds = num(args, "seeds", 5);

async function sweep(cfg: Config, label: string, candles: Awaited<ReturnType<typeof fetchCandles>>["candles"]) {
  const per: Record<string, { pnl: number[]; wins: number; bets: number }> = {};
  const raw: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const res = await runBacktest({
      cfg,
      marketId: market!.id,
      nWindows: windows,
      seed: 1000 + s, // identical seeds across predictors → identical simulated odds
      candles,
      quiet: true,
      predictor: makePredictor(cfg, { horizonMinutes: market!.horizonMinutes, seed: 1000 + s }),
    });
    raw.push(res.run.rawAccuracy);
    for (const [k, v] of Object.entries(res.run.variants?.strategies ?? {})) {
      const a = (per[k] ??= { pnl: [], wins: 0, bets: 0 });
      a.pnl.push(v.pnl);
      a.wins += v.wins;
      a.bets += v.bets;
    }
    process.stdout.write(`\r  ${label}: seed ${s + 1}/${seeds}   `);
  }
  process.stdout.write("\n");
  console.log(`\n  ${label} · raw accuracy ${(mean(raw) * 100).toFixed(1)}% ± ${(stdev(raw) * 100).toFixed(1)} over ${seeds} seeds`);
  console.log(`  ${"strategy".padEnd(24)}${"mean pnl".padStart(10)}${"± sd".padStart(9)}${"win rate".padStart(10)}${"bets".padStart(7)}`);
  for (const [k, v] of Object.entries(per)) {
    console.log(
      `  ${k.padEnd(24)}${mean(v.pnl).toFixed(2).padStart(10)}${stdev(v.pnl).toFixed(2).padStart(9)}` +
        `${(v.bets ? ((v.wins / v.bets) * 100).toFixed(1) + "%" : "—").padStart(10)}${String(v.bets).padStart(7)}`,
    );
  }
}

async function main() {
  const base = buildConfig(args, { useRuntime: false });
  if (typeof args.samples !== "string") base.sampleCount = 3;
  const { candles, source } = await fetchCandles(base, {
    symbol: market!.bybitSymbol,
    interval: market!.bybitInterval,
    extraCandles: windows + 2,
  });
  console.log(`\n  LAB · ${market!.name} · ${candles.length} candles (${source}) · context ${lookback(base)} · SIMULATED odds`);
  if (flag(args, "compare")) {
    await sweep({ ...base, predictor: "heuristic" }, "heuristic", candles);
    await sweep({ ...base, predictor: "kronos" }, `kronos-${base.modelName}`, candles);
  } else {
    await sweep(base, base.predictor === "kronos" ? `kronos-${base.modelName}` : "heuristic", candles);
  }
  console.log(`\n  Count your strategies: with ${4} tested, the best one is expected to look good by chance.\n`);
}
main().catch((err) => {
  console.error(`\n  ${(err as Error).message}\n`);
  process.exit(1);
});
