import "server-only";
import {
  brier,
  buildEquityCurve,
  buildMarketEquity,
  currentStreak,
  defaultConfig,
  defaultMarkets,
  enabledMarkets,
  logLoss,
  lttb,
  maxDrawdown,
  mergeReliabilityBins,
  psi,
  reliabilityBins,
  sharpe,
  sidecarHealth,
  type EquityPoint,
  type LiveSignal,
  type Scored,
} from "@kronos/core";
import {
  aggregateFor,
  dashboardSummary,
  getMeta,
  latestBackfillPerMarket,
  latestBacktestPerMarket,
  latestSignals,
  liveSkipHistogram,
  oddsSnapshotCount,
  recentEvents,
  recentRunsFor,
  recentTrades,
  resolvedSamples,
  skipHistogram,
  strategyTotals,
  tradeStats,
  type BacktestSource,
} from "@kronos/db";
import { db } from "./db";
import { readRuntimeConfig } from "./runtime-config";
import type {
  BacktestPayload,
  BotStatus,
  CalibrationPayload,
  MarketLifetime,
  StatusPayload,
  SummaryPayload,
  TapePayload,
} from "./types";

const BANKROLL = defaultConfig.initialBankroll;
const BOT_STALE_MS = 90_000;

let healthCache: { at: number; value: BotStatus["sidecar"] } | null = null;
async function cachedSidecarHealth(): Promise<BotStatus["sidecar"]> {
  if (healthCache && Date.now() - healthCache.at < 5_000) return healthCache.value;
  const h = await sidecarHealth(defaultConfig.kronosSidecarUrl);
  healthCache = { at: Date.now(), value: h };
  return h;
}

export async function getStatus(): Promise<StatusPayload> {
  const meta = getMeta<Record<string, unknown>>(db(), "bot");
  const v = meta?.value ?? {};
  const lastSeen = (v.at as string | undefined) ?? meta?.updatedAt ?? null;
  const online = !!lastSeen && v.mode !== "stopped" && Date.now() - Date.parse(lastSeen) < BOT_STALE_MS;
  return {
    bot: {
      online,
      mode: (v.mode as string | undefined) ?? null,
      predictor: (v.predictor as string | undefined) ?? null,
      sampleCount: (v.sampleCount as number | undefined) ?? null,
      lastSeen,
      sidecar: await cachedSidecarHealth(),
    },
    config: readRuntimeConfig(),
    oddsSnapshots: oddsSnapshotCount(db()),
    serverTime: new Date().toISOString(),
  };
}

export function getSignals(): LiveSignal[] {
  const order = new Map(defaultMarkets.map((m, i) => [m.id, i]));
  return latestSignals(db())
    .map((e) => e.payload as LiveSignal | null)
    .filter((s): s is LiveSignal => !!s && typeof s === "object" && "marketId" in s)
    .sort((a, b) => (order.get(a.marketId) ?? 99) - (order.get(b.marketId) ?? 99));
}

export function getSummary(): SummaryPayload {
  const source = readRuntimeConfig().backtestSource;
  return {
    source,
    backtest: dashboardSummary(db(), source),
    paper: { ...tradeStats(db(), BANKROLL), initialBankroll: BANKROLL },
  };
}

function calibration(source: "live" | "backtest" | "backfill"): CalibrationPayload {
  const rows = resolvedSamples(db(), source, { limit: 20_000 });
  const scored: Scored[] = rows.map((r) => ({
    p: r.direction === "UP" ? r.modelProb : 1 - r.modelProb,
    y: r.actualDirection === "UP" ? 1 : 0,
  }));
  // rows are newest-first: compare the older half with the newer half for drift.
  const half = Math.floor(scored.length / 2);
  return {
    source,
    n: scored.length,
    brier: brier(scored),
    logLoss: logLoss(scored),
    bins: reliabilityBins(scored),
    psi: psi(scored.slice(half).map((s) => s.p), scored.slice(0, half).map((s) => s.p)),
  };
}

