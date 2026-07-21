import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { composioEnabled } from "@/lib/composioConnection";
import { createProviderConnectLink } from "@/lib/providerConnections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  if (!composioEnabled()) {
    return NextResponse.json({ ok: false, error: "COMPOSIO_API_KEY is not configured" }, { status: 503 });
  }

  const base = process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || new URL(request.url).origin;
  const callbackUrl = new URL("/", base);
  callbackUrl.searchParams.set("emailConnected", "outlook");
  try {
    const link = await createProviderConnectLink({
      domain: "calendar",
      provider: "outlook",
      userEmail: session.user.email,
      callbackUrl: callbackUrl.toString(),
    });
    if (!link.redirectUrl) throw new Error("Composio did not return an Outlook connect link");
    return NextResponse.redirect(link.redirectUrl);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "outlook_connect_failed" },
      { status: 503 },
    );
  }
}
