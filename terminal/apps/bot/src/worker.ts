import { enabledMarkets, type Config } from "@kronos/core";
import { insertEvent, scoredSlugs, type DB } from "@kronos/db";
import { log } from "./args";
import { NoNewWindowsError, runBacktest } from "./backtest";
import { persistBacktest } from "./persist";

/**
 * The live backtest worker: one short walk-forward run per tick, rotating
 * through markets. Guarded against re-entry — with a plain setInterval a
 * run slower than the interval piles up on the single-threaded sidecar and
 * nothing ever completes.
 *
 * Each window is scored once: the worker remembers the slugs it has tested
 * (seeded from the database, so restarts don't re-count either) and each
 * run only takes windows it hasn't seen. Between new windows a tick is a
 * cheap no-op.
 */
export class BacktestWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private next = 0;
  private readonly seen = new Map<string, Set<string>>();

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
    let seen = this.seen.get(market.id);
    if (!seen) {
      seen = scoredSlugs(this.db, "backtest", market.id);
      this.seen.set(market.id, seen);
    }
    try {
      const res = await runBacktest({
        cfg: this.cfgFactory(),
        marketId: market.id,
        nWindows: this.opts.windows,
        seed: Math.floor(Math.random() * 1e9),
        quiet: true,
        skipSlugs: seen,
      });
      const id = persistBacktest(this.db, res);
      for (const sample of res.samples) if (sample.slug) seen.add(sample.slug);
      const r = res.run;
      log(
        `worker  ${market.short.padEnd(8)} run #${id}: raw ${(r.rawAccuracy * 100).toFixed(0)}% over ${r.rawPredictions}, ` +
          `${r.betsPlaced} bets, pnl ${r.totalPnl >= 0 ? "+" : ""}${r.totalPnl.toFixed(2)} (sim odds) in ${(r.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      if (err instanceof NoNewWindowsError) return; // nothing new yet: wait for the next window
      insertEvent(this.db, { kind: "error", marketId: market.id, message: `worker: ${(err as Error).message.slice(0, 240)}` });
      log(`worker  ${market.short} ERROR ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
