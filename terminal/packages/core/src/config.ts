export type CandleSource = "auto" | "bybit" | "binance" | "coinbase";

export interface Config {
  bybitUrl: string;
  /** Where candles come from. "auto" tries Bybit, then Binance, then Coinbase. */
  candleSource: CandleSource;
  symbol: string;
  interval: string;

  predictor: "heuristic" | "mock" | "kronos";
  modelName: "base" | "mini";
  temperature: number;
  topP: number;
  sampleCount: number;
  kronosSidecarUrl: string;
  kronosTimeoutMs: number;

  minConfidence: number;
  minEdge: number;
  minAtrPct: number;
  maxAtrPct: number;

  minPayoutRatio: number;
  maxMarketPrice: number;
  minEvPerDollar: number;
  roundTripCostBps: number;

  tripleBarrierEnabled: boolean;
  tripleBarrierSigma: number;

  requireIndicatorConfirm: boolean;
  minIndicatorsAgreeing: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  vwapEnabled: boolean;
  fundingRateEnabled: boolean;
  volumeSpikeThreshold: number;

  atrPeriod: number;

  kellyFraction: number;
  minBetUsd: number;
  maxBetPct: number;

  initialBankroll: number;
  dbPath: string;
}

const env = (k: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[k] : undefined;

export const defaultConfig: Config = {
  bybitUrl: "https://api.bybit.com/v5/market/kline",
  candleSource: (env("KRONOS_CANDLE_SOURCE") as CandleSource | undefined) ?? "auto",
  symbol: "BTCUSDT",
  interval: "5",

  predictor: "kronos",
  modelName: "base",
  temperature: 1.0,
  topP: 0.9,
  sampleCount: 20,
  kronosSidecarUrl: env("KRONOS_SIDECAR_URL") ?? "http://127.0.0.1:5005",
  kronosTimeoutMs: 60_000,

  minConfidence: 0.65,
  minEdge: 0.05,
  minAtrPct: 0.015,
  maxAtrPct: 0.5,

  minPayoutRatio: 1.8,
  maxMarketPrice: 0.55,
  minEvPerDollar: 0.15,
  roundTripCostBps: 200, // 2% round-trip: Polymarket fees + spread

  tripleBarrierEnabled: true,
  tripleBarrierSigma: 1.0,

  requireIndicatorConfirm: true,
  minIndicatorsAgreeing: 2,
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 65,
  emaFast: 9,
  emaSlow: 21,
  vwapEnabled: true,
  fundingRateEnabled: true,
  volumeSpikeThreshold: 1.5,

  atrPeriod: 14,

  kellyFraction: 0.25, // quarter Kelly
  minBetUsd: 1.0,
  maxBetPct: 0.1,

  initialBankroll: 100.0,
  dbPath: env("KRONOS_DB_PATH") ?? "data/kronos.sqlite",
};

/** How many candles to feed the predictor. Driven by the tokenizer's context. */
export function lookback(cfg: Pick<Config, "modelName">): number {
  return cfg.modelName === "mini" ? 2048 : 512;
}
