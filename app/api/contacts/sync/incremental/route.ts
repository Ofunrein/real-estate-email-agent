import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { syncContacts } from "@/lib/calendarContactsSync";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const summary = await syncContacts({ userEmail: session.user.email, syncType: "incremental" });
  return NextResponse.json({ ok: summary.errors.length === 0, status: "complete", summary });
}
