import { NextRequest, NextResponse } from "next/server";

import { syncSheetsToNeon } from "@/lib/sheetsSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const querySecret = request.nextUrl.searchParams.get("secret") || "";
  return header === `Bearer ${secret}` || querySecret === secret;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncSheetsToNeon();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync Google Sheets to Neon.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
