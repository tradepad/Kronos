import { lookback, type Config } from "../config";
import { clipLower, clipUpper, mean, mulberry32, pctChange, tail } from "../math";
import type { Candle, Prediction } from "../types";
import type { Predictor } from "./types";

/**
 * Momentum + RSI baseline. Zero dependencies, seedable for reproducible
 * tests. Every claim about Kronos adding value is measured against this.
 */
export class HeuristicPredictor implements Predictor {
  readonly name = "heuristic";
  readonly isMock = true;
  private readonly rng: () => number;

  constructor(seed?: number) {
    this.rng = seed === undefined ? Math.random : mulberry32(seed);
  }

  async predict(candles: readonly Candle[], cfg: Config): Promise<Prediction> {
    const t0 = Date.now();
    const ctx = tail(candles, lookback(cfg));
    const closes = ctx.map((c) => c.close);
    const currentClose = closes[closes.length - 1]!;

    const returns = pctChange(closes);
    const momentum = returns.length > 0 ? mean(tail(returns, 10)) : 0;

    const gains = mean(tail(clipLower(returns, 0), 14));
    const losses = mean(tail(clipUpper(returns, 0).map((x) => -x), 14));
    const rs = losses > 0 ? gains / losses : 1;
    const rsi = 100 - 100 / (1 + rs);

    let bias: number;
    if (rsi > 70) bias = 0.35; // overbought → mean revert down
    else if (rsi < 30) bias = 0.65; // oversold → mean revert up
    else bias = 0.5 + momentum * 50; // otherwise follow momentum
    bias = Math.max(0.25, Math.min(0.75, bias));

    let upCount = 0;
    const predictions: number[] = [];
    for (let i = 0; i < cfg.sampleCount; i++) {
      if (this.rng() < bias) upCount++;
      const jitter = (this.rng() - 0.5) * 2 * Math.abs(momentum) * currentClose;
      predictions.push(currentClose * (1 + momentum) + jitter);
    }

    const probUp = upCount / cfg.sampleCount;
    const avgPred = mean(predictions);
    return {
      currentClose,
      predictedCloseAvg: avgPred,
      predictedChangePct: ((avgPred - currentClose) / currentClose) * 100,
      probUp,
      probDown: 1 - probUp,
      direction: probUp >= 0.5 ? "UP" : "DOWN",
      confidence: Math.max(probUp, 1 - probUp),
      sampleCount: cfg.sampleCount,
      allPredictions: predictions,
      predictionSpread: Math.max(...predictions) - Math.min(...predictions),
      mock: true,
      durationMs: Date.now() - t0,
    };
  }
}
