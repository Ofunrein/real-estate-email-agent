import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { updateCalendar } from "@/lib/calendarOs";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ calendarId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  const { calendarId } = await context.params;
  const calendar = await updateCalendar(calendarId, body);
  if (!calendar) return NextResponse.json({ ok: false, error: "Calendar not found" }, { status: 404 });
  return NextResponse.json({ ok: true, calendar });
}
