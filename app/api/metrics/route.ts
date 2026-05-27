import { NextResponse } from "next/server";

import { loadAgentInboxData } from "@/lib/dataSource";
import { buildMetrics, buildPropertyHealth } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { leads, events, properties } = await loadAgentInboxData();
    const metrics = buildMetrics(leads, events);
    metrics.property_count = properties.length;
    return NextResponse.json({ metrics, propertyHealth: buildPropertyHealth(properties) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
