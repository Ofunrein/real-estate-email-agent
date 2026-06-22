import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { archiveCalendar, updateCalendar } from "@/lib/calendarOs";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<string> {
  return (await context.params).id;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  const calendar = await updateCalendar(await routeId(context), body).catch((error) => {
    throw error;
  });
  if (!calendar) return NextResponse.json({ ok: false, error: "Calendar not found" }, { status: 404 });
  return NextResponse.json({ ok: true, calendar });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const ok = await archiveCalendar(await routeId(context)).catch(() => false);
  if (!ok) return NextResponse.json({ ok: false, error: "Calendar not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
