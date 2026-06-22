import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { createCalendarAppointment, listCalendarEvents } from "@/lib/calendarOs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const params = request.nextUrl.searchParams;
  try {
    const events = await listCalendarEvents({
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      calendarId: params.get("calendarId") || undefined,
      contactId: params.get("contactId") || undefined,
      limit: Number(params.get("limit") || 200),
    });
    return NextResponse.json({ ok: true, events, appointments: events });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: /DATABASE_URL|relation/.test(message) ? 503 : 400 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  try {
    const event = await createCalendarAppointment({
      title: body.title,
      description: body.description,
      start: body.start || body.startTime || body.scheduled_at,
      end: body.end || body.endTime,
      timezone: body.timezone,
      calendarId: body.calendarId,
      calendarGroupId: body.calendarGroupId,
      assignedUserId: body.assignedUserId,
      contactId: body.contactId,
      contact: body.contact,
      status: body.status,
      source: body.source || "manual",
      locationType: body.locationType,
      locationValue: body.locationValue || body.location,
      propertyAddress: body.propertyAddress,
      notes: body.notes || body.internalNotes,
    });
    return NextResponse.json({ ok: true, event, appointment: event });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: /conflict/i.test(message) ? 409 : 400 });
  }
}
