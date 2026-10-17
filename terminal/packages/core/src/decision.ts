import type { Config } from "./config";
import { calculateKelly } from "./kelly";
import type { Decision, IndicatorSet, PolymarketOdds, Prediction } from "./types";

/**
 * Six sequential gates between a prediction and a bet. Each one records
 * *why* it rejected, so the dashboard can show a skip-reason histogram
 * rather than a mysterious lack of trades.
 */
export function calculateDecision(
  prediction: Prediction,
  marketOdds: PolymarketOdds | null,
  cfg: Config,
  bankroll: number,
  indicators: IndicatorSet | null,
  opts: { shrinkFactor?: number } = {},
): Decision {
  const modelProb = prediction.direction === "UP" ? prediction.probUp : prediction.probDown;

  const decision: Decision = {
    direction: prediction.direction,
    modelProb,
    confidence: prediction.confidence,
    confidenceOk: false,
    oddsOk: false,
    edge: 0,
    edgeOk: false,
    indicatorsOk: false,
    kellyRaw: 0,
    kellyAdjusted: 0,
    betUsd: 0,
    bet: false,
    skipReason: null,
    marketPrice: null,
    payoutRatio: null,
    evPerDollar: null,
    tokenId: null,
    marketId: null,
  };

  // 1. Confidence
  if (prediction.confidence < cfg.minConfidence) {
    decision.skipReason = `Low confidence (${pct(prediction.confidence)} < ${pct(cfg.minConfidence)})`;
    return decision;
  }
  decision.confidenceOk = true;

  // 2. Odds available
  if (!marketOdds || Object.keys(marketOdds.outcomes).length === 0) {
    decision.skipReason = "No Polymarket odds available";
    return decision;
  }
  const outcome = marketOdds.outcomes[prediction.direction];
  if (!outcome) {
    decision.skipReason = `No ${prediction.direction} outcome found`;
    return decision;
  }

  const marketPrice = outcome.yesPrice;
  decision.marketPrice = marketPrice;
  decision.tokenId = outcome.tokenIdYes;
  decision.marketId = outcome.marketId;

  // 3. Odds quality, net of costs
  const payoutRatio = marketPrice > 0 ? 1 / marketPrice : 0;
  decision.payoutRatio = payoutRatio;
  const evPerDollar = modelProb * payoutRatio - 1;
  decision.evPerDollar = evPerDollar;

  // Deduct round-trip cost BEFORE gating, so every threshold downstream
  // is expressed in "EV net of costs" terms.
  const costPerDollar = cfg.roundTripCostBps / 10_000;
  const netEvPerDollar = evPerDollar - costPerDollar;

  if (marketPrice > cfg.maxMarketPrice) {
    decision.skipReason = `Price too high (${pct(marketPrice)} > ${pct(cfg.maxMarketPrice)})`;
    return decision;
  }
  if (payoutRatio < cfg.minPayoutRatio) {
    decision.skipReason = `Payout too thin (${payoutRatio.toFixed(1)}x < ${cfg.minPayoutRatio}x)`;
    return decision;
  }
  if (netEvPerDollar < cfg.minEvPerDollar) {
    decision.skipReason = `EV too low net of costs (${pctSigned(netEvPerDollar)} < ${pct(cfg.minEvPerDollar)})`;
    return decision;
  }
  decision.oddsOk = true;

  // 4. Edge vs market
  const edge = modelProb - marketPrice;
  decision.edge = edge;
  if (edge < cfg.minEdge) {
    decision.skipReason = `Insufficient edge (${pctSigned(edge)} < ${pct(cfg.minEdge)})`;
    return decision;
  }
  decision.edgeOk = true;

  // 5. Indicator confirmation
  if (cfg.requireIndicatorConfirm && indicators && !indicators.confirmed) {
    decision.skipReason = `Indicators disagree (${indicators.agreeing}/${indicators.totalActive})`;
    return decision;
  }
  decision.indicatorsOk = true;

  // 6. Fractional Kelly × correlation shrink, capped
  const kellyRaw = calculateKelly(modelProb, marketPrice);
  const shrink = Math.max(0, Math.min(1, opts.shrinkFactor ?? 1));
  const kellyAdjusted = kellyRaw * cfg.kellyFraction * shrink;
  decision.kellyRaw = kellyRaw;
  decision.kellyAdjusted = kellyAdjusted;

  const betUsd = Math.max(0, Math.min(bankroll * kellyAdjusted, bankroll * cfg.maxBetPct));
  if (betUsd < cfg.minBetUsd) {
    decision.skipReason = `Kelly bet too small ($${betUsd.toFixed(2)} < $${cfg.minBetUsd})`;
    return decision;
  }

  decision.betUsd = Math.round(betUsd * 100) / 100;
  decision.bet = true;
  return decision;
}

/**
 * Collapse a skip reason to its gate name so the histogram groups
 * "Low confidence (52% < 65%)" and "Low confidence (60% < 65%)" together.
 */
export function skipReasonKey(reason: string | null): string {
  if (!reason) return "Bet placed";
  const i = reason.indexOf(" (");
  return i === -1 ? reason : reason.slice(0, i);
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const pctSigned = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
