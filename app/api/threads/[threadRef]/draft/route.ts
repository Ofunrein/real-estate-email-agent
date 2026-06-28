import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readInboxCategoriesFromDatabase, upsertAiDraftInDatabase } from "@/lib/database";
import { loadAgentInboxData } from "@/lib/dataSource";
import { createGmailReplyDraftWithOptions, createIrisGmailSession } from "@/lib/gmailConnection";
import { runIrisConversationBrain } from "@/lib/irisConversationBrain";
import { type Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

function eventChannel(value?: string): Exclude<Channel, "voice" | "unknown"> {
  const channel = String(value || "email").toLowerCase();
  if (["email", "sms", "whatsapp", "messenger", "instagram", "website_chat"].includes(channel)) {
    return channel as Exclude<Channel, "voice" | "unknown">;
  }
  return "email";
}

function gmailThreadIdForEmail(events: SheetRow[]): string {
  return events
    .map((event) => event.gmail_thread_id || event.thread_ref)
    .find((threadRef) => /^[a-f0-9]{8,}$/i.test(threadRef || "")) || "";
}

function emailSubject(events: SheetRow[]): string {
  const latest = events[events.length - 1] || {};
  const summary = String(latest.summary || latest.message_text || "").split("\n").find(Boolean) || "";
  const subjectMatch = summary.match(/subject:\s*(.+)$/i);
  return (subjectMatch?.[1] || summary || "Real estate follow-up").slice(0, 160);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const body = await request.json().catch(() => ({})) as { channel?: string; latestMessage?: string };
  const { events, properties, leads } = await loadAgentInboxData();
  const threadEvents = events.filter((event) => {
    const key = event.thread_ref || event.email || event.phone || "unknown";
    return key === threadRef || event.email === threadRef || event.phone === threadRef;
  });
  if (!threadEvents.length) {
    return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
  }
  const latest = threadEvents[threadEvents.length - 1];
  const channel = eventChannel(body.channel || latest.channel);
  const lead = leads.find((candidate) =>
    (latest.email && candidate.email === latest.email) ||
    (latest.phone && candidate.phone === latest.phone) ||
    (latest.full_name && candidate.full_name === latest.full_name)
  );
  const categories = databaseEnabled() ? await readInboxCategoriesFromDatabase() : undefined;
  const output = runIrisConversationBrain({
    channel,
    threadRef,
    latestMessage: body.latestMessage || latest.message_text || latest.summary || "",
    events: threadEvents,
    lead,
    properties,
    categories,
  });
  const gmailDraft = channel === "email" && latest.email
    ? await (async () => {
      const session = await createIrisGmailSession();
      return createGmailReplyDraftWithOptions(session.gmail, {
        to: latest.email || "",
        body: output.draft,
        subject: emailSubject(threadEvents),
        threadId: gmailThreadIdForEmail(threadEvents),
      }, {
        mailboxEmail: session.accountEmail,
        fallbackUnthreadedOnMissingThread: true,
      });
    })().catch(() => null)
    : null;
  const draft = databaseEnabled()
    ? await upsertAiDraftInDatabase({
      thread_ref: threadRef,
      channel,
      body: output.draft,
      category_slug: output.category,
      confidence: output.confidence,
      reason: output.reason,
      next_action: output.next_action,
      safe_to_auto_send: output.safe_to_auto_send,
      needs_human: output.needs_human,
      model: process.env.IRIS_RESPOND_MODEL || process.env.THEO_RESPOND_MODEL || process.env.CLAUDE_RESPOND || "claude-sonnet-4-6",
      fingerprint: output.fingerprint,
      gmail_draft_id: gmailDraft?.draftId || "",
      gmail_message_id: gmailDraft?.messageId || "",
      gmail_thread_id: gmailDraft?.threadId || gmailThreadIdForEmail(threadEvents),
      gmail_mailbox_email: gmailDraft?.mailboxEmail || "",
      gmail_draft_synced_at: gmailDraft?.draftId ? new Date().toISOString() : "",
    })
    : {
      thread_ref: threadRef,
      channel,
      body: output.draft,
      category_slug: output.category,
      confidence: output.confidence,
      reason: output.reason,
      next_action: output.next_action,
      safe_to_auto_send: output.safe_to_auto_send,
      needs_human: output.needs_human,
      model: "local",
      status: "draft",
      fingerprint: output.fingerprint,
      gmail_draft_id: gmailDraft?.draftId || "",
      gmail_message_id: gmailDraft?.messageId || "",
      gmail_thread_id: gmailDraft?.threadId || gmailThreadIdForEmail(threadEvents),
      gmail_mailbox_email: gmailDraft?.mailboxEmail || "",
      gmail_draft_synced_at: gmailDraft?.draftId ? new Date().toISOString() : "",
      updated_at: new Date().toISOString(),
    };
  return NextResponse.json({ ok: true, draft, output });
}
