import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readEvents } from "@/lib/dataSource";
import { groupEventsByThread } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

const CONVERSATIONS_CACHE = {
  headers: {
    "Cache-Control": "private, max-age=5, stale-while-revalidate=15",
  },
};

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const events = await readEvents();
    return NextResponse.json({ events, threads: groupEventsByThread(events) }, CONVERSATIONS_CACHE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
