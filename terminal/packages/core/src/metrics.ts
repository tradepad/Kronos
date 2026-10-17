import { mean, stdev } from "./math";

/** A labelled probabilistic forecast: p = probability of UP, y = 1 if UP happened. */
export interface Scored {
  p: number;
  y: 0 | 1;
}

/** Mean squared error of the probability. 0.25 = always guessing 0.5. */
export function brier(xs: readonly Scored[]): number | null {
  if (xs.length === 0) return null;
  return mean(xs.map(({ p, y }) => (p - y) ** 2));
}

/** Punishes confident errors far harder than Brier — the Kelly bettor's metric. */
export function logLoss(xs: readonly Scored[]): number | null {
  if (xs.length === 0) return null;
  const eps = 1e-6;
  return -mean(
    xs.map(({ p, y }) => {
      const q = Math.min(1 - eps, Math.max(eps, p));
      return y * Math.log(q) + (1 - y) * Math.log(1 - q);
    }),
  );
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanPred: number | null;
  observed: number | null;
}

/** 10-bin reliability diagram: predicted vs observed frequency. */
export function reliabilityBins(xs: readonly Scored[], nBins = 10): ReliabilityBin[] {
  const bins: { ps: number[]; ys: number[] }[] = Array.from({ length: nBins }, () => ({ ps: [], ys: [] }));
  for (const { p, y } of xs) {
    const i = Math.min(nBins - 1, Math.max(0, Math.floor(p * nBins)));
    bins[i]!.ps.push(p);
    bins[i]!.ys.push(y);
  }
  return bins.map((b, i) => ({
    lo: i / nBins,
    hi: (i + 1) / nBins,
    count: b.ps.length,
    meanPred: b.ps.length ? mean(b.ps) : null,
    observed: b.ys.length ? mean(b.ys) : null,
  }));
}

/** Merge per-run reliability bins (as stored in the DB) into one diagram. */
export function mergeReliabilityBins(sets: readonly ReliabilityBin[][], nBins = 10): ReliabilityBin[] {
  const acc = Array.from({ length: nBins }, (_, i) => ({ lo: i / nBins, hi: (i + 1) / nBins, n: 0, sp: 0, so: 0 }));
  for (const set of sets) {
    for (const b of set) {
      const i = Math.min(nBins - 1, Math.max(0, Math.round(b.lo * nBins)));
      if (!b.count || b.meanPred === null || b.observed === null) continue;
      acc[i]!.n += b.count;
      acc[i]!.sp += b.meanPred * b.count;
      acc[i]!.so += b.observed * b.count;
    }
  }
  return acc.map((a) => ({
    lo: a.lo,
    hi: a.hi,
    count: a.n,
    meanPred: a.n ? a.sp / a.n : null,
    observed: a.n ? a.so / a.n : null,
  }));
}

/** Annualization for 5-minute periods: 288 per day × 365. */
export const PERIODS_PER_YEAR_5M = 288 * 365;

/**
 * Sharpe of a return series. Directional only on small, overlapping samples,
 * and null below `minPeriods` — a handful of buckets annualizes into nonsense.
 */
export function sharpe(returns: readonly number[], periodsPerYear = PERIODS_PER_YEAR_5M, minPeriods = 30): number | null {
  if (returns.length < Math.max(2, minPeriods)) return null;
  const s = stdev(returns);
  if (s === 0) return null;
  return (mean(returns) / s) * Math.sqrt(periodsPerYear);
}

/** Largest peak-to-trough decline, in the same units as the series. */
export function maxDrawdown(equity: readonly number[]): { abs: number; pct: number; peakIdx: number; troughIdx: number } {
  let peak = -Infinity;
  let peakIdx = 0;
  let best = { abs: 0, pct: 0, peakIdx: 0, troughIdx: 0 };
  equity.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = peak - v;
    if (dd > best.abs) best = { abs: dd, pct: peak > 0 ? dd / peak : 0, peakIdx, troughIdx: i };
  });
  return best;
}

/** Current win/loss streak: +n for n wins in a row, -n for losses. */
export function currentStreak(pnls: readonly number[]): number {
  let streak = 0;
  for (let i = pnls.length - 1; i >= 0; i--) {
    const p = pnls[i]!;
    if (p === 0) continue;
    if (streak === 0) streak = p > 0 ? 1 : -1;
    else if (p > 0 && streak > 0) streak++;
    else if (p < 0 && streak < 0) streak--;
    else break;
  }
  return streak;
}

