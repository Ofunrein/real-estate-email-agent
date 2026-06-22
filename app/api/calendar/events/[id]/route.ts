import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { cancelCalendarAppointment, updateCalendarAppointment } from "@/lib/calendarOs";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<string> {
  return (await context.params).id;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const id = await routeId(context);
  const body = await request.json().catch(() => ({}));
  try {
    const event = await updateCalendarAppointment(id, {
      title: body.title,
      description: body.description,
      start: body.start || body.startTime,
      end: body.end || body.endTime,
      status: body.status,
      locationType: body.locationType,
      locationValue: body.locationValue || body.location,
      notes: body.notes || body.internalNotes,
    });
    if (!event) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
    return NextResponse.json({ ok: true, event, appointment: event });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const id = await routeId(context);
  const ok = await cancelCalendarAppointment(id).catch(() => false);
  if (!ok) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
