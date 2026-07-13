import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readReplyJobByDedupeKeyFromDatabase, upsertReplyJobInDatabase } from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { isReplyJobReplayable } from "@/lib/irisReplyDelivery";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  const body = await request.json().catch(() => null) as { dedupeKey?: string } | null;
  const dedupeKey = String(body?.dedupeKey || "").trim();
  if (!dedupeKey) return NextResponse.json({ ok: false, error: "dedupeKey is required" }, { status: 400 });

  const job = await readReplyJobByDedupeKeyFromDatabase(dedupeKey);
  if (!job) return NextResponse.json({ ok: false, error: "Reply job not found" }, { status: 404 });
  if (!isReplyJobReplayable(job.status || "")) {
    return NextResponse.json({ ok: false, error: `Reply job status ${job.status} cannot be retried` }, { status: 409 });
  }

  await upsertReplyJobInDatabase({
    dedupeKey,
    channel: job.channel,
    provider: job.provider,
    threadRef: job.threadRef,
    contactRef: job.contactRef,
    status: "ready_to_send",
    error: "",
    nextAction: "retry_send",
    metadata: { replayRequestedAt: new Date().toISOString(), replayRequestedBy: session.user?.email || "operator" },
  });
  await inngest.send({ name: "message.reply.send", data: { dedupeKey } });
  return NextResponse.json({ ok: true, queued: true, dedupeKey }, { status: 202 });
}
