import {
  atr,
  brier,
  calculateDecision,
  computeIndicators,
  defaultStrategies,
  fetchCandles,
  findMarket,
  logLoss,
  lookback,
  makePredictor,
  mulberry32,
  reliabilityBins,
  settleBinary,
  simulatedOdds,
  skipReasonKey,
  slugForWindow,
  tripleBarrier,
  volatilityRegime,
  atrPct,
  type Candle,
  type Config,
  type Decision,
  type Direction,
  type IndicatorSet,
  type Predictor,
  type Prediction,
  type PolymarketOdds,
  type Scored,
  type Strategy,
} from "@kronos/core";
import type { RunInput, SampleInput, StrategyResult } from "@kronos/db";

export interface BacktestOpts {
  cfg: Config;
  marketId: string;
  nWindows: number;
  seed: number;
  /** Pre-fetched candles. When omitted, fetch from the exchange. */
  candles?: readonly Candle[];
  /** Shift the walk-forward start index — lets one candle set yield many runs. */
  startOffset?: number;
  quiet?: boolean;
  predictor?: Predictor;
  strategies?: Strategy[];
  /** "historical" stamps runs with candle time (backfill); "wall" with now (worker). */
  clock?: "wall" | "historical";
}

export interface BacktestResult {
  run: RunInput;
  samples: SampleInput[];
}

/** Volatility gate applied ahead of the six decision gates. */
export function decideWithVolatility(
  prediction: Prediction,
  odds: PolymarketOdds | null,
  cfg: Config,
  bankroll: number,
  indicators: IndicatorSet | null,
  candles: readonly Candle[],
  opts: { shrinkFactor?: number } = {},
): Decision {
  const decision = calculateDecision(prediction, odds, cfg, bankroll, indicators, opts);
  const vol = atrPct(candles, cfg.atrPeriod);
  if (decision.bet && Number.isFinite(vol) && (vol < cfg.minAtrPct || vol > cfg.maxAtrPct)) {
    return {
      ...decision,
      bet: false,
      betUsd: 0,
      skipReason: `Volatility out of range (ATR ${vol.toFixed(3)}% outside ${cfg.minAtrPct}–${cfg.maxAtrPct}%)`,
    };
  }
  return decision;
}

/**
 * Walk-forward backtest. Each window sees only candles up to and including
 * index i; the label compares close[i + h] with close[i]. Two ledgers:
 *   gated — only windows where the decision gates said bet (the STRATEGY)
 *   raw   — a flat $1 on every call, ungated (the MODEL)
 */
