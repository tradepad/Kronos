import { skipReasonKey, type ReliabilityBin } from "@kronos/core";
import type { DB } from "./client";

export type BacktestSource = "worker" | "backfill";
type RunTable = "backtest_runs" | "backfill_runs";

/** Never interpolate an arbitrary string into a table name. */
const tableFor = (source: BacktestSource): RunTable => (source === "backfill" ? "backfill_runs" : "backtest_runs");

export interface StrategyResult {
  bets: number;
  wins: number;
  pnl: number;
  wagered: number;
}

export interface RunVariants {
  strategies: Record<string, StrategyResult>;
  skips: Record<string, number>;
}

export interface RunInput {
  startedAt: string;
  finishedAt: string;
  marketId: string;
  marketName: string;
  predictorName: string;
  nWindows: number;
  seed: number;
  startingBankroll: number;
  endingBankroll: number;
  totalPnl: number;
  totalWagered: number;
  betsPlaced: number;
  betsWon: number;
  betsLost: number;
  skipped: number;
  winRate: number;
  roi: number;
  avgEdge: number | null;
  avgKelly: number | null;
  durationMs: number;
  rawPredictions: number;
  rawCorrect: number;
  rawAccuracy: number;
  rawPnl: number;
  brier: number | null;
  logLoss: number | null;
  reliabilityBins: ReliabilityBin[] | null;
  regime: string | null;
  variants: RunVariants | null;
}

export interface RunRow extends RunInput {
  id: number;
}
export type BacktestRunRow = RunRow;
export type BackfillRunRow = RunRow;

const COLS = [
  ["started_at", "startedAt"],
  ["finished_at", "finishedAt"],
  ["market_id", "marketId"],
  ["market_name", "marketName"],
  ["predictor_name", "predictorName"],
  ["n_windows", "nWindows"],
  ["seed", "seed"],
  ["starting_bankroll", "startingBankroll"],
  ["ending_bankroll", "endingBankroll"],
  ["total_pnl", "totalPnl"],
  ["total_wagered", "totalWagered"],
  ["bets_placed", "betsPlaced"],
  ["bets_won", "betsWon"],
  ["bets_lost", "betsLost"],
  ["skipped", "skipped"],
  ["win_rate", "winRate"],
  ["roi", "roi"],
  ["avg_edge", "avgEdge"],
  ["avg_kelly", "avgKelly"],
  ["duration_ms", "durationMs"],
  ["raw_predictions", "rawPredictions"],
  ["raw_correct", "rawCorrect"],
  ["raw_accuracy", "rawAccuracy"],
  ["raw_pnl", "rawPnl"],
  ["brier", "brier"],
  ["log_loss", "logLoss"],
  ["reliability_bins", "reliabilityBins"],
  ["regime", "regime"],
  ["variants", "variants"],
] as const;

const JSON_COLS = new Set(["reliabilityBins", "variants"]);

