import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import {
  disconnectProviderConnection,
  listProviderConnections,
  reconcileComposioProviderConnections,
} from "@/lib/providerConnections";
import { tenantCalendarConnectionStatus } from "@/lib/tenantCalendar";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  for (const provider of ["google", "outlook"] as const) {
    await reconcileComposioProviderConnections({
      domain: "calendar",
      provider,
      userEmail: session.user.email,
    }).catch(() => []);
  }
  const connections = await listProviderConnections({ domain: "calendar" });
  const status = await tenantCalendarConnectionStatus();
  return NextResponse.json({
    ok: true,
    connection: status,
    status,
    connections: connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider.includes("outlook") ? "outlook" : "google",
      displayName: connection.display_name,
      email: connection.email,
      status: connection.status,
      lastSyncAt: connection.last_sync_at,
      lastError: connection.last_error,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  const queryId = request.nextUrl.searchParams.get("id") || "";
  const id = (typeof body.id === "string" ? body.id : queryId).trim();
  if (!id) return NextResponse.json({ ok: false, error: "Connection id is required" }, { status: 400 });
  try {
    const disconnected = await disconnectProviderConnection(id);
    if (!disconnected) return NextResponse.json({ ok: false, error: "Connection not found" }, { status: 404 });
    return NextResponse.json({ ok: true, status: "disconnected" });
  } catch {
    return NextResponse.json({ ok: false, error: "Calendar provider disconnect failed" }, { status: 502 });
  }
}
