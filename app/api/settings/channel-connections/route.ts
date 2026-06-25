import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import {
  dashboardChannelConnectionStatus,
  deleteChannelConnection,
  getChannelConnection,
  listChannelConnections,
  upsertChannelConnection,
  type ChannelConnectionInput,
} from "@/lib/channelConnections";
import { syncComposioSocialConnections } from "@/lib/composioChannelSync";
import { composioEnabled, createComposioClient } from "@/lib/composioConnection";

export const dynamic = "force-dynamic";

function payloadFromBody(body: unknown): ChannelConnectionInput {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const connection = value.connection && typeof value.connection === "object"
    ? value.connection as Record<string, unknown>
    : value;
  return connection as ChannelConnectionInput;
}

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const userEmail = session.user?.email || "";
  const shouldSync = request.nextUrl.searchParams.get("sync") === "1";
  const sync = shouldSync
    ? userEmail
      ? await syncComposioSocialConnections({ userEmail }).catch((error) => ({
        checked: true,
        synced: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      }))
      : { checked: false, synced: 0, errors: ["No signed-in email available for Composio sync."] }
    : { checked: false, synced: 0, errors: [] };
  const status = await dashboardChannelConnectionStatus();
  return NextResponse.json({ ...status, composio_sync: sync });
}

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));

  try {
    const connection = await upsertChannelConnection(payloadFromBody(body));
    return NextResponse.json({ ok: true, connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /DATABASE_URL/.test(message) ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });

  try {
    const connection = await getChannelConnection(id);
    const connectedAccountId = connection?.connected_account_id || "";
    const staleComposioRow = connection?.metadata?.stale_composio_connection === true;
    const sameRemoteStillActive = connectedAccountId
      ? (await listChannelConnections()).connections.some((candidate) =>
        candidate.id !== id
        && candidate.provider === connection?.provider
        && candidate.status === "connected"
        && candidate.connected_account_id === connectedAccountId
      )
      : false;
    if (
      connectedAccountId
      && composioEnabled()
      && connection?.provider?.startsWith("composio")
      && connection.status === "connected"
      && !staleComposioRow
      && !sameRemoteStillActive
    ) {
      try {
        await createComposioClient().connectedAccounts.delete(connectedAccountId);
      } catch (error) {
        console.warn("Composio disconnect failed", error);
        return NextResponse.json({ ok: false, error: "Composio disconnect failed. Try again from Connections." }, { status: 502 });
      }
    }
    const deleted = await deleteChannelConnection(id);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Connection was not found or was already removed." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /DATABASE_URL/.test(message) ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
