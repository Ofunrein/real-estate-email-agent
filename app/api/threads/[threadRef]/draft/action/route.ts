import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readAiDraftFromDatabase, updateAiDraftStatusInDatabase, upsertAiDraftInDatabase, upsertThreadLinkInDatabase } from "@/lib/database";
import { loadAgentInboxData } from "@/lib/dataSource";
import { sendManualReply } from "@/lib/manualReply";
import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

type DraftActionBody = {
  action: "approve_send" | "save_edit" | "dismiss";
  channel?: string;
  body?: string;
  to?: string;
  subject?: string;
};

function normalizedChannel(value?: string): "email" | "sms" | "whatsapp" {
  const channel = String(value || "email").toLowerCase();
  if (channel === "sms" || channel === "whatsapp") return channel;
  return "email";
}

function eventChannel(event: SheetRow): Channel {
  const channel = String(event.channel || "unknown").toLowerCase();
  if (["email", "sms", "whatsapp", "messenger", "instagram", "voice", "website_chat"].includes(channel)) {
    return channel as Channel;
  }
  return "unknown";
}

function eventConversationKey(event: SheetRow, channel: string): string {
  if (["sms", "whatsapp", "messenger", "instagram", "voice"].includes(channel)) {
    return event.phone || event.thread_ref || event.email || "unknown";
  }
  if (channel === "email") return event.email || event.thread_ref || event.phone || "unknown";
  return event.email || event.phone || event.thread_ref || event.full_name || "unknown";
}

function latestEvent(events: SheetRow[]): SheetRow {
  return events[events.length - 1] || {};
}

function gmailThreadIdForEmail(events: SheetRow[]): string {
  return events
    .map((event) => event.gmail_thread_id || event.thread_ref)
    .find((threadRef) => /^[a-f0-9]{8,}$/i.test(threadRef || "")) || "";
}

function emailSubject(events: SheetRow[], override?: string): string {
  if (override?.trim()) return override.trim();
  const latest = latestEvent(events);
  const summary = String(latest.summary || latest.message_text || "").split("\n").find(Boolean) || "";
  const subjectMatch = summary.match(/subject:\s*(.+)$/i);
  return (subjectMatch?.[1] || summary || "Real estate follow-up").slice(0, 160);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const body = await request.json().catch(() => ({})) as DraftActionBody;
  const channel = normalizedChannel(body.channel);

  if (!["approve_send", "save_edit", "dismiss"].includes(String(body.action))) {
    return NextResponse.json({ ok: false, error: "action must be approve_send, save_edit, or dismiss" }, { status: 400 });
  }

  if (!databaseEnabled()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required for draft actions" }, { status: 503 });
  }

  const existingDraft = await readAiDraftFromDatabase({ threadRef, channel });
  const draftBody = String(body.body ?? existingDraft?.body ?? "").trim();

  if (body.action === "dismiss") {
    await updateAiDraftStatusInDatabase({ threadRef, channel, status: "dismissed" });
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  if (body.action === "save_edit") {
    if (!draftBody) return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });
    const draft = await upsertAiDraftInDatabase({
      thread_ref: threadRef,
      channel,
      body: draftBody,
      category_slug: existingDraft?.category_slug || "needs_reply",
      confidence: existingDraft?.confidence || 0.75,
      reason: existingDraft?.reason || "Edited in human review queue.",
      next_action: existingDraft?.next_action || "review_send",
      safe_to_auto_send: false,
      needs_human: true,
      model: existingDraft?.model || "manual_edit",
      fingerprint: existingDraft?.fingerprint || `manual-edit:${Date.now()}`,
    });
    return NextResponse.json({ ok: true, draft });
  }

  if (!draftBody) return NextResponse.json({ ok: false, error: "No draft body to send" }, { status: 400 });

  const { events } = await loadAgentInboxData();
  const threadEvents = events.filter((event) => eventChannel(event) === channel && eventConversationKey(event, channel) === threadRef);
  const latest = latestEvent(threadEvents);
  const to = String(body.to || (channel === "email" ? latest.email : latest.phone) || "").trim();
  if (!to) return NextResponse.json({ ok: false, error: "No recipient found for this draft" }, { status: 400 });

  const result = await sendManualReply({
    channel,
    to,
    body: draftBody,
    subject: channel === "email" ? emailSubject(threadEvents, body.subject) : undefined,
    threadId: channel === "email" ? gmailThreadIdForEmail(threadEvents) : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: 502 });

  await recordChannelInteraction({
    channel,
    direction: "outbound",
    agentName: "Owner",
    source: "human_review",
    phone: channel !== "email" ? to : undefined,
    email: channel === "email" ? to : undefined,
    threadRef,
    messageText: draftBody,
    status: result.fallbackReason ? "sent_fresh" : "sent",
    mailboxEmail: channel === "email" ? result.mailboxEmail : "",
    gmailThreadId: channel === "email" ? result.gmailThreadId : "",
    gmailMessageId: channel === "email" ? result.gmailMessageId : "",
    threadStatus: channel === "email"
      ? result.threaded ? "current_mailbox_thread" : "sent_fresh_from_current_mailbox"
      : "",
  });

  if (channel === "email") {
    await upsertThreadLinkInDatabase({
      threadRef,
      channel,
      mailboxEmail: result.mailboxEmail,
      gmailThreadId: result.gmailThreadId,
      gmailMessageId: result.gmailMessageId,
      threadStatus: result.threaded ? "current_mailbox_thread" : "sent_fresh_from_current_mailbox",
    });
  }
  await updateAiDraftStatusInDatabase({ threadRef, channel, status: "sent" });

  return NextResponse.json(result);
}
