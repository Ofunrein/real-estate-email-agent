import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { queryTenantAvailability } from "@/lib/tenantCalendar";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  try {
    const availability = await queryTenantAvailability({
      calendarId: body.calendarId,
      from: body.from || body.start,
      to: body.to || body.end,
      durationMinutes: Number(body.durationMinutes || body.duration || 30),
      timezone: body.timezone,
      limit: Number(body.limit || 50),
    });
    if (!availability.ok) {
      return NextResponse.json({ ok: false, slots: [], reason: availability.reason }, { status: 503 });
    }
    return NextResponse.json({ ok: true, slots: availability.slots, provider: availability.provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
