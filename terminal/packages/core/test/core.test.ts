import { describe, expect, it } from "vitest";
import {
  brier,
  buildEquityCurve,
  buildMarketEquity,
  calculateDecision,
  calculateKelly,
  currentStreak,
  defaultConfig,
  fitIsotonic,
  HeuristicPredictor,
  logLoss,
  lttb,
  makeUpdownSlug,
  maxDrawdown,
  reliabilityBins,
  settleBinary,
  skipReasonKey,
  tripleBarrier,
  type Candle,
  type Config,
  type IndicatorSet,
  type PolymarketOdds,
  type Prediction,
} from "../src";

const cfg: Config = { ...defaultConfig };

const pred = (probUp: number): Prediction => ({
  currentClose: 100,
  predictedCloseAvg: 100.1,
  predictedChangePct: 0.1,
  probUp,
  probDown: 1 - probUp,
  direction: probUp >= 0.5 ? "UP" : "DOWN",
  confidence: Math.max(probUp, 1 - probUp),
  sampleCount: 20,
  allPredictions: [],
  predictionSpread: 0,
  mock: true,
});

const odds = (up: number): PolymarketOdds => ({
  slug: "btc-updown-5m-1",
  real: false,
  outcomes: {
    UP: { yesPrice: up, tokenIdYes: "u", marketId: "m" },
    DOWN: { yesPrice: 1 - up, tokenIdYes: "d", marketId: "m" },
  },
});

const agree: IndicatorSet = { agreeing: 3, totalActive: 3, confirmed: true };

describe("kelly", () => {
  it("is zero with no edge and never negative", () => {
    expect(calculateKelly(0.5, 0.5)).toBe(0);
    expect(calculateKelly(0.3, 0.5)).toBe(0);
    expect(calculateKelly(0.7, 0)).toBe(0);
  });
  it("matches a hand-computed case", () => {
    // p=0.6 at price 0.4: b = 1.5, f* = (0.6*1.5 - 0.4)/1.5 = 0.3333…
    expect(calculateKelly(0.6, 0.4)).toBeCloseTo(1 / 3, 10);
  });
  it("settles binary bets net of cost", () => {
    expect(settleBinary(true, 10, 0.4, 200)).toBeCloseTo(15 - 0.2, 10);
    expect(settleBinary(false, 10, 0.4, 200)).toBeCloseTo(-10.2, 10);
  });
});

describe("decision gates", () => {
  it("1. rejects low confidence", () => {
    const d = calculateDecision(pred(0.6), odds(0.4), cfg, 100, agree);
    expect(d.bet).toBe(false);
    expect(d.skipReason).toMatch(/^Low confidence/);
  });
  it("2. rejects missing odds", () => {
    const d = calculateDecision(pred(0.8), null, cfg, 100, agree);
    expect(d.skipReason).toBe("No Polymarket odds available");
    const half: PolymarketOdds = { slug: "x", real: true, outcomes: { DOWN: odds(0.4).outcomes.DOWN! } };
    expect(calculateDecision(pred(0.8), half, cfg, 100, agree).skipReason).toBe("No UP outcome found");
  });
  it("3. rejects price too high, thin payout, and low net EV", () => {
    expect(calculateDecision(pred(0.9), odds(0.6), cfg, 100, agree).skipReason).toMatch(/^Price too high/);
    expect(calculateDecision(pred(0.9), odds(0.56), { ...cfg, maxMarketPrice: 0.6 }, 100, agree).skipReason).toMatch(
      /^Payout too thin/,
    );
    expect(calculateDecision(pred(0.66), odds(0.5), { ...cfg, minEvPerDollar: 0.35 }, 100, agree).skipReason).toMatch(/^EV too low net of costs/);
  });
  it("4. rejects insufficient edge", () => {
    const d = calculateDecision(pred(0.7), odds(0.55), { ...cfg, minEvPerDollar: 0, minPayoutRatio: 1.5, minEdge: 0.2 }, 100, agree);
    expect(d.skipReason).toMatch(/^Insufficient edge/);
  });
  it("5. rejects when indicators disagree", () => {
    const d = calculateDecision(pred(0.8), odds(0.45), cfg, 100, { agreeing: 0, totalActive: 3, confirmed: false });
    expect(d.skipReason).toBe("Indicators disagree (0/3)");
  });
  it("6. rejects a Kelly bet below the minimum, else bets", () => {
    expect(calculateDecision(pred(0.8), odds(0.45), cfg, 2, agree).skipReason).toMatch(/^Kelly bet too small/);
    const d = calculateDecision(pred(0.8), odds(0.45), cfg, 100, agree);
    expect(d.bet).toBe(true);
    expect(d.betUsd).toBeGreaterThan(0);
    expect(d.betUsd).toBeLessThanOrEqual(100 * cfg.maxBetPct);
    expect(d.edge).toBeCloseTo(0.35, 10);
  });
  it("shrinks size for correlated positions", () => {
    const full = calculateDecision(pred(0.8), odds(0.45), { ...cfg, maxBetPct: 1 }, 100, agree);
    const half = calculateDecision(pred(0.8), odds(0.45), { ...cfg, maxBetPct: 1 }, 100, agree, { shrinkFactor: 0.5 });
    expect(half.betUsd).toBeCloseTo(full.betUsd / 2, 1);
  });
  it("groups skip reasons by gate", () => {
    expect(skipReasonKey("Low confidence (52% < 65%)")).toBe("Low confidence");
    expect(skipReasonKey(null)).toBe("Bet placed");
  });
});

