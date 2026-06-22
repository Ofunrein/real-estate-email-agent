import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { queryAvailability } from "@/lib/calendarOs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  try {
    const slots = await queryAvailability({
      calendarId: body.calendarId,
      from: body.from || body.start,
      to: body.to || body.end,
      durationMinutes: Number(body.durationMinutes || body.duration || 30),
      timezone: body.timezone,
      limit: Number(body.limit || 50),
    });
    return NextResponse.json({ ok: true, slots });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
