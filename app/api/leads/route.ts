import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readLeads } from "@/lib/dataSource";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    return NextResponse.json({ leads: await readLeads() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
