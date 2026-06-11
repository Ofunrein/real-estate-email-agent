import { NextResponse } from "next/server";

import { loadAgentInboxData } from "@/lib/dataSource";
import { composeInboxData } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    return NextResponse.json(composeInboxData(leads, events, properties, voiceCalls));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
