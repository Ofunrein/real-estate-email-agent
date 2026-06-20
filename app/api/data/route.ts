import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { loadAgentInboxData } from "@/lib/dataSource";
import { composeInboxData } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    return NextResponse.json(composeInboxData(leads, events, properties, voiceCalls));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
