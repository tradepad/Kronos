import { NextResponse } from "next/server";
import { getBacktest } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/** Latest + aggregate + recent runs, from the table runtime-config.json selects. */
export async function GET() {
  return NextResponse.json(getBacktest());
}