const series = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 5) * 2 + i * 0.01;
    return { timestamp: new Date(i * 300_000), open: c - 0.1, high: c + 0.3, low: c - 0.3, close: c, volume: 10 + (i % 7), amount: 0 };
  });

describe("heuristic predictor", () => {
  it("is reproducible with a fixed seed", async () => {
    const a = await new HeuristicPredictor(7).predict(series(600), cfg);
    const b = await new HeuristicPredictor(7).predict(series(600), cfg);
    expect(a.probUp).toBe(b.probUp);
    expect(a.allPredictions).toEqual(b.allPredictions);
    expect(a.mock).toBe(true);
  });
});

describe("markets", () => {
  it("targets the next window and rolls when within 30s", () => {
    const slug = makeUpdownSlug("btc-updown-5m", 5);
    const t = Date.UTC(2026, 0, 1, 12, 2, 0);
    expect(slug(new Date(t)).windowStart.getTime()).toBe(Date.UTC(2026, 0, 1, 12, 5, 0));
    const late = slug(new Date(Date.UTC(2026, 0, 1, 12, 4, 45)));
    expect(late.windowStart.getTime()).toBe(Date.UTC(2026, 0, 1, 12, 10, 0));
    expect(late.slug).toBe(`btc-updown-5m-${Date.UTC(2026, 0, 1, 12, 10, 0) / 1000}`);
  });
});

describe("metrics", () => {
  it("scores probabilities", () => {
    expect(brier([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBeCloseTo(0.25);
    expect(logLoss([{ p: 0.5, y: 1 }])).toBeCloseTo(Math.log(2));
    const bins = reliabilityBins([{ p: 0.72, y: 1 }, { p: 0.78, y: 0 }]);
    expect(bins[7]!.count).toBe(2);
    expect(bins[7]!.observed).toBe(0.5);
  });
  it("fits a monotone calibrator", () => {
    const f = fitIsotonic([
      { p: 0.6, y: 0 },
      { p: 0.7, y: 1 },
      { p: 0.8, y: 0 },
      { p: 0.9, y: 1 },
    ]);
    expect(f(0.95)).toBeGreaterThanOrEqual(f(0.65));
  });
  it("builds equity curves, drawdowns and streaks", () => {
    const runs = [
      { id: 1, marketId: "a", finishedAt: "2026-01-01T00:01:00Z", totalPnl: 5 },
      { id: 2, marketId: "a", finishedAt: "2026-01-01T00:02:00Z", totalPnl: -8 },
      { id: 3, marketId: "a", finishedAt: "2026-01-01T03:00:00Z", totalPnl: 2 },
    ];
    const eq = buildEquityCurve(runs, 100);
    expect(eq.map((p) => p.equity)).toEqual([105, 97, 99]);
    expect(maxDrawdown(eq.map((p) => p.equity)).abs).toBe(8);
    const m = buildMarketEquity(runs, "a", 100);
    expect(m).toHaveLength(2); // first two share a 5-minute bucket
    expect(m[1]!.gapBefore).toBe(true);
    expect(currentStreak([1, -1, 2, 3])).toBe(2);
    expect(lttb(Array.from({ length: 5000 }, (_, i) => ({ t: i, equity: Math.sin(i) })), 500)).toHaveLength(500);
  });
  it("labels the triple barrier", () => {
    const fut = [{ timestamp: new Date(0), open: 100, high: 102, low: 99.5, close: 101, volume: 1, amount: 0 }];
    expect(tripleBarrier(100, fut, 1, 1)).toBe("UP");
  });
});
