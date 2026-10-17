export interface TrackedMarket {
  id: string;
  name: string;
  short: string; // compact label for the dashboard, e.g. "BTC 5M"
  category: "CRYPTO";
  bybitSymbol: string;
  bybitInterval: string; // "5" | "15" | "60"
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
];

export const enabledMarkets = () => defaultMarkets.filter((x) => x.enabled);
export const findMarket = (id: string) => defaultMarkets.find((x) => x.id === id);
