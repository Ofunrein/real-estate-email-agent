import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { createComposioConnectLink, type ComposioConnectChannel } from "@/lib/composioConnection";

export const dynamic = "force-dynamic";

const ALLOWED = new Set<ComposioConnectChannel>(["instagram", "facebook", "whatsapp"]);

function callbackUrl(request: NextRequest, channel: ComposioConnectChannel): string {
  const base = process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/?composioConnected=${encodeURIComponent(channel)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();

  const { channel: rawChannel } = await params;
  const channel = rawChannel.toLowerCase() as ComposioConnectChannel;
  if (!ALLOWED.has(channel)) {
    return NextResponse.json({ ok: false, error: "Unsupported Composio channel" }, { status: 400 });
  }

  try {
    const link = await createComposioConnectLink({
      channel,
      userEmail: session.user.email,
      callbackUrl: callbackUrl(request, channel),
    });
    if (!link.redirectUrl) throw new Error("Composio did not return a connect link");
    return NextResponse.redirect(link.redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "composio_connect_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
