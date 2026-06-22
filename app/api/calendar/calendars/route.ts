import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { createCalendar, listCalendars } from "@/lib/calendarOs";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  try {
    const calendars = await listCalendars();
    return NextResponse.json({ ok: true, calendars, settings: calendars });
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
    const calendar = await createCalendar(body);
    return NextResponse.json({ ok: true, calendar });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
