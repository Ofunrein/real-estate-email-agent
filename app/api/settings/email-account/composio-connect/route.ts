import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { createComposioGmailConnectLink } from "@/lib/composioConnection";
import { databaseEnabled } from "@/lib/database";

export const dynamic = "force-dynamic";

function callbackUrl(request: NextRequest): string {
  const base = process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/?emailConnected=composio`;
}

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  if (!databaseEnabled()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required to store connected email state" }, { status: 503 });
  }

  try {
    const link = await createComposioGmailConnectLink({
      userEmail: session.user.email,
      callbackUrl: callbackUrl(request),
    });
    if (!link.redirectUrl) throw new Error("Composio did not return a connect link");
    return NextResponse.redirect(link.redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "composio_connect_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
