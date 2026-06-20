import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readInboxCategoriesFromDatabase, upsertAiDraftInDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const body = await request.json().catch(() => ({})) as { channel?: string; category?: string };
  const category = String(body.category || "").trim();
  const channel = String(body.channel || "email").trim() || "email";
  if (!category) return NextResponse.json({ ok: false, error: "category is required" }, { status: 400 });
  const categories = databaseEnabled() ? await readInboxCategoriesFromDatabase() : [];
  if (categories.length && !categories.some((item) => item.slug === category)) {
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
  return NextResponse.json({ ok: true, category, draft, persisted: true });
}