function rowToRun(r: Record<string, unknown>): RunRow {
  const out: Record<string, unknown> = { id: r.id };
  for (const [col, key] of COLS) {
    const v = r[col];
    out[key] = JSON_COLS.has(key) && typeof v === "string" ? safeJson(v) : v;
  }
  return out as unknown as RunRow;
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

function insertRun(db: DB, table: RunTable, run: RunInput): number {
  const cols = COLS.map(([c]) => c).join(", ");
  const params = COLS.map(([, k]) => `@${k}`).join(", ");
  const values: Record<string, unknown> = {};
  for (const [, k] of COLS) {
    const v = run[k];
    values[k] = JSON_COLS.has(k) ? (v == null ? null : JSON.stringify(v)) : v;
  }
  const res = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${params})`).run(values);
  return Number(res.lastInsertRowid);
}

export const insertBacktestRun = (db: DB, run: RunInput) => insertRun(db, "backtest_runs", run);
export const insertBackfillRun = (db: DB, run: RunInput) => insertRun(db, "backfill_runs", run);

function recentRuns(db: DB, table: RunTable, limit: number): RunRow[] {
  return (db.prepare(`SELECT * FROM ${table} ORDER BY finished_at DESC, id DESC LIMIT ?`).all(limit) as Record<
    string,
    unknown
  >[]).map(rowToRun);
}
export const recentBacktestRuns = (db: DB, limit = 200) => recentRuns(db, "backtest_runs", limit);
export const recentBackfillRuns = (db: DB, limit = 200) => recentRuns(db, "backfill_runs", limit);
export const recentRunsFor = (db: DB, source: BacktestSource, limit = 200) => recentRuns(db, tableFor(source), limit);

function latestPerMarket(db: DB, table: RunTable): RunRow[] {
  return (
    db
      .prepare(
        `SELECT r.* FROM ${table} r
         JOIN (SELECT market_id, MAX(id) AS id FROM ${table} GROUP BY market_id) m ON m.id = r.id
         ORDER BY r.market_id`,
      )
      .all() as Record<string, unknown>[]
  ).map(rowToRun);
}
export const latestBacktestPerMarket = (db: DB) => latestPerMarket(db, "backtest_runs");
export const latestBackfillPerMarket = (db: DB) => latestPerMarket(db, "backfill_runs");

export interface MarketAggregate {
  marketId: string;
  marketName: string;
  runs: number;
  windows: number;
  totalPnl: number;
  totalWagered: number;
  betsPlaced: number;
  betsWon: number;
  winRate: number;
  roi: number;
  rawPredictions: number;
  rawCorrect: number;
  rawAccuracy: number;
  rawPnl: number;
  avgBrier: number | null;
  avgLogLoss: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

function aggregateByMarket(db: DB, table: RunTable): MarketAggregate[] {
  const rows = db
    .prepare(
      `SELECT market_id, MAX(market_name) AS market_name, COUNT(*) AS runs,
              SUM(n_windows) AS windows, SUM(total_pnl) AS total_pnl, SUM(total_wagered) AS total_wagered,
              SUM(bets_placed) AS bets_placed, SUM(bets_won) AS bets_won,
              SUM(raw_predictions) AS raw_predictions, SUM(raw_correct) AS raw_correct, SUM(raw_pnl) AS raw_pnl,
              AVG(brier) AS avg_brier, AVG(log_loss) AS avg_log_loss,
              MIN(finished_at) AS first_at, MAX(finished_at) AS last_at
       FROM ${table} GROUP BY market_id ORDER BY market_id`,
    )
    .all() as Record<string, number | string | null>[];
  return rows.map((r) => {
    const betsPlaced = Number(r.bets_placed ?? 0);
    const betsWon = Number(r.bets_won ?? 0);
    const wagered = Number(r.total_wagered ?? 0);
    const rawN = Number(r.raw_predictions ?? 0);
    const rawC = Number(r.raw_correct ?? 0);
    return {
      marketId: String(r.market_id),
      marketName: String(r.market_name),
      runs: Number(r.runs),
      windows: Number(r.windows ?? 0),
      totalPnl: Number(r.total_pnl ?? 0),
      totalWagered: wagered,
      betsPlaced,
      betsWon,
      winRate: betsPlaced ? betsWon / betsPlaced : 0,
      roi: wagered ? Number(r.total_pnl ?? 0) / wagered : 0,
      rawPredictions: rawN,
      rawCorrect: rawC,
      rawAccuracy: rawN ? rawC / rawN : 0,
      rawPnl: Number(r.raw_pnl ?? 0),
      avgBrier: r.avg_brier === null ? null : Number(r.avg_brier),
      avgLogLoss: r.avg_log_loss === null ? null : Number(r.avg_log_loss),
      firstAt: (r.first_at as string | null) ?? null,
      lastAt: (r.last_at as string | null) ?? null,
    };
  });
}
export const backtestAggregateByMarket = (db: DB) => aggregateByMarket(db, "backtest_runs");
export const backfillAggregateByMarket = (db: DB) => aggregateByMarket(db, "backfill_runs");
export const aggregateFor = (db: DB, source: BacktestSource) => aggregateByMarket(db, tableFor(source));

export interface DashboardSummary {
  source: BacktestSource;
  runs: number;
  windows: number;
  totalPnl: number;
  totalWagered: number;
  betsPlaced: number;
  betsWon: number;
  winRate: number;
  roi: number;
  rawPredictions: number;
  rawAccuracy: number;
  rawPnl: number;
  avgBrier: number | null;
  avgLogLoss: number | null;
  lastRunAt: string | null;
}

export function dashboardSummary(db: DB, source: BacktestSource = "worker"): DashboardSummary {
  const table = tableFor(source);
  const r = db
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(n_windows),0) AS windows, COALESCE(SUM(total_pnl),0) AS total_pnl,
              COALESCE(SUM(total_wagered),0) AS total_wagered, COALESCE(SUM(bets_placed),0) AS bets_placed,
              COALESCE(SUM(bets_won),0) AS bets_won, COALESCE(SUM(raw_predictions),0) AS raw_predictions,
              COALESCE(SUM(raw_correct),0) AS raw_correct, COALESCE(SUM(raw_pnl),0) AS raw_pnl,
              AVG(brier) AS avg_brier, AVG(log_loss) AS avg_log_loss, MAX(finished_at) AS last_run_at
       FROM ${table}`,
    )
    .get() as Record<string, number | string | null>;
  const betsPlaced = Number(r.bets_placed);
  const wagered = Number(r.total_wagered);
  const rawN = Number(r.raw_predictions);
  return {
    source,
    runs: Number(r.runs),
    windows: Number(r.windows),
    totalPnl: Number(r.total_pnl),
    totalWagered: wagered,
    betsPlaced,
    betsWon: Number(r.bets_won),
    winRate: betsPlaced ? Number(r.bets_won) / betsPlaced : 0,
    roi: wagered ? Number(r.total_pnl) / wagered : 0,
    rawPredictions: rawN,
    rawAccuracy: rawN ? Number(r.raw_correct) / rawN : 0,
    rawPnl: Number(r.raw_pnl),
    avgBrier: r.avg_brier === null ? null : Number(r.avg_brier),
    avgLogLoss: r.avg_log_loss === null ? null : Number(r.avg_log_loss),
    lastRunAt: (r.last_run_at as string | null) ?? null,
  };
}

