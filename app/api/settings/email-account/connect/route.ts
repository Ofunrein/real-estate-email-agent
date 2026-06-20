import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { clientId, databaseEnabled } from "@/lib/database";
import { gmailConnectUrl } from "@/lib/gmailConnection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  if (!databaseEnabled()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required to store connected Gmail accounts" }, { status: 503 });
  }

  const url = gmailConnectUrl({
    request,
    operatorEmail: session.user.email,
    clientId: clientId(),
    mode: request.nextUrl.searchParams.get("mode") || "",
  });
  return NextResponse.redirect(url);
}
