// Wire types shared by the API routes and the client. Type-only: safe to
// import from client components.
import type { EquityPoint, LiveSignal, ReliabilityBin } from "@kronos/core";
import type { DashboardSummary, EventRow, MarketAggregate, RunRow, StrategyResult, TradeRow, TradeStats } from "@kronos/db";
import type { RuntimeConfig } from "@kronos/db";

export type { LiveSignal, EquityPoint, ReliabilityBin, RunRow, TradeRow, EventRow, RuntimeConfig };

export interface BotStatus {
  online: boolean;
  mode: string | null;
  predictor: string | null;
  sampleCount: number | null;
  lastSeen: string | null;
  sidecar: { ok: boolean; device?: string; loadedVariants: string[]; error?: string } | null;
}

export interface StatusPayload {
  bot: BotStatus;
  config: RuntimeConfig;
  oddsSnapshots: number;
  serverTime: string;
}

export interface SummaryPayload {
  source: "worker" | "backfill";
  backtest: DashboardSummary;
  paper: TradeStats & { initialBankroll: number };
}

export interface MarketLifetime {
  marketId: string;
  short: string;
  points: EquityPoint[];
  totalPnl: number;
  winRate: number;
  bets: number;
  sharpe: number | null;
  maxDrawdown: number;
  streak: number;
  runs: number;
}

export interface CalibrationPayload {
  source: string;
  n: number;
  brier: number | null;
  logLoss: number | null;
  bins: ReliabilityBin[];
  psi: number | null;
}

export interface BacktestPayload {
  source: "worker" | "backfill";
  equity: EquityPoint[];
  runPnls: { t: number; pnl: number }[];
  recent: RunRow[];
  latest: RunRow[];
  aggregate: MarketAggregate[];
  lifetime: MarketLifetime[];
  calibration: CalibrationPayload;
  liveCalibration: CalibrationPayload;
  skips: Record<string, number>;
  liveSkips: Record<string, number>;
  strategies: Record<string, StrategyResult>;
  sharpe: number | null;
  maxDrawdown: number;
  fingerprint: string;
}

export interface TapePayload {
  events: EventRow[];
  trades: TradeRow[];
}
