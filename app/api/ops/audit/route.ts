import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readRequestAuditEvents, readSocialFallbackHealth, summarizeRequestAuditCosts } from "@/lib/requestAudit";
import { listFailedReplyJobsInDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

function boolParam(value: string | null): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  const params = request.nextUrl.searchParams;
  const events = await readRequestAuditEvents({
    channel: params.get("channel") || undefined,
    threadRef: params.get("threadRef") || undefined,
    outcome: params.get("outcome") || undefined,
    errorsOnly: boolParam(params.get("errorsOnly")),
    requestId: params.get("requestId") || undefined,
    since: params.get("since") || undefined,
    limit: Number(params.get("limit") || "100"),
  });
  const [health, failedReplyJobs] = await Promise.all([
    readSocialFallbackHealth(),
    listFailedReplyJobsInDatabase(25),
  ]);
  return NextResponse.json({ ok: true, events, summary: summarizeRequestAuditCosts(events), health, failedReplyJobs });
}