export async function runBacktest(opts: BacktestOpts): Promise<BacktestResult> {
  const { cfg, marketId, nWindows, seed } = opts;
  const market = findMarket(marketId);
  if (!market) throw new Error(`Unknown market "${marketId}"`);
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const horizonSteps = Math.max(1, Math.round(market.horizonMinutes / Number(market.bybitInterval)));

  const candles = opts.candles
    ? [...opts.candles]
    : (
        await fetchCandles(cfg, {
          symbol: market.bybitSymbol,
          interval: market.bybitInterval,
          extraCandles: nWindows + horizonSteps,
        })
      ).candles;

  const predictor = opts.predictor ?? makePredictor(cfg, { horizonMinutes: market.horizonMinutes, seed });
  const strategies = opts.strategies ?? defaultStrategies();
  const rng = mulberry32(seed);
  const ctxLen = Math.max(lookback(cfg), 300);
  const startIdx = Math.max(cfg.atrPeriod + 10, lookback(cfg)) + Math.max(0, opts.startOffset ?? 0);

  let bankroll = cfg.initialBankroll;
  let wagered = 0;
  let betsWon = 0;
  let betsLost = 0;
  let skipped = 0;
  const edges: number[] = [];
  const kellys: number[] = [];
  let rawN = 0;
  let rawCorrect = 0;
  let rawPnl = 0;
  const scored: Scored[] = [];
  const samples: SampleInput[] = [];
  const skips: Record<string, number> = {};
  const regimes: Record<string, number> = {};
  const strat: Record<string, StrategyResult & { bankroll: number; streak: number }> = {};
  for (const s of strategies) strat[s.name] = { bets: 0, wins: 0, pnl: 0, wagered: 0, bankroll: cfg.initialBankroll, streak: 0 };

  let firstTs: Date | null = null;
  let lastTs: Date | null = null;
  const cost = cfg.roundTripCostBps;

  for (let w = 0; w < nWindows; w++) {
    const i = startIdx + w;
    if (i + horizonSteps >= candles.length) break;
    const history = candles.slice(Math.max(0, i + 1 - ctxLen), i + 1); // never includes the future
    const now = candles[i]!;
    const future = candles.slice(i + 1, i + 1 + horizonSteps);
    const exitClose = candles[i + horizonSteps]!.close;
    const actual: Direction = exitClose > now.close ? "UP" : "DOWN";
    firstTs ??= now.timestamp;
    lastTs = candles[i + horizonSteps]!.timestamp;

    const pred = await predictor.predict(history, cfg);
    const slug = slugForWindow(market, new Date(now.timestamp.getTime() + Number(market.bybitInterval) * 60_000));
    const odds = simulatedOdds(slug, rng);
    const indicators = computeIndicators(history, pred.direction, cfg);
    const decision = decideWithVolatility(pred, odds, cfg, bankroll, indicators, history);
    const key = skipReasonKey(decision.skipReason);
    skips[key] = (skips[key] ?? 0) + 1;

    // Gated ledger.
    if (decision.bet && decision.marketPrice !== null) {
      const won = decision.direction === actual;
      const pnl = settleBinary(won, decision.betUsd, decision.marketPrice, cost);
      bankroll += pnl;
      wagered += decision.betUsd;
      if (won) betsWon++;
      else betsLost++;
      edges.push(decision.edge);
      kellys.push(decision.kellyAdjusted);
    } else skipped++;

    // Raw ledger — no gates.
    const rawPrice = odds.outcomes[pred.direction]!.yesPrice;
    rawN++;
    if (pred.direction === actual) rawCorrect++;
    rawPnl += settleBinary(pred.direction === actual, 1, rawPrice, cost);

    // Strategy lab — each strategy keeps its own bankroll.
    for (const s of strategies) {
      const st = strat[s.name]!;
      const pick = s.decide({ candles: history, prediction: pred, cfg, odds }, { bankroll: st.bankroll, streak: st.streak });
      if (!pick || pick.stakeUsd <= 0) continue;
      const price = odds.outcomes[pick.direction]!.yesPrice;
      const won = pick.direction === actual;
      const pnl = settleBinary(won, pick.stakeUsd, price, cost);
      st.bets++;
      st.wagered += pick.stakeUsd;
      st.pnl += pnl;
      st.bankroll += pnl;
      if (won) st.wins++;
      st.streak = won ? Math.max(1, st.streak + 1) : Math.min(-1, st.streak - 1);
    }

    const atrSeries = atr(history.slice(-cfg.atrPeriod * 4), cfg.atrPeriod);
    const atrNow = atrSeries[atrSeries.length - 1] ?? NaN;
    const regime = volatilityRegime(history, cfg.atrPeriod);
    regimes[regime] = (regimes[regime] ?? 0) + 1;
    scored.push({ p: pred.probUp, y: actual === "UP" ? 1 : 0 });
    samples.push({
      timestamp: (opts.clock === "historical" ? now.timestamp : new Date()).toISOString(),
      source: opts.clock === "historical" ? "backfill" : "backtest",
      marketId,
      predictorName: predictor.name,
      modelProb: pred.direction === "UP" ? pred.probUp : pred.probDown,
      direction: pred.direction,
      actualDirection: actual,
      tripleBarrierDirection:
        cfg.tripleBarrierEnabled && Number.isFinite(atrNow)
          ? tripleBarrier(now.close, future, atrNow, cfg.tripleBarrierSigma)
          : null,
      actualChangePct: ((exitClose - now.close) / now.close) * 100,
      regime,
      slug,
    });

    if (!opts.quiet && (w + 1) % 5 === 0) {
      process.stdout.write(`\r  ${marketId}  window ${w + 1}/${nWindows}  bankroll $${bankroll.toFixed(2)}   `);
    }
  }
  if (!opts.quiet) process.stdout.write("\n");
  if (rawN === 0) {
    // Never persist an empty run: it would read as "0% accuracy" rather than "no data".
    throw new Error(
      `${marketId}: only ${candles.length} candles, need more than ${startIdx + horizonSteps} for one window`,
    );
  }

  const betsPlaced = betsWon + betsLost;
  const totalPnl = bankroll - cfg.initialBankroll;
  const regime = Object.entries(regimes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const finishedAt = opts.clock === "historical" && lastTs ? lastTs.toISOString() : new Date().toISOString();
  const strategiesOut: Record<string, StrategyResult> = {};
  for (const [k, v] of Object.entries(strat)) strategiesOut[k] = { bets: v.bets, wins: v.wins, pnl: v.pnl, wagered: v.wagered };

  const run: RunInput = {
    startedAt: opts.clock === "historical" && firstTs ? firstTs.toISOString() : startedAt,
    finishedAt,
    marketId,
    marketName: market.name,
    predictorName: predictor.name,
    nWindows: rawN,
    seed,
    startingBankroll: cfg.initialBankroll,
    endingBankroll: bankroll,
    totalPnl,
    totalWagered: wagered,
    betsPlaced,
    betsWon,
    betsLost,
    skipped,
    winRate: betsPlaced ? betsWon / betsPlaced : 0,
    roi: wagered ? totalPnl / wagered : 0,
    avgEdge: edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null,
    avgKelly: kellys.length ? kellys.reduce((a, b) => a + b, 0) / kellys.length : null,
    durationMs: Date.now() - t0,
    rawPredictions: rawN,
    rawCorrect,
    rawAccuracy: rawN ? rawCorrect / rawN : 0,
    rawPnl,
    brier: brier(scored),
    logLoss: logLoss(scored),
    reliabilityBins: scored.length ? reliabilityBins(scored) : null,
    regime,
    variants: { strategies: strategiesOut, skips },
  };
  return { run, samples };
}
