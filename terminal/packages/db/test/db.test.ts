import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  backfillAggregateByMarket,
  dashboardSummary,
  getDb,
  insertBackfillRun,
  insertBacktestRun,
  insertTrade,
  recentBackfillRuns,
  recentBacktestRuns,
  resolveTrade,
  sanitizeRuntimeConfig,
  tradeStats,
  type RunInput,
} from "../src";

const dir = mkdtempSync(join(tmpdir(), "kronos-db-"));
const db = getDb(join(dir, "test.sqlite"));
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (over: Partial<RunInput> = {}): RunInput => ({
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: "2026-01-01T00:01:00Z",
  marketId: "btc-updown-5m",
  marketName: "BTC 5-Min Up/Down",
  predictorName: "heuristic",
  nWindows: 25,
  seed: 1,
  startingBankroll: 100,
  endingBankroll: 103,
  totalPnl: 3,
  totalWagered: 20,
  betsPlaced: 4,
  betsWon: 3,
  betsLost: 1,
  skipped: 21,
  winRate: 0.75,
  roi: 0.15,
  avgEdge: 0.06,
  avgKelly: 0.02,
  durationMs: 10,
  rawPredictions: 25,
  rawCorrect: 13,
  rawAccuracy: 0.52,
  rawPnl: 0.4,
  brier: 0.25,
  logLoss: 0.69,
  reliabilityBins: null,
  regime: "mid",
  variants: { strategies: {}, skips: { "Low confidence": 21, "Bet placed": 4 } },
  ...over,
});

describe("worker and backfill tables do not leak", () => {
  it("keeps rows apart", () => {
    insertBacktestRun(db, run({ totalPnl: 3 }));
    insertBackfillRun(db, run({ totalPnl: -7, marketId: "eth-updown-5m" }));
    insertBackfillRun(db, run({ totalPnl: 2, marketId: "eth-updown-5m" }));
    expect(recentBackfillRuns(db).every((r) => r.marketId === "eth-updown-5m")).toBe(true);
    expect(recentBacktestRuns(db)).toHaveLength(1);
    const agg = backfillAggregateByMarket(db);
    expect(agg).toHaveLength(1);
    expect(agg[0]!.totalPnl).toBe(-5);
    expect(dashboardSummary(db, "worker").totalPnl).toBe(3);
    expect(dashboardSummary(db, "backfill").totalPnl).toBe(-5);
    expect(recentBacktestRuns(db)[0]!.variants?.skips["Bet placed"]).toBe(4);
  });
});

describe("paper trades", () => {
  it("tracks bankroll from resolved trades only", () => {
    const id = insertTrade(db, {
      openedAt: "2026-01-01T00:00:00Z",
      marketId: "btc-updown-5m",
      slug: "btc-updown-5m-1",
      direction: "UP",
      modelProb: 0.7,
      marketPrice: 0.45,
      edge: 0.25,
      stakeUsd: 5,
      kellyRaw: 0.4,
      windowStart: "2026-01-01T00:05:00Z",
      windowEnd: "2026-01-01T00:10:00Z",
      oddsReal: true,
    });
    expect(tradeStats(db, 100)).toMatchObject({ bankroll: 100, openCount: 1, openStake: 5 });
    resolveTrade(db, id, true, 6);
    expect(tradeStats(db, 100)).toMatchObject({ bankroll: 106, openCount: 0, wins: 1, resolved: 1 });
  });
});

describe("runtime config", () => {
  it("never lets an arbitrary string pick a table", () => {
    expect(sanitizeRuntimeConfig({ backtestSource: "backtest_runs; DROP TABLE x" }).backtestSource).toBe("worker");
    expect(sanitizeRuntimeConfig({ backtestSource: "backfill" }).backtestSource).toBe("backfill");
    expect(sanitizeRuntimeConfig({ minConfidence: 7 }).minConfidence).toBe(1);
  });
});