/** Population Stability Index between two probability samples. > 0.2 = drift. */
export function psi(expected: readonly number[], actual: readonly number[], nBins = 10): number | null {
  if (expected.length < 20 || actual.length < 20) return null;
  const hist = (xs: readonly number[]) => {
    const h = new Array(nBins).fill(0) as number[];
    for (const x of xs) h[Math.min(nBins - 1, Math.max(0, Math.floor(x * nBins)))]!++;
    return h.map((c) => Math.max(c / xs.length, 1e-4));
  };
  const e = hist(expected);
  const a = hist(actual);
  return e.reduce((s, ei, i) => s + (a[i]! - ei) * Math.log(a[i]! / ei), 0);
}

/**
 * Isotonic regression by pool-adjacent-violators: a monotonic map from raw
 * model probability to observed frequency. Fit on out-of-sample data only.
 */
export function fitIsotonic(xs: readonly Scored[]): (p: number) => number {
  if (xs.length === 0) return (p) => p;
  const sorted = [...xs].sort((a, b) => a.p - b.p);
  const blocks: { x: number; y: number; w: number }[] = [];
  for (const s of sorted) {
    blocks.push({ x: s.p, y: s.y, w: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.y > blocks[blocks.length - 1]!.y) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      const w = a.w + b.w;
      blocks.push({ x: (a.x * a.w + b.x * b.w) / w, y: (a.y * a.w + b.y * b.w) / w, w });
    }
  }
  return (p: number) => {
    if (p <= blocks[0]!.x) return blocks[0]!.y;
    for (let i = 1; i < blocks.length; i++) {
      const a = blocks[i - 1]!;
      const b = blocks[i]!;
      if (p <= b.x) return a.y + ((p - a.x) / (b.x - a.x || 1)) * (b.y - a.y);
    }
    return blocks[blocks.length - 1]!.y;
  };
}

// ---------------------------------------------------------------------------
// Equity curves
// ---------------------------------------------------------------------------

export interface EquityPoint {
  t: number; // epoch ms
  equity: number; // bankroll after this run
  pnl: number; // cumulative pnl
  runId: number;
  /** True when the gap before this point is a stretch with no data. */
  gapBefore?: boolean;
}

export interface RunLike {
  id: number;
  marketId: string;
  finishedAt: string;
  totalPnl: number;
}

export function buildEquityCurve(runs: readonly RunLike[], startingBankroll = 100): EquityPoint[] {
  const sorted = [...runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
  let equity = startingBankroll;
  return sorted.map((r) => {
    equity += r.totalPnl;
    return { t: Date.parse(r.finishedAt), equity, pnl: equity - startingBankroll, runId: r.id };
  });
}

export const BUCKET_MS = 5 * 60 * 1000;

/**
 * Per-market equity resampled to fixed 5-minute buckets. Gaps (bot stopped)
 * are flagged rather than interpolated — interpolation invents equity.
 */
export function buildMarketEquity(runs: readonly RunLike[], marketId: string, startingBankroll = 100): EquityPoint[] {
  const buckets = new Map<number, number>();
  for (const r of runs) {
    if (r.marketId !== marketId) continue;
    const bucket = Math.floor(Date.parse(r.finishedAt) / BUCKET_MS) * BUCKET_MS;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + r.totalPnl);
  }
  let equity = startingBankroll;
  let prevT: number | null = null;
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, pnl]) => {
      equity += pnl;
      const gapBefore = prevT !== null && t - prevT > BUCKET_MS * 6; // > 30 min with nothing
      prevT = t;
      return { t, equity, pnl: equity - startingBankroll, runId: 0, gapBefore };
    });
}

/** Largest-Triangle-Three-Buckets downsampling for long series. */
export function lttb<T extends { t: number; equity: number }>(data: readonly T[], threshold: number): T[] {
  if (threshold >= data.length || threshold < 3) return [...data];
  const sampled: T[] = [data[0]!];
  const every = (data.length - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * every) + 1, data.length);
    let avgX = 0;
    let avgY = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += data[j]!.t;
      avgY += data[j]!.equity;
    }
    const n = Math.max(1, avgEnd - avgStart);
    avgX /= n;
    avgY /= n;
    const rangeStart = Math.floor(i * every) + 1;
    const rangeEnd = Math.floor((i + 1) * every) + 1;
    let maxArea = -1;
    let next = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (data[a]!.t - avgX) * (data[j]!.equity - data[a]!.equity) - (data[a]!.t - data[j]!.t) * (avgY - data[a]!.equity),
      );
      if (area > maxArea) {
        maxArea = area;
        next = j;
      }
    }
    sampled.push(data[next]!);
    a = next;
  }
  sampled.push(data[data.length - 1]!);
  return sampled;
}
