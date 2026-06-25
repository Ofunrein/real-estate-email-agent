import { NextRequest, NextResponse } from "next/server";

import { databaseEnabled, readInboxSettingsFromDatabase } from "@/lib/database";
import { processIrisEmailPoll } from "@/lib/irisEmail";
import { irisEmailCronDryRun, irisEmailCronSendReplies } from "@/lib/irisEmailCron";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const querySecret = request.nextUrl.searchParams.get("secret") || "";
  return header === `Bearer ${secret}` || querySecret === secret;
}

function intParam(value: string | null, fallback: number): number {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function pollingEnabled(): boolean {
  return process.env.ENABLE_LEGACY_IRIS_EMAIL_POLLING === "1";
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!pollingEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      channel: "email",
      reason: "Legacy Iris email polling is disabled. Gmail Pub/Sub push is the intended inbound path.",
    });
  }

  const dryRun = irisEmailCronDryRun(request.nextUrl.searchParams);
  const limit = intParam(request.nextUrl.searchParams.get("limit"), 10);

  try {
    const settings = databaseEnabled() ? await readInboxSettingsFromDatabase() : undefined;
    if (settings && !channelEnabled(settings, "email")) {
      return NextResponse.json({ ok: true, skipped: true, channel: "email", reason: "Email channel disabled in inbox settings.", dryRun });
    }
    const sendReplies = irisEmailCronSendReplies(
      request.nextUrl.searchParams,
      !settings || shouldAutoSendForChannel(settings, "email"),
    );
    const result = await processIrisEmailPoll({ dryRun, sendReplies, limit });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run Iris email poll.";
    return NextResponse.json({ ok: false, error: message, dryRun }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
