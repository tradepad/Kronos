import { NextResponse } from "next/server";
import { defaultMarkets } from "@kronos/core";
import { getSignals } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/** The market registry with live status. */
export async function GET() {
  const signals = new Map(getSignals().map((s) => [s.marketId, s]));
  return NextResponse.json(
    defaultMarkets.map((m) => {
      const s = signals.get(m.id);
      return {
        id: m.id,
        name: m.name,
        short: m.short,
        symbol: m.bybitSymbol,
        horizonMinutes: m.horizonMinutes,
        enabled: m.enabled,
        nextSlug: m.polymarketSlug(new Date()).slug,
        lastSignalAt: s?.decidedAt ?? null,
        lastError: s?.error ?? null,
      };
    }),
  );
}
