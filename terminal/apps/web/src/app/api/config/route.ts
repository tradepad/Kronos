import { NextResponse } from "next/server";
import { patchRuntimeConfig, readRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readRuntimeConfig());
}

/** Patch data/runtime-config.json (atomic write). The bot picks it up next cycle. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  return NextResponse.json(patchRuntimeConfig(body as Record<string, unknown>));
}
