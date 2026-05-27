import { NextResponse } from "next/server";

import { readSheet } from "@/lib/googleSheets";
import { groupEventsByThread } from "@/lib/inboxData";
import { CONVERSATION_EVENTS_TAB } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await readSheet(CONVERSATION_EVENTS_TAB);
    return NextResponse.json({ events, threads: groupEventsByThread(events) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
