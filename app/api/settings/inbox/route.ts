import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import {
  databaseEnabled,
  readInboxCategoriesFromDatabase,
  readInboxSettingsFromDatabase,
  upsertInboxCategoriesInDatabase,
  upsertInboxSettingsInDatabase,
} from "@/lib/database";
import { DEFAULT_INBOX_CATEGORIES, DEFAULT_INBOX_SETTINGS } from "@/lib/inboxSettings";
import { syncInboxCategoriesWithGmail } from "@/lib/irisEmail";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  if (!databaseEnabled()) {
    return NextResponse.json({
      settings: DEFAULT_INBOX_SETTINGS,
      categories: DEFAULT_INBOX_CATEGORIES,
      database_enabled: false,
    });
  }
  const [settings, categories] = await Promise.all([
    readInboxSettingsFromDatabase(),
    readInboxCategoriesFromDatabase(),
  ]);
  return NextResponse.json({ settings, categories, database_enabled: true });
}

export async function PATCH(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({})) as {
    settings?: Parameters<typeof upsertInboxSettingsInDatabase>[0];
    categories?: Parameters<typeof upsertInboxCategoriesInDatabase>[0];
  };
  if (!databaseEnabled()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required to save inbox settings" }, { status: 503 });
  }
  const [settings, savedCategories] = await Promise.all([
    body.settings ? upsertInboxSettingsInDatabase(body.settings) : readInboxSettingsFromDatabase(),
    body.categories ? upsertInboxCategoriesInDatabase(body.categories) : readInboxCategoriesFromDatabase(),
  ]);
  let categories = savedCategories;
  let gmail_label_sync_error = "";
  if (body.categories) {
    try {
      categories = await syncInboxCategoriesWithGmail(savedCategories);
    } catch (error) {
      gmail_label_sync_error = error instanceof Error ? error.message : String(error);
    }
  }
  return NextResponse.json({ ok: true, settings, categories, gmail_label_sync_error });
}
