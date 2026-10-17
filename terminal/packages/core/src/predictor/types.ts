import type { Config } from "../config";
import type { Candle, Prediction } from "../types";

export interface Predictor {
  readonly name: string; // "heuristic" | "kronos-base" | "kronos-mini"
  readonly isMock: boolean;
  predict(candles: readonly Candle[], cfg: Config): Promise<Prediction>;
}

export interface SidecarHealth {
  ok: boolean;
  loadedVariants: string[];
  device?: string;
  error?: string;
}
