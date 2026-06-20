import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { clientId, databaseEnabled, readInboxSettingsFromDatabase } from "@/lib/database";
import { gmailConnectUrl } from "@/lib/gmailConnection";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  if (!databaseEnabled()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required to store connected Gmail accounts" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({})) as { mode?: string };
  const settings = await readInboxSettingsFromDatabase();
  const mode = body.mode || (settings.auto_send.email ? "autosend" : "draft");
  return NextResponse.json({
    ok: true,
    url: gmailConnectUrl({
      request,
      operatorEmail: session.user.email,
      clientId: clientId(),
      mode,
    }),
  });
}
