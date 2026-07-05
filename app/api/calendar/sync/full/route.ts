import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { syncCalendars } from "@/lib/calendarContactsSync";
import { blockLoadTestMutation } from "@/lib/loadTestGuard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const loadTestBlock = blockLoadTestMutation(request);
  if (loadTestBlock) return loadTestBlock;
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const summary = await syncCalendars({ userEmail: session.user.email, syncType: "full" });
  return NextResponse.json({ ok: summary.errors.length === 0, status: "complete", summary });
}
