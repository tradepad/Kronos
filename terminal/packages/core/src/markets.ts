export interface TrackedMarket {
  id: string;
  name: string;
  short: string; // compact label for the dashboard, e.g. "BTC 5M"
  category: "CRYPTO";
  bybitSymbol: string;
  bybitInterval: string; // candle length in minutes: "5" | "15" | "60" | "240" | "1440"
  horizonMinutes: number;
  polymarketSlug: (now: Date) => { slug: string; windowStart: Date; windowStartUnix: number };
  enabled: boolean;
}

/**
 * Generic slug generator for `{symbol}-updown-{N}m-{unix}` markets.
 * Targets the next window to open, and rolls one further if we're within
 * 30s of the boundary — you cannot get filled on a window about to close.
 */
export function makeUpdownSlug(prefix: string, minutes: number): TrackedMarket["polymarketSlug"] {
  return (now) => {
    const ms = minutes * 60 * 1000;
    const boundary = Math.ceil(now.getTime() / ms) * ms;
    let target = new Date(boundary);
    if (target.getTime() - now.getTime() < 30_000) target = new Date(target.getTime() + ms);
    const unix = Math.floor(target.getTime() / 1000);
    return { slug: `${prefix}-${unix}`, windowStart: target, windowStartUnix: unix };
  };
}

/** Slug of an arbitrary window, given its start time. */
export function slugForWindow(market: TrackedMarket, windowStart: Date): string {
  return `${market.id}-${Math.floor(windowStart.getTime() / 1000)}`;
}

const m = (
  id: string,
  name: string,
  short: string,
  symbol: string,
  minutes: number,
  enabled = true,
): TrackedMarket => ({
  id,
  name,
  short,
  category: "CRYPTO",
  bybitSymbol: symbol,
  bybitInterval: String(minutes),
  horizonMinutes: minutes,
  polymarketSlug: makeUpdownSlug(id, minutes),
  enabled,
});

// Adding a market is a one-object edit. Polymarket lists 5m and 15m
// up/down windows; there is no 10m window, so 15m is the next horizon up.
export const defaultMarkets: TrackedMarket[] = [
  m("btc-updown-5m", "BTC 5-Min Up/Down", "BTC 5M", "BTCUSDT", 5),
  m("eth-updown-5m", "ETH 5-Min Up/Down", "ETH 5M", "ETHUSDT", 5),
  m("btc-updown-15m", "BTC 15-Min Up/Down", "BTC 15M", "BTCUSDT", 15),
  m("eth-updown-15m", "ETH 15-Min Up/Down", "ETH 15M", "ETHUSDT", 15),
  m("sol-updown-15m", "SOL 15-Min Up/Down", "SOL 15M", "SOLUSDT", 15, false),
  // Research horizons for backfill and lab only (disabled, so the live desk
  // ignores them). Their slugs are placeholders: Polymarket's hourly and 4h
  // markets use different slug formats and resolution sources.
  m("btc-updown-30m", "BTC 30-Min Up/Down", "BTC 30M", "BTCUSDT", 30, false),
  m("eth-updown-30m", "ETH 30-Min Up/Down", "ETH 30M", "ETHUSDT", 30, false),
  m("btc-updown-1h", "BTC 1-Hour Up/Down", "BTC 1H", "BTCUSDT", 60, false),
  m("eth-updown-1h", "ETH 1-Hour Up/Down", "ETH 1H", "ETHUSDT", 60, false),
  m("btc-updown-4h", "BTC 4-Hour Up/Down", "BTC 4H", "BTCUSDT", 240, false),
  m("eth-updown-4h", "ETH 4-Hour Up/Down", "ETH 4H", "ETHUSDT", 240, false),
  m("btc-updown-1d", "BTC Daily Up/Down", "BTC 1D", "BTCUSDT", 1440, false),
  m("eth-updown-1d", "ETH Daily Up/Down", "ETH 1D", "ETHUSDT", 1440, false),
];

export const enabledMarkets = () => defaultMarkets.filter((x) => x.enabled);
export const findMarket = (id: string) => defaultMarkets.find((x) => x.id === id);
