import { describe, expect, it } from "vitest";
import { defaultConfig, HeuristicPredictor, type Candle } from "@kronos/core";
import { runBacktest } from "../src/backtest";

// Synthetic random walk — a fixture for plumbing tests, never shown as market data.
function walk(n: number, seed = 3): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let px = 60_000;
  return Array.from({ length: n }, (_, i) => {
    const o = px;
    px *= 1 + (rnd() - 0.5) * 0.004;
    return {
      timestamp: new Date(1_760_000_000_000 + i * 300_000),
      open: o,
      high: Math.max(o, px) * 1.0005,
      low: Math.min(o, px) * 0.9995,
      close: px,
      volume: 50 + rnd() * 50,
      amount: 0,
    };
  });
}

describe("walk-forward backtest", () => {
  it("keeps both ledgers and never peeks", async () => {
    const cfg = { ...defaultConfig, predictor: "heuristic" as const, sampleCount: 5, minConfidence: 0.55, minEdge: 0.02 };
    const candles = walk(700);
    const seen: number[] = [];
    const predictor = new HeuristicPredictor(1);
    const spy = {
      name: "spy",
      isMock: true,
      predict: async (h: readonly Candle[], c: typeof cfg) => {
        seen.push(h[h.length - 1]!.timestamp.getTime());
        return predictor.predict(h, c);
      },
    };
    const res = await runBacktest({ cfg, marketId: "btc-updown-5m", nWindows: 40, seed: 9, candles, quiet: true, predictor: spy });
    expect(res.run.rawPredictions).toBe(40);
    expect(res.samples).toHaveLength(40);
    expect(res.run.betsPlaced + res.run.skipped).toBe(40);
    // The last candle the model sees is candle i, and the label is candle i+1.
    expect(seen[0]).toBe(candles[512]!.timestamp.getTime());
    expect(res.run.rawAccuracy).toBeGreaterThanOrEqual(0);
    expect(res.run.variants?.strategies["always-follow"]?.bets).toBe(40);
    const skipTotal = Object.values(res.run.variants!.skips).reduce((a, b) => a + b, 0);
    expect(skipTotal).toBe(40);
  });

  it("shifts with startOffset so one candle set yields many runs", async () => {
    const cfg = { ...defaultConfig, predictor: "heuristic" as const, sampleCount: 3 };
    const candles = walk(700);
    const a = await runBacktest({ cfg, marketId: "btc-updown-5m", nWindows: 10, seed: 1, candles, startOffset: 0, quiet: true, clock: "historical" });
    const b = await runBacktest({ cfg, marketId: "btc-updown-5m", nWindows: 10, seed: 1, candles, startOffset: 50, quiet: true, clock: "historical" });
    expect(Date.parse(b.run.finishedAt) - Date.parse(a.run.finishedAt)).toBe(50 * 300_000);
  });
});
