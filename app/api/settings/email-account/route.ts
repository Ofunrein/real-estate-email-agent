import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readEmailAccountsFromDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  const legacyConfigured = Boolean(
    process.env.GMAIL_TOKEN_JSON
      || process.env.GMAIL_TOKEN_PATH
      || process.env.GMAIL_CREDENTIALS_JSON,
  );
  if (!databaseEnabled()) {
    return NextResponse.json({
      connected: false,
      accounts: [],
      legacy_configured: legacyConfigured,
      database_enabled: false,
    });
  }

  const accounts = await readEmailAccountsFromDatabase();
  return NextResponse.json({
    connected: accounts.some((account) => account.is_default && account.status === "connected"),
    database_enabled: true,
    legacy_configured: legacyConfigured,
    accounts: accounts.map((account) => ({
      email: account.email,
      display_name: account.display_name,
      provider: account.provider,
      is_default: account.is_default,
      status: account.status,
      connected_by: account.connected_by,
      last_error: account.last_error,
      last_used_at: account.last_used_at,
      updated_at: account.updated_at,
      scopes: account.scopes,
    })),
  });
}
