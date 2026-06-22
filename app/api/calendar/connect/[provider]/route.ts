import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { composioEnabled } from "@/lib/composioConnection";
import { createProviderConnectLink, type ExternalProvider } from "@/lib/providerConnections";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ provider: string }> };

function callbackUrl(request: Request, provider: string): string {
  const base = process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/?tab=calendar&calendarConnected=${encodeURIComponent(provider)}`;
}

async function connect(request: Request, context: RouteContext, redirect: boolean) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const { provider } = await context.params;
  if (!["google", "outlook"].includes(provider)) {
    return NextResponse.json({ ok: false, error: "Unsupported calendar provider" }, { status: 400 });
  }
  if (!composioEnabled()) {
    return NextResponse.json({
      ok: false,
      error: "COMPOSIO_API_KEY is not configured",
      provider,
      status: "disconnected",
    }, { status: 503 });
  }
  const link = await createProviderConnectLink({
    domain: "calendar",
    provider: provider as ExternalProvider,
    userEmail: session.user.email,
    callbackUrl: callbackUrl(request, provider),
  });
  if (!link.redirectUrl) {
    return NextResponse.json({ ok: false, error: "Composio did not return a connect link" }, { status: 502 });
  }
  if (redirect) return NextResponse.redirect(link.redirectUrl);
  return NextResponse.json({ ok: true, provider, status: "auth_ready", ...link });
}

export async function GET(request: Request, context: RouteContext) {
  return connect(request, context, true);
}

export async function POST(request: Request, context: RouteContext) {
  return connect(request, context, false);
}
