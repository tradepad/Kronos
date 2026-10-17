import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDataPath } from "./client";
import type { BacktestSource } from "./queries";

/**
 * `data/runtime-config.json` is the shared control surface between the
 * dashboard and the bot. The bot re-reads it at the top of every cycle, so
 * a change in the UI takes effect on the next cycle with no restart.
 */
export interface RuntimeConfig {
  minConfidence: number;
  minEdge: number;
  kellyFraction: number;
  maxBetPct: number;
  paused: boolean;
  /** Which table the dashboard reads its backtest metrics from. */
  backtestSource: BacktestSource;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  minConfidence: 0.65,
  minEdge: 0.05,
  kellyFraction: 0.25,
  maxBetPct: 0.1,
  paused: false,
  backtestSource: "worker",
};

const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function sanitizeRuntimeConfig(cfg: Partial<Record<keyof RuntimeConfig, unknown>>): RuntimeConfig {
  const d = DEFAULT_RUNTIME_CONFIG;
  return {
    minConfidence: num(cfg.minConfidence, 0.5, 1, d.minConfidence),
    minEdge: num(cfg.minEdge, -0.5, 0.5, d.minEdge),
    kellyFraction: num(cfg.kellyFraction, 0, 1, d.kellyFraction),
    maxBetPct: num(cfg.maxBetPct, 0, 1, d.maxBetPct),
    paused: cfg.paused === true || cfg.paused === "true",
    // Never trust an arbitrary string into a table selector.
    backtestSource: cfg.backtestSource === "backfill" ? "backfill" : "worker",
  };
}

export function runtimeConfigPath(): string {
  return resolveDataPath(process.env.KRONOS_RUNTIME_CONFIG ?? "data/runtime-config.json");
}

export function readRuntimeConfig(): RuntimeConfig {
  const path = runtimeConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_RUNTIME_CONFIG };
  try {
    return sanitizeRuntimeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}

/** Atomic write: temp file + rename, so a reader never sees half a file. */
export function writeRuntimeConfig(next: RuntimeConfig): void {
  const path = runtimeConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, path); // atomic on POSIX
}

export function patchRuntimeConfig(patch: Partial<Record<keyof RuntimeConfig, unknown>>): RuntimeConfig {
  const next = sanitizeRuntimeConfig({ ...readRuntimeConfig(), ...patch });
  writeRuntimeConfig(next);
  return next;
}
