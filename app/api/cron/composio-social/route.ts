import { NextRequest, NextResponse } from "next/server";

import { pollComposioSocial } from "@/lib/composioSocialPoll";

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

function pollUserEmail(): string {
  return (
    process.env.DASHBOARD_ADMIN_EMAIL ||
    process.env.COMPOSIO_INSTAGRAM_USER_EMAIL ||
    process.env.COMPOSIO_FACEBOOK_USER_EMAIL ||
    "ofunrein123@gmail.com"
  );
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const channelsParam = request.nextUrl.searchParams.get("channels") || "";
  const channels = channelsParam
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is "instagram" | "messenger" => ["instagram", "messenger"].includes(value));

  try {
    const result = await pollComposioSocial({
      userEmail: pollUserEmail(),
      channels: channels.length ? channels : ["instagram", "messenger"],
      limit: Math.max(1, Math.min(intParam(request.nextUrl.searchParams.get("limit"), 25), 50)),
      sinceMinutes: Math.max(1, Math.min(intParam(request.nextUrl.searchParams.get("sinceMinutes"), 30), 60 * 24)),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run Composio social poll.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
