import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One paper trade by id. */
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const row = db().prepare(`SELECT * FROM trades WHERE id = ?`).get(id);
  return row ? NextResponse.json(row) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** Order submission is deliberately not implemented. Trades are paper only. */
export async function POST() {
  return NextResponse.json(
    { error: "Live execution is deliberately not part of this build. All trades are simulated and logged only." },
    { status: 403 },
  );
}
