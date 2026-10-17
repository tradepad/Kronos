import { lookback, type CandleSource, type Config } from "../config";
import type { Candle } from "../types";

export interface FetchOpts {
  symbol?: string;
  interval?: string; // minutes, as a string: "5" | "15" | "60"
  extraCandles?: number;
  signal?: AbortSignal;
  /** Drop the still-forming candle at the end (default true). */
  dropIncomplete?: boolean;
  /** Fetch candles ending at this time instead of now. */
  endTime?: Date;
  /** Exact candle count, overriding the lookback-derived default. */
  limit?: number;
}

export interface CandleResult {
  candles: Candle[];
  source: Exclude<CandleSource, "auto">;
}

const UA = { "user-agent": "kronos-research-terminal/0.1" };

function want(cfg: Config, opts: FetchOpts): number {
  if (opts.limit !== undefined) return opts.limit;
  return lookback(cfg) + cfg.atrPeriod + 10 + (opts.extraCandles ?? 0);
}

function finish(all: Candle[], intervalMin: number, limit: number, opts: FetchOpts): Candle[] {
  // De-duplicate on timestamp, sort oldest-first, drop the forming candle.
  const byTs = new Map<number, Candle>();
  for (const c of all) byTs.set(c.timestamp.getTime(), c);
  let out = [...byTs.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (opts.dropIncomplete !== false) {
    const now = opts.endTime?.getTime() ?? Date.now();
    out = out.filter((c) => c.timestamp.getTime() + intervalMin * 60_000 <= now);
  }
  return out.slice(-limit);
}

/**
 * Bybit v5 returns newest-first and caps at 200 rows per call, so page
 * backwards and re-sort.
 */
export async function fetchBybitCandles(cfg: Config, opts: FetchOpts = {}): Promise<Candle[]> {
  const symbol = opts.symbol ?? cfg.symbol;
  const interval = opts.interval ?? cfg.interval;
  const limit = want(cfg, opts) + 1;

  const all: Candle[] = [];
  let endTime: number | undefined = opts.endTime?.getTime();

  while (all.length < limit) {
    const batch = Math.min(200, limit - all.length);
    const params = new URLSearchParams({ category: "linear", symbol, interval, limit: String(batch) });
    if (endTime !== undefined) params.set("end", String(endTime));

    const resp = await fetch(`${cfg.bybitUrl}?${params}`, { signal: opts.signal, headers: UA });
    if (!resp.ok) throw new Error(`Bybit HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = (await resp.json()) as { retCode: number; retMsg: string; result: { list: string[][] } };
    if (data.retCode !== 0) throw new Error(`Bybit API error: ${data.retMsg}`);

    const rows = data.result.list;
    if (rows.length === 0) break;
    for (const r of rows) {
      all.push({
        timestamp: new Date(Number(r[0])),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        amount: Number(r[6]),
      });
    }
    // Page backwards from the oldest row we just received.
    endTime = Number(rows[rows.length - 1]![0]) - 1;
  }
  return finish(all, Number(interval), limit - 1, opts);
}

/** Binance spot klines: oldest-first, up to 1000 per call. */
export async function fetchBinanceCandles(cfg: Config, opts: FetchOpts = {}): Promise<Candle[]> {
  const symbol = opts.symbol ?? cfg.symbol;
  const interval = opts.interval ?? cfg.interval;
  const limit = want(cfg, opts) + 1;
  const all: Candle[] = [];
  let endTime: number | undefined = opts.endTime?.getTime();
  while (all.length < limit) {
    const batch = Math.min(1000, limit - all.length);
    const params = new URLSearchParams({ symbol, interval: `${interval}m`, limit: String(batch) });
    if (endTime !== undefined) params.set("endTime", String(endTime));
    const resp = await fetch(`https://api.binance.com/api/v3/klines?${params}`, { signal: opts.signal, headers: UA });
    if (!resp.ok) throw new Error(`Binance HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const rows = (await resp.json()) as (string | number)[][];
    if (rows.length === 0) break;
    for (const r of rows) {
      all.push({
        timestamp: new Date(Number(r[0])),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        amount: Number(r[7]),
      });
    }
    endTime = Number(rows[0]![0]) - 1;
  }
  return finish(all, Number(interval), limit - 1, opts);
}

/** Coinbase Exchange candles: newest-first, 300 per call, USD pairs. */
export async function fetchCoinbaseCandles(cfg: Config, opts: FetchOpts = {}): Promise<Candle[]> {
  const symbol = opts.symbol ?? cfg.symbol;
  const interval = Number(opts.interval ?? cfg.interval);
  const product = symbol.replace(/USDT?$/, "") + "-USD";
  const limit = want(cfg, opts) + 1;
  const stepMs = interval * 60_000;
  const all: Candle[] = [];
  let end = opts.endTime?.getTime() ?? Date.now();
  let emptyPages = 0;
  while (all.length < limit && emptyPages < 3) {
    const start = end - 300 * stepMs;
    const params = new URLSearchParams({
      granularity: String(interval * 60),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });
    const resp = await fetch(`https://api.exchange.coinbase.com/products/${product}/candles?${params}`, {
      signal: opts.signal,
      headers: UA,
    });
    if (!resp.ok) throw new Error(`Coinbase HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const rows = (await resp.json()) as number[][];
    if (rows.length === 0) emptyPages++;
    for (const r of rows) {
      const [t, low, high, open, close, volume] = r as [number, number, number, number, number, number];
      all.push({ timestamp: new Date(t * 1000), open, high, low, close, volume, amount: volume * close });
    }
    end = start - 1;
    await new Promise((r) => setTimeout(r, 120)); // public rate limit is ~10 req/s
  }
  return finish(all, interval, limit - 1, opts);
}

const FETCHERS = {
  bybit: fetchBybitCandles,
  binance: fetchBinanceCandles,
  coinbase: fetchCoinbaseCandles,
} as const;

/** Remember which source worked so `auto` doesn't retry dead hosts every cycle. */
let lastGood: CandleResult["source"] | null = null;

/**
 * Fetch candles from the configured source. `auto` tries Bybit, then
 * Binance, then Coinbase — Bybit and Binance refuse some regions (the US
 * among them), and a scanner that silently stops is worse than one that
 * switches feeds and says so.
 */
export async function fetchCandles(cfg: Config, opts: FetchOpts = {}): Promise<CandleResult> {
  if (cfg.candleSource !== "auto") {
    const candles = await FETCHERS[cfg.candleSource](cfg, opts);
    if (candles.length === 0) throw new Error(`${cfg.candleSource} returned no candles for ${opts.symbol ?? cfg.symbol}`);
    return { candles, source: cfg.candleSource };
  }
  const order: CandleResult["source"][] = ["bybit", "binance", "coinbase"];
  if (lastGood) order.sort((a, b) => (a === lastGood ? -1 : b === lastGood ? 1 : 0));
  const errors: string[] = [];
  for (const src of order) {
    try {
      const candles = await FETCHERS[src](cfg, opts);
      if (candles.length > 0) {
        lastGood = src;
        return { candles, source: src };
      }
      errors.push(`${src}: no rows`);
    } catch (err) {
      errors.push(`${src}: ${(err as Error).message}`);
    }
  }
  throw new Error(`All candle sources failed — ${errors.join(" | ")}`);
}

/** Latest perpetual funding rate, best effort. Null when no venue answers. */
export async function fetchFundingRate(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, {
      signal: AbortSignal.timeout(4000),
      headers: UA,
    });
    if (r.ok) {
      const d = (await r.json()) as { retCode: number; result?: { list?: { fundingRate?: string }[] } };
      const f = d.result?.list?.[0]?.fundingRate;
      if (d.retCode === 0 && f !== undefined) return Number(f);
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, {
      signal: AbortSignal.timeout(4000),
      headers: UA,
    });
    if (r.ok) {
      const d = (await r.json()) as { lastFundingRate?: string };
      if (d.lastFundingRate !== undefined) return Number(d.lastFundingRate);
    }
  } catch {
    /* no funding available */
  }
  return null;
}
