import { insertBackfillRun, insertBacktestRun, insertEvent, insertSamples, type DB } from "@kronos/db";
import type { BacktestResult } from "./backtest";

const money = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`;

export function persistBacktest(db: DB, res: BacktestResult): number {
  const id = db.transaction(() => {
    const id = insertBacktestRun(db, res.run);
    insertSamples(db, res.samples);
    return id;
  })();
  return id;
}

/** Backfill writes three things: the run row, its samples, and one event. */
export function persistBackfill(db: DB, res: BacktestResult): number {
  return db.transaction(() => {
    const id = insertBackfillRun(db, res.run);
    insertSamples(db, res.samples);
    const r = res.run;
    insertEvent(db, {
      kind: "backfill",
      marketId: r.marketId,
      message: `${r.nWindows} windows · raw ${(r.rawAccuracy * 100).toFixed(1)}% · gated ${r.betsPlaced} bets ${money(r.totalPnl)} (sim odds)`,
      payload: { runId: id, predictor: r.predictorName, seed: r.seed },
    });
    return id;
  })();
}
