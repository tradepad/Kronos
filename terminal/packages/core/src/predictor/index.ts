import type { Config } from "../config";
import { HeuristicPredictor } from "./heuristic";
import { RemoteKronosPredictor } from "./remote";
import type { Predictor } from "./types";

export * from "./types";
export { HeuristicPredictor } from "./heuristic";
export { RemoteKronosPredictor, sidecarHealth } from "./remote";

/** Build the predictor named in config for a given market horizon. */
export function makePredictor(cfg: Config, opts: { horizonMinutes?: number; seed?: number } = {}): Predictor {
  if (cfg.predictor === "kronos") {
    return new RemoteKronosPredictor({
      baseUrl: cfg.kronosSidecarUrl,
      variant: cfg.modelName,
      horizonMinutes: opts.horizonMinutes ?? 5,
      timeoutMs: cfg.kronosTimeoutMs,
    });
  }
  // "mock" is the heuristic with a fixed seed, for reproducible demos and tests.
  return new HeuristicPredictor(cfg.predictor === "mock" ? (opts.seed ?? 42) : opts.seed);
}
