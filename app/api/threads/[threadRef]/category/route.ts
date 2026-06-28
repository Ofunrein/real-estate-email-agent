import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readInboxCategoriesFromDatabase, upsertAiDraftInDatabase } from "@/lib/database";
import { createRequestAudit } from "@/lib/requestAudit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/threads/[threadRef]/category",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");
  const body = await request.json().catch(() => ({})) as { channel?: string; category?: string };
  const category = String(body.category || "").trim();
  const channel = String(body.channel || "email").trim() || "email";
  if (!category) {
    await audit.write("validate", "failed", { channel, statusCode: 400, errorMessage: "category is required" });
    return NextResponse.json({ ok: false, error: "category is required" }, { status: 400 });
  }
  const categories = databaseEnabled() ? await readInboxCategoriesFromDatabase() : [];
  if (categories.length && !categories.some((item) => item.slug === category)) {
    await audit.write("validate", "failed", {
      channel,
      statusCode: 400,
      errorCode: "unknown_category",
      errorMessage: "Unknown category",
      metadata: { category },
    });
    return NextResponse.json({ ok: false, error: "Unknown category" }, { status: 400 });
  }
  if (!databaseEnabled()) {
    return NextResponse.json({ ok: true, category, persisted: false });
  }
  const draft = await upsertAiDraftInDatabase({
    thread_ref: threadRef,
    channel,
    body: "",
    category_slug: category,
    confidence: 1,
    reason: "Manually categorized in Iris Inbox.",
    next_action: "manual_category",
    safe_to_auto_send: false,
    needs_human: category === "needs_human",
    model: "manual",
    fingerprint: `manual:${category}`,
  });
  await audit.write("category", "sent", {
    channel,
    statusCode: 200,
    metadata: { category, needsHuman: category === "needs_human" },
  });
  return NextResponse.json({ ok: true, category, draft, persisted: true });
}
