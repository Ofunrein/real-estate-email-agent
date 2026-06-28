import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readEmailAccountsFromDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  const oauthConfigured = Boolean(
    (process.env.GMAIL_OAUTH_CLIENT_ID || process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID)
      && (process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET),
  );
  if (!databaseEnabled()) {
    return NextResponse.json({
      connected: false,
      accounts: [],
      oauth_configured: oauthConfigured,
      database_enabled: false,
    });
  }

  const accounts = await readEmailAccountsFromDatabase();
  return NextResponse.json({
    connected: accounts.some((account) => account.is_default && account.status === "connected"),
    database_enabled: true,
    oauth_configured: oauthConfigured,
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
