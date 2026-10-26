import { NextResponse } from "next/server";
import { resolvedSamples } from "@kronos/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Raw resolved predictions for calibration charts. ?source=live|backtest|backfill */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = url.searchParams.get("source");
  const source = s === "live" || s === "backfill" ? s : "backtest";
  const limit = Math.min(20_000, Number(url.searchParams.get("limit") ?? 2000));
  return NextResponse.json({
    source,
    samples: resolvedSamples(db(), source, { limit, marketId: url.searchParams.get("market") ?? undefined }),
  });
}
