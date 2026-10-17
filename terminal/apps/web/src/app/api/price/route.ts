import { NextResponse } from "next/server";
import { fetchPolymarketOdds, findMarket } from "@kronos/core";

export const dynamic = "force-dynamic";

/** Real Polymarket odds for a market's next window (read-only, public API). */
export async function GET(req: Request) {
  const market = findMarket(new URL(req.url).searchParams.get("market") ?? "btc-updown-5m");
  if (!market) return NextResponse.json({ error: "unknown market" }, { status: 400 });
  const { slug, windowStart } = market.polymarketSlug(new Date());
  const odds = await fetchPolymarketOdds(slug).catch(() => null);
  return NextResponse.json({ market: market.id, slug, windowStart: windowStart.toISOString(), odds });
}
