import { lookback, type Config } from "../config";
import { tail } from "../math";
import type { Candle, Prediction } from "../types";
import type { Predictor, SidecarHealth } from "./types";

/** HTTP client for the Python Kronos sidecar. Same interface, `isMock = false`. */
export class RemoteKronosPredictor implements Predictor {
  readonly name: string;
  readonly isMock = false;

  private readonly baseUrl: string;
  private readonly variant: "base" | "mini";
  private readonly horizonMinutes: number;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; variant?: "base" | "mini"; horizonMinutes?: number; timeoutMs?: number }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.variant = opts.variant ?? "base";
    this.horizonMinutes = opts.horizonMinutes ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.name = `kronos-${this.variant}`;
  }

  /** Same predictor, different horizon — markets differ in window length. */
  withHorizon(horizonMinutes: number): RemoteKronosPredictor {
    return new RemoteKronosPredictor({
      baseUrl: this.baseUrl,
      variant: this.variant,
      horizonMinutes,
      timeoutMs: this.timeoutMs,
    });
  }

  async predict(candles: readonly Candle[], cfg: Config): Promise<Prediction> {
    // Send only the context window — keeps the POST body ~30 KB at 512 candles.
    const ctx = tail(candles, lookback({ modelName: this.variant }));
    const body = {
      candles: ctx.map((c) => ({
        timestamp: c.timestamp.getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        amount: c.amount,
      })),
      variant: this.variant,
      horizon_minutes: this.horizonMinutes,
      temperature: cfg.temperature,
      top_p: cfg.topP,
      sample_count: cfg.sampleCount,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        throw new Error(
          `Kronos sidecar timed out after ${this.timeoutMs}ms. It may be cold-loading — ` +
            `retry, or fall back to --predictor heuristic.`,
        );
      }
      throw new Error(
        `Kronos sidecar unreachable at ${this.baseUrl}. Start it with ` +
          `./services/kronos-sidecar/run.sh. Underlying: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      throw new Error(`Kronos sidecar HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const d = (await resp.json()) as Record<string, unknown>;
    return {
      currentClose: d.current_close as number,
      predictedCloseAvg: d.predicted_close_avg as number,
      predictedChangePct: d.predicted_change_pct as number,
      probUp: d.prob_up as number,
      probDown: d.prob_down as number,
      direction: d.direction as "UP" | "DOWN",
      confidence: d.confidence as number,
      sampleCount: d.sample_count as number,
      allPredictions: d.predictions as number[],
      predictionSpread: d.prediction_spread as number,
      mock: false,
      durationMs: d.duration_ms as number,
    };
  }

  async health(): Promise<SidecarHealth> {
    return sidecarHealth(this.baseUrl);
  }
}

export async function sidecarHealth(baseUrl: string): Promise<SidecarHealth> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3_000) });
    if (!resp.ok) return { ok: false, loadedVariants: [], error: `HTTP ${resp.status}` };
    const d = (await resp.json()) as { ok: boolean; loaded_variants?: string[]; device?: string };
    return { ok: d.ok, loadedVariants: d.loaded_variants ?? [], device: d.device };
  } catch (err) {
    return { ok: false, loadedVariants: [], error: (err as Error).message };
  }
}
