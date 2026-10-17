import { defaultConfig, type Config } from "@kronos/core";
import { readRuntimeConfig } from "@kronos/db";

export type Args = Record<string, string | boolean>;

/** Minimal `--flag value` / `--flag` parser. No dependency, no surprises. */
export function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

export const str = (a: Args, k: string, d: string): string => (typeof a[k] === "string" ? (a[k] as string) : d);
export const num = (a: Args, k: string, d: number): number => {
  const v = a[k];
  if (typeof v !== "string") return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${k} expects a number, got "${v}"`);
  return n;
};
export const flag = (a: Args, k: string): boolean => a[k] === true || a[k] === "true";

/**
 * Build the effective config: defaults ← runtime-config.json ← CLI flags.
 * CLI flags win, so an explicit `--min-confidence` is never silently undone
 * by the dashboard. Call again each cycle to pick up dashboard edits.
 */
export function buildConfig(a: Args, opts: { useRuntime?: boolean } = {}): Config {
  const cfg: Config = { ...defaultConfig };
  if (opts.useRuntime !== false) {
    const rt = readRuntimeConfig();
    cfg.minConfidence = rt.minConfidence;
    cfg.minEdge = rt.minEdge;
    cfg.kellyFraction = rt.kellyFraction;
    cfg.maxBetPct = rt.maxBetPct;
  }
  const p = str(a, "predictor", cfg.predictor);
  if (p !== "kronos" && p !== "heuristic" && p !== "mock") throw new Error(`--predictor must be kronos | heuristic | mock`);
  cfg.predictor = p;
  const m = str(a, "model", cfg.modelName);
  if (m !== "base" && m !== "mini") throw new Error(`--model must be base | mini`);
  cfg.modelName = m;
  cfg.sampleCount = num(a, "samples", cfg.sampleCount);
  cfg.temperature = num(a, "temperature", cfg.temperature);
  cfg.topP = num(a, "top-p", cfg.topP);
  cfg.minConfidence = num(a, "min-confidence", cfg.minConfidence);
  cfg.minEdge = num(a, "min-edge", cfg.minEdge);
  cfg.kellyFraction = num(a, "kelly-fraction", cfg.kellyFraction);
  cfg.maxBetPct = num(a, "max-bet-pct", cfg.maxBetPct);
  cfg.initialBankroll = num(a, "bankroll", cfg.initialBankroll);
  const src = str(a, "candles", cfg.candleSource);
  if (!["auto", "bybit", "binance", "coinbase"].includes(src)) throw new Error(`--candles must be auto | bybit | binance | coinbase`);
  cfg.candleSource = src as Config["candleSource"];
  if (typeof a["sidecar"] === "string") cfg.kronosSidecarUrl = a["sidecar"] as string;
  return cfg;
}

export const log = (...xs: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...xs);
