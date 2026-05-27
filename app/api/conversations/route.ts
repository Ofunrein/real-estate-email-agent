import { NextResponse } from "next/server";

import { readEvents } from "@/lib/dataSource";
import { groupEventsByThread } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await readEvents();
    return NextResponse.json({ events, threads: groupEventsByThread(events) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
