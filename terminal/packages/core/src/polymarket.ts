import { clamp, gaussian } from "./math";
import type { Direction, PolymarketOdds } from "./types";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

export interface RealOddsDetail extends PolymarketOdds {
  /** Mid price per side, when the order book answered. */
  mid: Partial<Record<Direction, number>>;
  /** Best ask per side — what a buyer actually pays. */
  ask: Partial<Record<Direction, number>>;
  closed: boolean;
  question: string | null;
  endDate: string | null;
}

const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const x = JSON.parse(v);
      return Array.isArray(x) ? x.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const toDirection = (label: string): Direction | null => {
  const l = label.trim().toLowerCase();
  if (l === "up" || l === "yes" || l === "higher") return "UP";
  if (l === "down" || l === "no" || l === "lower") return "DOWN";
  return null;
};

async function getJson(url: string, timeoutMs = 5000): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

async function bestAsk(tokenId: string): Promise<{ ask: number | null; mid: number | null }> {
  try {
    const book = (await getJson(`${CLOB}/book?token_id=${tokenId}`)) as {
      asks?: { price: string }[];
      bids?: { price: string }[];
    };
    const asks = (book.asks ?? []).map((a) => Number(a.price)).filter((p) => p > 0 && p < 1);
    const bids = (book.bids ?? []).map((b) => Number(b.price)).filter((p) => p > 0 && p < 1);
    const ask = asks.length ? Math.min(...asks) : null;
    const bid = bids.length ? Math.max(...bids) : null;
    return { ask, mid: ask !== null && bid !== null ? (ask + bid) / 2 : null };
  } catch {
    return { ask: null, mid: null };
  }
}

/**
 * Real odds for one up/down window, from Polymarket's public Gamma API
 * plus the CLOB order book. Returns null when the market isn't listed.
 * Read-only: nothing here can place an order.
 */
export async function fetchPolymarketOdds(slug: string): Promise<RealOddsDetail | null> {
  let market: Record<string, unknown> | undefined;
  try {
    const events = (await getJson(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`)) as {
      markets?: Record<string, unknown>[];
    }[];
    market = events?.[0]?.markets?.[0];
    if (!market) {
      const markets = (await getJson(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`)) as Record<string, unknown>[];
      market = markets?.[0];
    }
  } catch {
    return null;
  }
  if (!market) return null;

  const labels = parseList(market.outcomes);
  const prices = parseList(market.outcomePrices).map(Number);
  const tokens = parseList(market.clobTokenIds);
  const marketId = String(market.id ?? market.conditionId ?? slug);

  const odds: RealOddsDetail = {
    slug,
    outcomes: {},
    real: true,
    mid: {},
    ask: {},
    closed: Boolean(market.closed),
    question: typeof market.question === "string" ? market.question : null,
    endDate: typeof market.endDate === "string" ? market.endDate : null,
  };

  await Promise.all(
    labels.map(async (label, i) => {
      const dir = toDirection(label);
      if (!dir) return;
      const tokenId = tokens[i] ?? "";
      const book = tokenId ? await bestAsk(tokenId) : { ask: null, mid: null };
      const gammaPx = prices[i];
      // Price what you would actually pay: the best ask, else the mid, else Gamma's last.
      const px = book.ask ?? book.mid ?? (gammaPx !== undefined && Number.isFinite(gammaPx) ? gammaPx : null);
      if (px === null || px <= 0 || px >= 1) return;
      odds.outcomes[dir] = { yesPrice: px, tokenIdYes: tokenId, marketId };
      if (book.ask !== null) odds.ask[dir] = book.ask;
      if (book.mid !== null) odds.mid[dir] = book.mid;
      else if (gammaPx !== undefined) odds.mid[dir] = gammaPx;
    }),
  );
  return odds;
}

/**
 * STAND-IN, NOT REAL DATA.
 *
 * Polymarket does not publish a free historical order book for these
 * 5-minute markets. We simulate a price near 0.50 with Gaussian noise.
 * This assumes the market is unbiased and that our fill is at the mid.
 * Every PnL number derived from it is an upper bound, not a forecast.
 */
export function simulatedPolymarketPrice(rng: () => number, sigma = 0.04, lo = 0.35, hi = 0.65): number {
  return clamp(0.5 + gaussian(rng) * sigma, lo, hi);
}

/** A full simulated two-sided book for one window. */
export function simulatedOdds(slug: string, rng: () => number): PolymarketOdds {
  const up = simulatedPolymarketPrice(rng);
  return {
    slug,
    real: false,
    outcomes: {
      UP: { yesPrice: up, tokenIdYes: "sim-up", marketId: "simulated" },
      DOWN: { yesPrice: 1 - up, tokenIdYes: "sim-down", marketId: "simulated" },
    },
  };
}
