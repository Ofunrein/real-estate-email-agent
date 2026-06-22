import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import {
  dashboardChannelConnectionStatus,
  deleteChannelConnection,
  upsertChannelConnection,
  type ChannelConnectionInput,
} from "@/lib/channelConnections";

export const dynamic = "force-dynamic";

function payloadFromBody(body: unknown): ChannelConnectionInput {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const connection = value.connection && typeof value.connection === "object"
    ? value.connection as Record<string, unknown>
    : value;
  return connection as ChannelConnectionInput;
}

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const status = await dashboardChannelConnectionStatus();
  return NextResponse.json(status);
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
    const deleted = await deleteChannelConnection(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /DATABASE_URL/.test(message) ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

