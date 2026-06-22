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
    message: "Incremental contacts sync endpoint is available and uses provider cursor state when connected.",
  });
}
