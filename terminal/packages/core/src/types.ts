export type Direction = "UP" | "DOWN";

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number; // quote-asset turnover
}

export interface Prediction {
  currentClose: number;
  predictedCloseAvg: number;
  predictedChangePct: number;
  probUp: number;
  probDown: number;
  direction: Direction;
  confidence: number; // max(probUp, probDown)
  sampleCount: number;
  allPredictions: number[];
  predictionSpread: number;
  mock: boolean; // true = heuristic, false = real Kronos
  durationMs?: number;
}

export interface PolymarketOutcome {
  yesPrice: number;
  tokenIdYes: string;
  marketId: string;
}

export interface PolymarketOdds {
  slug: string;
  outcomes: Partial<Record<Direction, PolymarketOutcome>>;
  /** True when the price came from a real Polymarket feed, false when simulated. */
  real: boolean;
}

export interface IndicatorVote {
  name: string;
  vote: Direction | null; // null = neutral / inactive
  value: number | null;
}

export interface IndicatorSet {
  agreeing: number;
  totalActive: number;
  confirmed: boolean;
  votes?: IndicatorVote[];
}

export interface Decision {
  direction: Direction;
  modelProb: number;
  confidence: number;
  confidenceOk: boolean;
  oddsOk: boolean;
  edge: number;
  edgeOk: boolean;
  indicatorsOk: boolean;
  kellyRaw: number;
  kellyAdjusted: number;
  betUsd: number;
  bet: boolean;
  skipReason: string | null;
  marketPrice: number | null;
  payoutRatio: number | null;
  evPerDollar: number | null;
  tokenId: string | null;
  marketId: string | null;
}

/** Compact candle for the wire: [t(ms), open, high, low, close, volume]. */
export type CandleTuple = [number, number, number, number, number, number];

/** One market's live signal, written by the scanner and read by the dashboard. */
export interface LiveSignal {
  marketId: string;
  marketName: string;
  short: string;
  horizonMinutes: number;
  slug: string;
  windowStart: string;
  windowEnd: string;
  decidedAt: string;
  predictorName: string;
  mock: boolean;
  candleSource: string;
  prediction: Prediction | null;
  odds: {
    real: boolean;
    up: number | null;
    down: number | null;
    upMid: number | null;
    downMid: number | null;
    question: string | null;
  } | null;
  decision: Decision | null;
  indicators: IndicatorSet | null;
  atrPct: number | null;
  regime: string | null;
  fundingRate: number | null;
  candles: CandleTuple[];
  bankroll: number;
  paused: boolean;
  error: string | null;
}
