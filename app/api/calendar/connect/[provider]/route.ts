import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { composioEnabled } from "@/lib/composioConnection";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ provider: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
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
  return NextResponse.json({
    ok: true,
    provider,
    status: "auth_ready",
    message: "Calendar provider connection is routed through backend Composio adapters.",
  });
}
