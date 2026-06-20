import { NextRequest, NextResponse } from "next/server";

import { planCadenceQueue, leadIdentity, type LeadWithEvents } from "@/lib/cadenceQueue";
import { clientConfig } from "@/lib/clientConfig";
import { readEventsFromDatabase, readLeadsFromDatabase } from "@/lib/database";
import type { SheetRow } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const querySecret = request.nextUrl.searchParams.get("secret") || "";
  return header === `Bearer ${secret}` || querySecret === secret;
}
function eventKeys(event: SheetRow): string[] {
  return [leadIdentity({ phone: event.phone }), leadIdentity({ email: event.email }), leadIdentity({ full_name: event.full_name })]
    .filter(Boolean);
}

function leadsWithEvents(leads: SheetRow[], events: SheetRow[]): LeadWithEvents[] {
  const byIdentity = new Map<string, SheetRow[]>();
  for (const event of events) {
    for (const key of eventKeys(event)) {
      const bucket = byIdentity.get(key);
      if (bucket) bucket.push(event);
      else byIdentity.set(key, [event]);
    }
  }

  return leads.map((lead) => {
    const seen = new Set<SheetRow>();
    const matched: SheetRow[] = [];
    for (const key of eventKeys(lead)) {
      for (const event of byIdentity.get(key) || []) {
        if (seen.has(event)) continue;
        seen.add(event);
        matched.push(event);
      }
    }
    return { lead, events: matched };
  });
}

async function plan() {
  const config = clientConfig();
  const [leads, events] = await Promise.all([readLeadsFromDatabase(), readEventsFromDatabase()]);
  const queue = planCadenceQueue({
    leads: leadsWithEvents(leads, events),
    config: config.cadence,
    nowMs: Date.now(),
    timezone: process.env.CALENDAR_TIMEZONE || "America/Chicago",
  });
  return {
    client_id: config.clientId,
    generated_at: queue.generatedAt,
    task_count: queue.tasks.length,
    skipped_count: queue.skipped.length,
    tasks: queue.tasks,
    skipped: queue.skipped,
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required" }, { status: 503 });
  }

  try {
    return NextResponse.json({ ok: true, result: await plan() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to plan Iris cadence queue.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
