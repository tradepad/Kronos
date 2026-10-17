import { enabledMarkets, type Config } from "@kronos/core";
import { insertEvent, type DB } from "@kronos/db";
import { log } from "./args";
import { runBacktest } from "./backtest";
import { persistBacktest } from "./persist";

/**
 * The live backtest worker: one short walk-forward run per tick, rotating
 * through markets. Guarded against re-entry — with a plain setInterval a
 * run slower than the interval piles up on the single-threaded sidecar and
 * nothing ever completes.
 */
export class BacktestWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private next = 0;

  constructor(
    private readonly db: DB,
    private readonly cfgFactory: () => Config,
    private readonly opts: { windows: number; intervalSec: number },
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.opts.intervalSec * 1000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.isRunning) return; // previous run still going: skip, don't pile up
    this.isRunning = true;
    const markets = enabledMarkets();
    const market = markets[this.next++ % markets.length]!;
    try {
      const res = await runBacktest({
        cfg: this.cfgFactory(),
        marketId: market.id,
        nWindows: this.opts.windows,
        seed: Math.floor(Math.random() * 1e9),
        quiet: true,
      });
      const id = persistBacktest(this.db, res);
      const r = res.run;
      log(
        `worker  ${market.short.padEnd(8)} run #${id}: raw ${(r.rawAccuracy * 100).toFixed(0)}% over ${r.rawPredictions}, ` +
          `${r.betsPlaced} bets, pnl ${r.totalPnl >= 0 ? "+" : ""}${r.totalPnl.toFixed(2)} (sim odds) in ${(r.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      insertEvent(this.db, { kind: "error", marketId: market.id, message: `worker: ${(err as Error).message.slice(0, 240)}` });
      log(`worker  ${market.short} ERROR ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
