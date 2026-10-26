import { NextResponse } from "next/server";
import { getSignals, getSummary } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/** Current prediction + decision for each market, plus the paper bankroll. */
export async function GET() {
  const summary = getSummary();
  return NextResponse.json({ signals: getSignals(), bankroll: summary.paper.bankroll, paper: summary.paper });
}