/** Sum each run's skip-reason counts into one histogram. */
export function skipHistogram(db: DB, source: BacktestSource, limit = 2000): Record<string, number> {
  const out: Record<string, number> = {};
  for (const run of recentRuns(db, tableFor(source), limit)) {
    for (const [k, v] of Object.entries(run.variants?.skips ?? {})) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** Sum each run's per-strategy results. */
export function strategyTotals(db: DB, source: BacktestSource, limit = 2000): Record<string, StrategyResult> {
  const out: Record<string, StrategyResult> = {};
  for (const run of recentRuns(db, tableFor(source), limit)) {
    for (const [k, v] of Object.entries(run.variants?.strategies ?? {})) {
      const a = (out[k] ??= { bets: 0, wins: 0, pnl: 0, wagered: 0 });
      a.bets += v.bets;
      a.wins += v.wins;
      a.pnl += v.pnl;
      a.wagered += v.wagered;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prediction samples
// ---------------------------------------------------------------------------

export interface SampleInput {
  timestamp: string;
  source: "live" | "backtest" | "backfill";
  marketId: string;
  predictorName: string;
  modelProb: number;
  calibratedProb?: number | null;
  direction: "UP" | "DOWN";
  actualDirection?: "UP" | "DOWN" | null;
  tripleBarrierDirection?: "UP" | "DOWN" | null;
  actualChangePct?: number | null;
  regime?: string | null;
  slug?: string | null;
}

export function insertSamples(db: DB, rows: readonly SampleInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO prediction_samples (timestamp, source, market_id, predictor_name, model_prob, calibrated_prob,
       direction, actual_direction, triple_barrier_direction, actual_change_pct, regime, slug)
     VALUES (@timestamp, @source, @marketId, @predictorName, @modelProb, @calibratedProb,
       @direction, @actualDirection, @tripleBarrierDirection, @actualChangePct, @regime, @slug)`,
  );
  const tx = db.transaction((xs: readonly SampleInput[]) => {
    for (const r of xs)
      stmt.run({
        calibratedProb: null,
        actualDirection: null,
        tripleBarrierDirection: null,
        actualChangePct: null,
        regime: null,
        slug: null,
        ...r,
      });
  });
  tx(rows);
}

export interface SampleRow {
  timestamp: string;
  marketId: string;
  predictorName: string;
  modelProb: number;
  direction: "UP" | "DOWN";
  actualDirection: "UP" | "DOWN" | null;
  regime: string | null;
}

/** Resolved samples for calibration. `source` maps worker→backtest. */
export function resolvedSamples(
  db: DB,
  source: "live" | "backtest" | "backfill",
  opts: { limit?: number; marketId?: string } = {},
): SampleRow[] {
  const where = ["source = ?", "actual_direction IS NOT NULL"];
  const args: unknown[] = [source];
  if (opts.marketId) {
    where.push("market_id = ?");
    args.push(opts.marketId);
  }
  args.push(opts.limit ?? 20000);
  return (
    db
      .prepare(
        `SELECT timestamp, market_id, predictor_name, model_prob, direction, actual_direction, regime
         FROM prediction_samples WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`,
      )
      .all(...args) as Record<string, unknown>[]
  ).map((r) => ({
    timestamp: String(r.timestamp),
    marketId: String(r.market_id),
    predictorName: String(r.predictor_name),
    modelProb: Number(r.model_prob),
    direction: r.direction as "UP" | "DOWN",
    actualDirection: (r.actual_direction as "UP" | "DOWN" | null) ?? null,
    regime: (r.regime as string | null) ?? null,
  }));
}

export function unresolvedLiveSamples(db: DB): { id: number; marketId: string; slug: string | null }[] {
  return (
    db
      .prepare(
        `SELECT id, market_id, slug FROM prediction_samples
         WHERE source = 'live' AND actual_direction IS NULL AND slug IS NOT NULL ORDER BY id LIMIT 500`,
      )
      .all() as { id: number; market_id: string; slug: string | null }[]
  ).map((r) => ({ id: r.id, marketId: r.market_id, slug: r.slug }));
}

export function resolveSample(db: DB, id: number, actual: "UP" | "DOWN", changePct: number | null): void {
  db.prepare(`UPDATE prediction_samples SET actual_direction = ?, actual_change_pct = ? WHERE id = ?`).run(
    actual,
    changePct,
    id,
  );
}

// ---------------------------------------------------------------------------
// Trades (simulated, never submitted)
// ---------------------------------------------------------------------------

export interface TradeInput {
  openedAt: string;
  marketId: string;
  slug: string;
  direction: "UP" | "DOWN";
  modelProb: number;
  marketPrice: number;
  edge: number;
  stakeUsd: number;
  kellyRaw: number;
  windowStart: string;
  windowEnd: string;
  oddsReal: boolean;
}

export interface TradeRow extends TradeInput {
  id: number;
  resolvedAt: string | null;
  won: boolean | null;
  pnl: number | null;
  simulated: true;
}

export function insertTrade(db: DB, t: TradeInput): number {
  const res = db
    .prepare(
      `INSERT INTO trades (opened_at, market_id, slug, direction, model_prob, market_price, edge, stake_usd,
         kelly_raw, window_start, window_end, odds_real, simulated)
       VALUES (@openedAt, @marketId, @slug, @direction, @modelProb, @marketPrice, @edge, @stakeUsd,
         @kellyRaw, @windowStart, @windowEnd, @oddsReal, 1)`,
    )
    .run({ ...t, oddsReal: t.oddsReal ? 1 : 0 });
  return Number(res.lastInsertRowid);
}

const rowToTrade = (r: Record<string, unknown>): TradeRow => ({
  id: Number(r.id),
  openedAt: String(r.opened_at),
  marketId: String(r.market_id),
  slug: String(r.slug),
  direction: r.direction as "UP" | "DOWN",
  modelProb: Number(r.model_prob),
  marketPrice: Number(r.market_price),
  edge: Number(r.edge),
  stakeUsd: Number(r.stake_usd),
  kellyRaw: Number(r.kelly_raw),
  windowStart: String(r.window_start ?? ""),
  windowEnd: String(r.window_end ?? ""),
  oddsReal: Number(r.odds_real) === 1,
  resolvedAt: (r.resolved_at as string | null) ?? null,
  won: r.won === null || r.won === undefined ? null : Number(r.won) === 1,
  pnl: r.pnl === null || r.pnl === undefined ? null : Number(r.pnl),
  simulated: true,
});

export const recentTrades = (db: DB, limit = 100): TradeRow[] =>
  (db.prepare(`SELECT * FROM trades ORDER BY id DESC LIMIT ?`).all(limit) as Record<string, unknown>[]).map(
    rowToTrade,
  );

export const openTrades = (db: DB): TradeRow[] =>
  (db.prepare(`SELECT * FROM trades WHERE resolved_at IS NULL ORDER BY id`).all() as Record<string, unknown>[]).map(
    rowToTrade,
  );

export function resolveTrade(db: DB, id: number, won: boolean, pnl: number): void {
  db.prepare(`UPDATE trades SET resolved_at = ?, won = ?, pnl = ? WHERE id = ?`).run(
    new Date().toISOString(),
    won ? 1 : 0,
    pnl,
    id,
  );
}

export interface TradeStats {
  bankroll: number;
  realizedPnl: number;
  openStake: number;
  openCount: number;
  resolved: number;
  wins: number;
  winRate: number;
}

export function tradeStats(db: DB, initialBankroll: number): TradeStats {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN resolved_at IS NOT NULL THEN pnl END),0) AS realized,
              COALESCE(SUM(CASE WHEN resolved_at IS NULL THEN stake_usd END),0) AS open_stake,
              SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS wins
       FROM trades`,
    )
    .get() as Record<string, number | null>;
  const resolved = Number(r.resolved ?? 0);
  const realized = Number(r.realized ?? 0);
  return {
    bankroll: initialBankroll + realized,
    realizedPnl: realized,
    openStake: Number(r.open_stake ?? 0),
    openCount: Number(r.open_count ?? 0),
    resolved,
    wins: Number(r.wins ?? 0),
    winRate: resolved ? Number(r.wins ?? 0) / resolved : 0,
  };
}

// ---------------------------------------------------------------------------
// Events, odds tape, meta
// ---------------------------------------------------------------------------

export type EventKind = "cycle" | "bet" | "skip" | "resolve" | "error" | "backfill" | "backtest" | "info";

export interface EventRow {
  id: number;
  timestamp: string;
  kind: EventKind;
  marketId: string | null;
  message: string;
  payload: unknown;
}

export function insertEvent(
  db: DB,
  e: { kind: EventKind; marketId?: string | null; message: string; payload?: unknown; timestamp?: string },
): void {
  db.prepare(`INSERT INTO events (timestamp, kind, market_id, message, payload) VALUES (?, ?, ?, ?, ?)`).run(
    e.timestamp ?? new Date().toISOString(),
    e.kind,
    e.marketId ?? null,
    e.message,
    e.payload === undefined ? null : JSON.stringify(e.payload),
  );
}

const rowToEvent = (r: Record<string, unknown>, withPayload: boolean): EventRow => ({
  id: Number(r.id),
  timestamp: String(r.timestamp),
  kind: r.kind as EventKind,
  marketId: (r.market_id as string | null) ?? null,
  message: String(r.message),
  payload: withPayload && typeof r.payload === "string" ? safeJson(r.payload) : null,
});

/** Recent events for the tape; cycle events are excluded (they are signals, not news). */
export const recentEvents = (db: DB, limit = 50): EventRow[] =>
  (
    db.prepare(`SELECT id, timestamp, kind, market_id, message FROM events WHERE kind != 'cycle' ORDER BY id DESC LIMIT ?`).all(
      limit,
    ) as Record<string, unknown>[]
  ).map((r) => rowToEvent(r, false));

/** The most recent `cycle` event per market: the live signal, payload parsed. */
export function latestSignals(db: DB): EventRow[] {
  return (
    db
      .prepare(
        `SELECT e.* FROM events e
         JOIN (SELECT market_id, MAX(id) AS id FROM events WHERE kind = 'cycle' GROUP BY market_id) m ON m.id = e.id
         ORDER BY e.market_id`,
      )
      .all() as Record<string, unknown>[]
  ).map((r) => rowToEvent(r, true));
}

/** Live skip reasons over the most recent cycles. */
export function liveSkipHistogram(db: DB, limit = 500): Record<string, number> {
  const rows = db
    .prepare(`SELECT payload FROM events WHERE kind = 'cycle' ORDER BY id DESC LIMIT ?`)
    .all(limit) as { payload: string | null }[];
  const out: Record<string, number> = {};
  for (const r of rows) {
    const p = r.payload ? (safeJson(r.payload) as { decision?: { skipReason?: string | null } } | null) : null;
    if (!p?.decision) continue;
    const k = skipReasonKey(p.decision.skipReason ?? null);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function insertOddsSnapshot(
  db: DB,
  s: { marketId: string; slug: string; upPrice: number | null; downPrice: number | null; upMid: number | null; downMid: number | null },
): void {
  db.prepare(
    `INSERT INTO odds_snapshots (timestamp, market_id, slug, up_price, down_price, up_mid, down_mid)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(new Date().toISOString(), s.marketId, s.slug, s.upPrice, s.downPrice, s.upMid, s.downMid);
}

export function oddsSnapshotCount(db: DB): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM odds_snapshots`).get() as { n: number }).n);
}

export function setMeta(db: DB, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function getMeta<T>(db: DB, key: string): { value: T; updatedAt: string } | null {
  const r = db.prepare(`SELECT value, updated_at FROM meta WHERE key = ?`).get(key) as
    | { value: string; updated_at: string }
    | undefined;
  return r ? { value: safeJson(r.value) as T, updatedAt: r.updated_at } : null;
}