function lifetime(runs: { id: number; marketId: string; finishedAt: string; totalPnl: number; betsPlaced: number; betsWon: number }[]): MarketLifetime[] {
  return enabledMarkets().map((m) => {
    const mine = runs.filter((r) => r.marketId === m.id);
    let points: EquityPoint[] = buildMarketEquity(mine, m.id, BANKROLL);
    const eq = points.map((p) => p.equity);
    const rets: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = i === 0 ? BANKROLL : points[i - 1]!.equity;
      rets.push(prev > 0 ? (points[i]!.equity - prev) / prev : 0);
    }
    const bets = mine.reduce((a, r) => a + r.betsPlaced, 0);
    const wins = mine.reduce((a, r) => a + r.betsWon, 0);
    if (points.length > 2000) points = lttb(points, 2000);
    return {
      marketId: m.id,
      short: m.short,
      points,
      totalPnl: (eq[eq.length - 1] ?? BANKROLL) - BANKROLL,
      winRate: bets ? wins / bets : 0,
      bets,
      sharpe: sharpe(rets),
      maxDrawdown: maxDrawdown(eq).abs,
      streak: currentStreak(rets),
      runs: mine.length,
    };
  });
}

export function getBacktest(sourceOverride?: BacktestSource): BacktestPayload {
  const source = sourceOverride ?? readRuntimeConfig().backtestSource;
  const d = db();
  const all = recentRunsFor(d, source, 20_000);
  const chrono = [...all].reverse();
  const curve = buildEquityCurve(chrono, BANKROLL);
  const eq = curve.map((p) => p.equity);
  // Sharpe on 5-minute buckets (all markets pooled), matching the lifetime view.
  const buckets = buildMarketEquity(chrono.map((r) => ({ ...r, marketId: "all" })), "all", BANKROLL);
  const rets = buckets.map((p, i) => {
    const prev = i === 0 ? BANKROLL : buckets[i - 1]!.equity;
    return prev > 0 ? (p.equity - prev) / prev : 0;
  });
  const reliabilitySets = all.slice(0, 2000).flatMap((r) => (r.reliabilityBins ? [r.reliabilityBins] : []));
  const sampleCal = calibration(source === "backfill" ? "backfill" : "backtest");
  // Prefer per-sample calibration; fall back to merged per-run bins.
  const cal = sampleCal.n > 0 ? sampleCal : { ...sampleCal, bins: mergeReliabilityBins(reliabilitySets) };

  return {
    source,
    equity: curve.length > 1500 ? lttb(curve, 1500) : curve,
    runPnls: chrono.slice(-120).map((r) => ({ t: Date.parse(r.finishedAt), pnl: r.totalPnl })),
    recent: all.slice(0, 60),
    latest: source === "backfill" ? latestBackfillPerMarket(d) : latestBacktestPerMarket(d),
    aggregate: aggregateFor(d, source),
    lifetime: lifetime(all),
    calibration: cal,
    liveCalibration: calibration("live"),
    skips: skipHistogram(d, source),
    liveSkips: liveSkipHistogram(d),
    strategies: strategyTotals(d, source),
    sharpe: sharpe(rets),
    maxDrawdown: maxDrawdown(eq).abs,
    fingerprint: `${source}:${all[0]?.id ?? 0}:${all.length}`,
  };
}

/** Cheap change-detector so the stream only ships the heavy payload when it moved. */
export function backtestFingerprint(): string {
  const source = readRuntimeConfig().backtestSource;
  const table = source === "backfill" ? "backfill_runs" : "backtest_runs";
  const r = db().prepare(`SELECT MAX(id) AS id, COUNT(*) AS n FROM ${table}`).get() as { id: number | null; n: number };
  const s = db().prepare(`SELECT MAX(id) AS id FROM prediction_samples`).get() as { id: number | null };
  return `${source}:${r.id ?? 0}:${r.n}:${s.id ?? 0}`;
}

export function getTape(): TapePayload {
  return { events: recentEvents(db(), 40), trades: recentTrades(db(), 40) };
}

export function tapeFingerprint(): string {
  const e = db().prepare(`SELECT MAX(id) AS id FROM events`).get() as { id: number | null };
  const t = db().prepare(`SELECT MAX(id) AS id, COUNT(resolved_at) AS r FROM trades`).get() as { id: number | null; r: number };
  return `${e.id ?? 0}:${t.id ?? 0}:${t.r}`;
}
