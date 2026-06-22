import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth } from "@/lib/authGuard";
import { pollComposioSocial } from "@/lib/composioSocialPoll";
import { assertWebhookSecret } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

async function authorized(request: NextRequest): Promise<string> {
  if (process.env.CHANNEL_WEBHOOK_SECRET) {
    try {
      assertWebhookSecret(request);
      return process.env.DASHBOARD_ADMIN_EMAIL || process.env.COMPOSIO_INSTAGRAM_USER_EMAIL || "ofunrein123@gmail.com";
    } catch {
      // Fall through to dashboard auth so an operator can run this manually.
    }
  }
  {
    const session = await requireDashboardAuth();
    if (!session?.user?.email) throw new Error("Unauthorized");
    return session.user.email;
  }
}

async function run(request: NextRequest) {
  try {
    const userEmail = await authorized(request);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const channelsParam = request.nextUrl.searchParams.get("channels") || "";
    const channels = Array.isArray(body.channels)
      ? body.channels
      : channelsParam.split(",").map((value) => value.trim()).filter(Boolean);
    const limit = Number(body.limit || request.nextUrl.searchParams.get("limit") || 10);
    const sinceMinutes = Number(body.sinceMinutes || request.nextUrl.searchParams.get("sinceMinutes") || undefined);
    const result = await pollComposioSocial({
      userEmail,
      channels: channels.filter((channel: string) => ["instagram", "messenger"].includes(channel)) as Array<"instagram" | "messenger">,
      limit,
      sinceMinutes,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Unauthorized" || message.includes("secret") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
