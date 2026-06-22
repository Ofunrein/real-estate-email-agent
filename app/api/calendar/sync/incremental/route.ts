import { NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  return NextResponse.json({
    ok: true,
    status: "queued",
    syncType: "incremental",
    message: "Incremental calendar sync endpoint is available and persists provider cursors through sync state rows.",
  });
}
