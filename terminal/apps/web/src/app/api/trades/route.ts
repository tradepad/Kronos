import { NextResponse } from "next/server";
import { recentTrades } from "@kronos/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Simulated trade log. */
export async function GET(req: Request) {
  const limit = Math.min(1000, Number(new URL(req.url).searchParams.get("limit") ?? 100));
  return NextResponse.json({ simulated: true, trades: recentTrades(db(), limit) });
}
