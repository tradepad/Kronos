import type Database from "better-sqlite3";

const RUN_COLUMNS = `
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT NOT NULL,
  market_id         TEXT NOT NULL,
  market_name       TEXT NOT NULL,
  predictor_name    TEXT NOT NULL,
  n_windows         INTEGER NOT NULL,
  seed              INTEGER NOT NULL,
  starting_bankroll REAL NOT NULL,
  ending_bankroll   REAL NOT NULL,
  total_pnl         REAL NOT NULL,
  total_wagered     REAL NOT NULL,
  bets_placed       INTEGER NOT NULL,
  bets_won          INTEGER NOT NULL,
  bets_lost         INTEGER NOT NULL,
  skipped           INTEGER NOT NULL,
  win_rate          REAL NOT NULL,
  roi               REAL NOT NULL,
  avg_edge          REAL,
  avg_kelly         REAL,
  duration_ms       INTEGER NOT NULL,
  raw_predictions   INTEGER NOT NULL DEFAULT 0,
  raw_correct       INTEGER NOT NULL DEFAULT 0,
  raw_accuracy      REAL NOT NULL DEFAULT 0,
  raw_pnl           REAL NOT NULL DEFAULT 0,
  brier             REAL,
  log_loss          REAL,
  reliability_bins  TEXT,
  regime            TEXT,
  variants          TEXT
`;

/**
 * Idempotent schema, run on every connection open. For a single-file
 * research database this is simpler than a migration framework and
 * cannot drift out of sync.
 */
export const SCHEMA_SQL = `
-- Results from the LIVE backtest worker: slow, continuous, one run per interval.
CREATE TABLE IF NOT EXISTS backtest_runs (${RUN_COLUMNS});
CREATE INDEX IF NOT EXISTS idx_backtest_runs_market      ON backtest_runs(market_id);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_finished_at ON backtest_runs(finished_at);

-- Results from the FAST BACKFILL runner. Identical shape, separate table, so
-- a 35-day sweep never contaminates the live worker's rolling record.
CREATE TABLE IF NOT EXISTS backfill_runs (${RUN_COLUMNS});
CREATE INDEX IF NOT EXISTS idx_backfill_runs_market      ON backfill_runs(market_id);
CREATE INDEX IF NOT EXISTS idx_backfill_runs_finished_at ON backfill_runs(finished_at);

-- One row per individual prediction. This is what calibration is fitted on.
CREATE TABLE IF NOT EXISTS prediction_samples (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp                TEXT NOT NULL,
  source                   TEXT NOT NULL,   -- 'live' | 'backtest' | 'backfill'
  market_id                TEXT NOT NULL,
  predictor_name           TEXT NOT NULL,
  model_prob               REAL NOT NULL,   -- probability of the predicted direction
  calibrated_prob          REAL,
  direction                TEXT NOT NULL,
  actual_direction         TEXT,
  triple_barrier_direction TEXT,
  actual_change_pct        REAL,
  regime                   TEXT,
  slug                     TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_source ON prediction_samples(source, market_id);

-- Simulated trades. NEVER submitted to an exchange.
CREATE TABLE IF NOT EXISTS trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_at     TEXT NOT NULL,
  market_id     TEXT NOT NULL,
  slug          TEXT NOT NULL,
  direction     TEXT NOT NULL,
  model_prob    REAL NOT NULL,
  market_price  REAL NOT NULL,
  edge          REAL NOT NULL,
  stake_usd     REAL NOT NULL,
  kelly_raw     REAL NOT NULL,
  resolved_at   TEXT,
  won           INTEGER,
  pnl           REAL,
  simulated     INTEGER NOT NULL DEFAULT 1,
  window_start  TEXT,
  window_end    TEXT,
  odds_real     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trades_open ON trades(resolved_at);

-- Append-only operational log surfaced on the dashboard.
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  kind      TEXT NOT NULL,   -- 'cycle' | 'bet' | 'skip' | 'resolve' | 'error' | 'backfill' | 'backtest'
  market_id TEXT,
  message   TEXT NOT NULL,
  payload   TEXT             -- JSON
);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, market_id, id);

-- Real Polymarket prices captured every cycle: the start of a genuine tape,
-- so simulated-odds results can one day be re-run against reality.
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL,
  market_id  TEXT NOT NULL,
  slug       TEXT NOT NULL,
  up_price   REAL,
  down_price REAL,
  up_mid     REAL,
  down_mid   REAL
);
CREATE INDEX IF NOT EXISTS idx_odds_market ON odds_snapshots(market_id, timestamp);

-- Small key/value store for process heartbeats (bot status, sidecar health).
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(SCHEMA_SQL);
}
