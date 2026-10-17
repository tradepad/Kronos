import type { Config } from "./config";
import type { Candle, Direction, IndicatorSet, IndicatorVote } from "./types";
import { mean, tail } from "./math";

export function ema(values: readonly number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev: number | undefined;
  for (const v of values) {
    prev = prev === undefined ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder RSI over closes. Returns NaN until enough data. */
export function rsi(closes: readonly number[], period: number): number {
  if (closes.length <= period) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Average True Range series (Wilder smoothing). */
export function atr(candles: readonly Candle[], period: number): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : c.close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const out: number[] = [];
  let prev: number | undefined;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    if (prev === undefined) prev = mean(tr.slice(i - period + 1, i + 1));
    else prev = (prev * (period - 1) + tr[i]!) / period;
    out.push(prev);
  }
  return out;
}

/** Current ATR as a percentage of price. */
export function atrPct(candles: readonly Candle[], period: number): number {
  const series = atr(tail(candles, period * 4), period);
  const a = series[series.length - 1];
  const px = candles[candles.length - 1]?.close ?? 0;
  if (a === undefined || !Number.isFinite(a) || px <= 0) return NaN;
  return (a / px) * 100;
}

/** Session-less rolling VWAP over the last `n` candles. */
export function vwap(candles: readonly Candle[], n = 48): number {
  const ctx = tail(candles, n);
  let pv = 0;
  let v = 0;
  for (const c of ctx) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    v += c.volume;
  }
  return v > 0 ? pv / v : NaN;
}

/**
 * Each indicator casts a vote (or abstains). The prediction is confirmed
 * when at least `minIndicatorsAgreeing` votes match its direction.
 */
export function computeIndicators(
  candles: readonly Candle[],
  direction: Direction,
  cfg: Config,
  extras: { fundingRate?: number | null } = {},
): IndicatorSet {
  const ctx = tail(candles, Math.max(200, cfg.emaSlow * 4));
  const closes = ctx.map((c) => c.close);
  const last = ctx[ctx.length - 1];
  const votes: IndicatorVote[] = [];

  // RSI: mean-reversion read at the extremes, abstain in the middle.
  const r = rsi(closes, cfg.rsiPeriod);
  votes.push({
    name: "RSI",
    value: Number.isFinite(r) ? r : null,
    vote: !Number.isFinite(r) ? null : r <= cfg.rsiOversold ? "UP" : r >= cfg.rsiOverbought ? "DOWN" : null,
  });

  // EMA cross: trend direction.
  const fast = ema(closes, cfg.emaFast).at(-1);
  const slow = ema(closes, cfg.emaSlow).at(-1);
  votes.push({
    name: "EMA",
    value: fast !== undefined && slow !== undefined ? fast - slow : null,
    vote: fast === undefined || slow === undefined || fast === slow ? null : fast > slow ? "UP" : "DOWN",
  });

  // VWAP: price above VWAP is bid, below is offered.
  if (cfg.vwapEnabled && last) {
    const vw = vwap(ctx);
    votes.push({
      name: "VWAP",
      value: Number.isFinite(vw) ? vw : null,
      vote: !Number.isFinite(vw) ? null : last.close > vw ? "UP" : last.close < vw ? "DOWN" : null,
    });
  }

  // Volume spike: a spike confirms the direction of the candle it printed on.
  if (last && ctx.length > 21) {
    const avgVol = mean(ctx.slice(-21, -1).map((c) => c.volume));
    const ratio = avgVol > 0 ? last.volume / avgVol : 0;
    votes.push({
      name: "VOL",
      value: ratio,
      vote: ratio >= cfg.volumeSpikeThreshold ? (last.close >= last.open ? "UP" : "DOWN") : null,
    });
  }

  // Funding: crowded longs (positive funding) lean down, crowded shorts lean up.
  if (cfg.fundingRateEnabled && extras.fundingRate != null && Number.isFinite(extras.fundingRate)) {
    const f = extras.fundingRate;
    votes.push({ name: "FUND", value: f, vote: f > 0.0005 ? "DOWN" : f < -0.0005 ? "UP" : null });
  }

  const active = votes.filter((v) => v.vote !== null);
  const agreeing = active.filter((v) => v.vote === direction).length;
  return {
    agreeing,
    totalActive: active.length,
    confirmed: agreeing >= cfg.minIndicatorsAgreeing,
    votes,
  };
}

export type Regime = "low" | "mid" | "high";

/** Volatility regime: current ATR% relative to its own recent median. */
export function volatilityRegime(candles: readonly Candle[], period: number): Regime {
  const ctx = tail(candles, 300);
  const series = atr(ctx, period);
  const pcts = series
    .map((a, i) => (Number.isFinite(a) && ctx[i]!.close > 0 ? a / ctx[i]!.close : NaN))
    .filter((x) => Number.isFinite(x));
  if (pcts.length < 10) return "mid";
  const sorted = [...pcts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const cur = pcts[pcts.length - 1]!;
  if (cur < median * 0.8) return "low";
  if (cur > median * 1.25) return "high";
  return "mid";
}

/**
 * López de Prado triple-barrier label: whichever of +σ·ATR, −σ·ATR or the
 * horizon close is touched first. When one candle touches both barriers
 * the candle's own close decides.
 */
export function tripleBarrier(
  entry: number,
  future: readonly Candle[],
  atrValue: number,
  sigma: number,
): Direction {
  const up = entry + sigma * atrValue;
  const down = entry - sigma * atrValue;
  for (const c of future) {
    const hitUp = c.high >= up;
    const hitDown = c.low <= down;
    if (hitUp && hitDown) return c.close >= entry ? "UP" : "DOWN";
    if (hitUp) return "UP";
    if (hitDown) return "DOWN";
  }
  const last = future[future.length - 1];
  return last && last.close >= entry ? "UP" : "DOWN";
}
