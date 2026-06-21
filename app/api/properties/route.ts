import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readProperties } from "@/lib/dataSource";
import { buildPropertyHealth } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

const PROPERTY_CACHE = {
  headers: {
    "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
  },
};

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const properties = await readProperties();
    return NextResponse.json({ properties, propertyHealth: buildPropertyHealth(properties) }, PROPERTY_CACHE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
