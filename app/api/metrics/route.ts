import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { loadAgentInboxData } from "@/lib/dataSource";
import { buildMetrics, buildPropertyHealth } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

const METRICS_CACHE = {
  headers: {
    "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
  },
};

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const { leads, events, properties } = await loadAgentInboxData();
    const metrics = buildMetrics(leads, events);
    metrics.property_count = properties.length;
    return NextResponse.json({ metrics, propertyHealth: buildPropertyHealth(properties) }, METRICS_CACHE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
