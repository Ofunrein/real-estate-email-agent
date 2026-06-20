import { NextRequest, NextResponse } from "next/server";

import { loadAgentInboxData } from "@/lib/dataSource";
import { clientId, databaseEnabled } from "@/lib/database";
import { composeInboxData } from "@/lib/inboxData";
import { assertWebhookSecret } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertWebhookSecret(request);

    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    const data = composeInboxData(leads, events, properties, voiceCalls);

    return NextResponse.json({
      ok: true,
      database_enabled: databaseEnabled(),
      client_id: clientId(),
      raw: {
        leads: leads.length,
        events: events.length,
        properties: properties.length,
        voice_calls: voiceCalls.length,
      },
      composed: {
        leads: data.leads.length,
        events: data.events.length,
        properties: data.properties.length,
        voice_calls: data.voiceCalls.length,
        voice_metric: data.metrics.channels.voice || 0,
      },
      first_voice_thread: data.voiceCalls[0]?.thread_ref || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnostics failed.";
    const status = message.includes("secret") ? 401 : 503;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
