import { NextResponse } from "next/server";
import { defaultConfig, fetchCandles, findMarket } from "@kronos/core";

export const dynamic = "force-dynamic";

/** OHLCV for charting, straight from the exchange (never cached, never invented). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = findMarket(url.searchParams.get("market") ?? "btc-updown-5m");
  if (!market) return NextResponse.json({ error: "unknown market" }, { status: 400 });
  const limit = Math.min(1000, Math.max(10, Number(url.searchParams.get("limit") ?? 120)));
  try {
    const { candles, source } = await fetchCandles(defaultConfig, {
      symbol: market.bybitSymbol,
      interval: market.bybitInterval,
      limit,
    });
    return NextResponse.json({
      market: market.id,
      source,
      candles: candles.map((c) => [c.timestamp.getTime(), c.open, c.high, c.low, c.close, c.volume]),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, candles: [] }, { status: 502 });
  }
}
