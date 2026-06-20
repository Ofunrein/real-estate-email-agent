import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readProperties } from "@/lib/dataSource";
import { buildPropertyHealth } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const properties = await readProperties();
    return NextResponse.json({ properties, propertyHealth: buildPropertyHealth(properties) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
