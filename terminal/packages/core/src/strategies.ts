import type { Config } from "./config";
import { atr } from "./indicators";
import { calculateKelly } from "./kelly";
import type { Candle, Direction, PolymarketOdds, Prediction } from "./types";

export interface LabContext {
  candles: readonly Candle[];
  prediction: Prediction;
  cfg: Config;
  odds: PolymarketOdds;
}

export interface LabState {
  bankroll: number;
  streak: number;
}

export interface Strategy {
  name: string;
  description: string;
  decide(ctx: LabContext, state: LabState): { direction: Direction; stakeUsd: number } | null;
}

const flip = (d: Direction): Direction => (d === "UP" ? "DOWN" : "UP");
export const kronosDirection = (ctx: LabContext) => ctx.prediction.direction;
export const winSideProb = (ctx: LabContext) =>
  ctx.prediction.direction === "UP" ? ctx.prediction.probUp : ctx.prediction.probDown;
export const priceFor = (ctx: LabContext, d: Direction) => ctx.odds.outcomes[d]?.yesPrice ?? 0.5;
export const priceForKronosSide = (ctx: LabContext) => priceFor(ctx, ctx.prediction.direction);

export const confidenceGate = (ctx: LabContext, min: number) => ctx.prediction.confidence >= min;
export const edgeGate = (ctx: LabContext, min: number) => winSideProb(ctx) - priceForKronosSide(ctx) >= min;
export const evGate = (ctx: LabContext, minNet: number) =>
  winSideProb(ctx) / priceForKronosSide(ctx) - 1 - ctx.cfg.roundTripCostBps / 10_000 >= minNet;

const kellyStake = (ctx: LabContext, state: LabState, p: number, price: number, cap: number) =>
  Math.max(0, Math.min(state.bankroll * calculateKelly(p, price) * ctx.cfg.kellyFraction, state.bankroll * cap));

/** Five gates, then quarter Kelly with a 3% cap. */
export function selectiveEdgeKelly(): Strategy {
  const MAX_BET_PCT = 0.03;
  const MIN_CONF = 0.7;
  const MIN_EDGE = 0.05;
  const MIN_NET_EV = 0.02;
  const MAGNITUDE_ATR_MULT = 0.6;
  return {
    name: "selective-edge-kelly",
    description: "Conf≥.70 + edge≥5pp + netEV≥2% + magnitude<0.6·ATR + momentum agree.",
    decide: (ctx, state) => {
      if (!confidenceGate(ctx, MIN_CONF)) return null;
      if (!edgeGate(ctx, MIN_EDGE)) return null;
      if (!evGate(ctx, MIN_NET_EV)) return null;
      // Reject implausibly large moves — a forecast bigger than 0.6 ATR is
      // usually the model extrapolating a spike, not signal.
      const atrSeries = atr(ctx.candles.slice(-ctx.cfg.atrPeriod * 4), ctx.cfg.atrPeriod);
      const currentAtr = atrSeries[atrSeries.length - 1];
      const currentPrice = ctx.candles[ctx.candles.length - 1]!.close;
      if (!currentAtr || !Number.isFinite(currentAtr) || currentPrice <= 0) return null;
      const atrPct = (currentAtr / currentPrice) * 100;
      if (Math.abs(ctx.prediction.predictedChangePct) > MAGNITUDE_ATR_MULT * atrPct) return null;
      // Require the last realised candle to agree with the forecast.
      const last = ctx.candles[ctx.candles.length - 1]!;
      const prev = ctx.candles[ctx.candles.length - 2];
      if (!prev) return null;
      if ((last.close >= prev.close ? "UP" : "DOWN") !== ctx.prediction.direction) return null;
      const stake = kellyStake(ctx, state, winSideProb(ctx), priceForKronosSide(ctx), MAX_BET_PCT);
      return stake > 0 ? { direction: kronosDirection(ctx), stakeUsd: stake } : null;
    },
  };
}

/** Bet only when Kronos is at least 75% confident. Flat 2% stake. */
export function highConfidence75(): Strategy {
  return {
    name: "high-confidence-75",
    description: "Follow Kronos only when confidence ≥ 75%. Flat 2% stake.",
    decide: (ctx, state) =>
      confidenceGate(ctx, 0.75) ? { direction: kronosDirection(ctx), stakeUsd: state.bankroll * 0.02 } : null,
  };
}

/** The contrarian twin: fade Kronos when it is at least 75% confident. */
export function fadeConfidence75(): Strategy {
  return {
    name: "fade-confidence-75",
    description: "Bet AGAINST Kronos when confidence ≥ 75%. Flat 2% stake. Research only.",
    decide: (ctx, state) =>
      confidenceGate(ctx, 0.75) ? { direction: flip(kronosDirection(ctx)), stakeUsd: state.bankroll * 0.02 } : null,
  };
}

/** Every window, flat $1 on the model's call. The raw ledger as a strategy. */
export function alwaysFollow(): Strategy {
  return {
    name: "always-follow",
    description: "Flat $1 on every Kronos call, no gates. Measures the model, not a strategy.",
    decide: (ctx) => ({ direction: kronosDirection(ctx), stakeUsd: 1 }),
  };
}

export const defaultStrategies = (): Strategy[] => [
  selectiveEdgeKelly(),
  highConfidence75(),
  fadeConfidence75(),
  alwaysFollow(),
];
