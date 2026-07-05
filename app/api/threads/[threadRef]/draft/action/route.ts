import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, readAiDraftFromDatabase, updateAiDraftStatusInDatabase, upsertAiDraftInDatabase, upsertThreadLinkInDatabase } from "@/lib/database";
import { loadAgentInboxData } from "@/lib/dataSource";
import {
  createGmailReplyDraftWithOptions,
  createIrisGmailSession,
  sendGmailDraftWithOptions,
  updateGmailReplyDraftWithOptions,
  type GmailDraftResult,
  type GmailReplyInput,
} from "@/lib/gmailConnection";
import { sendManualReply } from "@/lib/manualReply";
import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";
import { blockLoadTestMutation } from "@/lib/loadTestGuard";

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

async function loadThreadEvents(threadRef: string, channel: string): Promise<SheetRow[]> {
  const { events } = await loadAgentInboxData();
  return events.filter((event) => eventChannel(event) === channel && eventConversationKey(event, channel) === threadRef);
}

function emailDraftInput(
  events: SheetRow[],
  draftBody: string,
  overrides: { to?: string; subject?: string },
): { to: string; input: GmailReplyInput } | null {
  const latest = latestEvent(events);
  const to = String(overrides.to || latest.email || "").trim();
  if (!to) return null;
  return {
    to,
    input: {
      to,
      body: draftBody,
      subject: emailSubject(events, overrides.subject),
      threadId: gmailThreadIdForEmail(events),
    },
  };
}

async function syncGmailDraft(input: {
  existingDraftId?: string;
  events: SheetRow[];
  draftBody: string;
  to?: string;
  subject?: string;
}): Promise<GmailDraftResult | null> {
  const target = emailDraftInput(input.events, input.draftBody, {
    to: input.to,
    subject: input.subject,
  });
  if (!target) return null;
  const session = await createIrisGmailSession();
  const options = {
    mailboxEmail: session.accountEmail,
    fallbackUnthreadedOnMissingThread: true,
  };
  return input.existingDraftId
    ? updateGmailReplyDraftWithOptions(session.gmail, input.existingDraftId, target.input, options)
    : createGmailReplyDraftWithOptions(session.gmail, target.input, options);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const loadTestBlock = blockLoadTestMutation(request);
  if (loadTestBlock) return loadTestBlock;
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
    const threadEvents = channel === "email" ? await loadThreadEvents(threadRef, channel) : [];
    const gmailDraft = channel === "email"
      ? await syncGmailDraft({
        existingDraftId: existingDraft?.gmail_draft_id,
        events: threadEvents,
        draftBody,
        to: body.to,
        subject: body.subject,
      }).catch(() => null)
      : null;
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
      gmail_draft_id: gmailDraft?.draftId || existingDraft?.gmail_draft_id || "",
      gmail_message_id: gmailDraft?.messageId || existingDraft?.gmail_message_id || "",
      gmail_thread_id: gmailDraft?.threadId || existingDraft?.gmail_thread_id || "",
      gmail_mailbox_email: gmailDraft?.mailboxEmail || existingDraft?.gmail_mailbox_email || "",
      gmail_draft_synced_at: gmailDraft?.draftId ? new Date().toISOString() : existingDraft?.gmail_draft_synced_at || "",
    });
    return NextResponse.json({ ok: true, draft });
  }

  if (!draftBody) return NextResponse.json({ ok: false, error: "No draft body to send" }, { status: 400 });

  const threadEvents = await loadThreadEvents(threadRef, channel);
  const latest = latestEvent(threadEvents);
  const to = String(body.to || (channel === "email" ? latest.email : latest.phone) || "").trim();
  if (!to) return NextResponse.json({ ok: false, error: "No recipient found for this draft" }, { status: 400 });

  const result = channel === "email" && existingDraft?.gmail_draft_id
    ? await (async () => {
      const target = emailDraftInput(threadEvents, draftBody, { to, subject: body.subject });
      if (!target) return { ok: false as const, error: "No recipient found for this Gmail draft" };
      const session = await createIrisGmailSession();
      const syncedDraft = await updateGmailReplyDraftWithOptions(session.gmail, existingDraft.gmail_draft_id || "", target.input, {
        mailboxEmail: session.accountEmail,
        fallbackUnthreadedOnMissingThread: true,
      });
      const sent = await sendGmailDraftWithOptions(session.gmail, syncedDraft.draftId, {
        mailboxEmail: session.accountEmail,
      });
      return {
        ok: true as const,
        threaded: sent.threaded,
        mailboxEmail: sent.mailboxEmail,
        fallbackReason: undefined,
        gmailThreadId: sent.threadId,
        gmailMessageId: sent.messageId,
        deliveredBody: draftBody,
        deliveredMediaUrls: [],
        droppedMediaUrls: [],
      };
    })().catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }))
    : await sendManualReply({
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
