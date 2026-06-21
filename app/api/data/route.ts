import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { loadAgentInboxData } from "@/lib/dataSource";
import {
  databaseEnabled,
  readActiveAiDraftsFromDatabase,
  readDefaultEmailAccountFromDatabase,
  readInboxCategoriesFromDatabase,
  readInboxSettingsFromDatabase,
} from "@/lib/database";
import { emailCapabilitiesForScopes } from "@/lib/gmailConnection";
import { composeInboxData } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

const LIVE_DASHBOARD_CACHE = {
  headers: {
    "Cache-Control": "private, max-age=5, stale-while-revalidate=10",
  },
};

export async function GET() {
  const session = await requireDashboardAuth();

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    if (!databaseEnabled()) {
      return NextResponse.json(composeInboxData(leads, events, properties, voiceCalls), LIVE_DASHBOARD_CACHE);
    }
    const [inboxCategories, inboxSettings, drafts, defaultEmailAccount] = await Promise.all([
      readInboxCategoriesFromDatabase(),
      readInboxSettingsFromDatabase(),
      readActiveAiDraftsFromDatabase(),
      readDefaultEmailAccountFromDatabase(),
    ]);
    return NextResponse.json(composeInboxData(leads, events, properties, voiceCalls, {
      inboxCategories,
      inboxSettings,
      drafts,
      emailCapabilities: emailCapabilitiesForScopes(defaultEmailAccount?.scopes || []),
    }), LIVE_DASHBOARD_CACHE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
