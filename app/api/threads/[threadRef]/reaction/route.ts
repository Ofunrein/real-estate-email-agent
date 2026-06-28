import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { recordChannelInteraction } from "@/lib/channelIngest";
import { listChannelConnections } from "@/lib/channelConnections";
import { databaseEnabled, readEventsForThreadOrContactFromDatabase } from "@/lib/database";
import { resolvePageAccessToken, sendMetaSocialReaction, type MetaSocialChannel } from "@/lib/metaSocial";
import { createRequestAudit } from "@/lib/requestAudit";
import type { SheetRow } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

type ReactionBody = {
  channel: "instagram" | "messenger";
  to: string;
  messageId: string;
  reaction?: string;
  action?: "react" | "unreact";
};

const ALLOWED_REACTIONS = new Set(["love", "like", "laugh", "wow", "sad", "angry"]);

function metadataStringValue(value: unknown, keys: string[]): string {
  if (!value) return "";
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return "";
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const record = parsed as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

const INSTAGRAM_SEND_TARGET_KEYS = [
  "igScopedUserId",
  "ig_scoped_user_id",
  "scopedUserId",
  "scoped_user_id",
  "senderInstagramId",
  "sender_instagram_id",
  "senderId",
  "sender_id",
  "contactId",
  "contact_id",
];

const MESSENGER_SEND_TARGET_KEYS = ["senderId", "sender_id", "contactId", "contact_id"];
const BROWSER_IMPORT_SEND_TARGET_KEYS = [
  "metaWebhookRecipientId",
  "meta_webhook_recipient_id",
  "igScopedUserId",
  "ig_scoped_user_id",
  "scopedUserId",
  "scoped_user_id",
  "contactId",
  "contact_id",
  "instagramUserId",
  "instagram_user_id",
  "senderId",
  "sender_id",
];

function socialSendTargetKeys(channel: MetaSocialChannel): string[] {
  return channel === "instagram" ? INSTAGRAM_SEND_TARGET_KEYS : MESSENGER_SEND_TARGET_KEYS;
}

function isBrowserImportedSocialEvent(event: SheetRow): boolean {
  const source = String(event.source || "").toLowerCase();
  const metadataSource = metadataStringValue(event.provider_metadata, ["source"]).toLowerCase();
  return source.includes("browser_backfill") || metadataSource.includes("browser_backfill");
}

function isBrowserVerifiedSocialEvent(event: SheetRow): boolean {
  if (!isBrowserImportedSocialEvent(event)) return false;
  const status = String(event.status || event.thread_status || "").toLowerCase();
  const metadataSource = metadataStringValue(event.provider_metadata, ["source"]).toLowerCase();
  return status.includes("browser_backfill_verified_recipient") || metadataSource.includes("authenticated_browser");
}

function addCandidate(candidates: Set<string>, value: unknown) {
  const clean = String(value || "").trim();
  if (clean) candidates.add(clean);
}

function normalizeTarget(value: string) {
  return value.trim();
}

function socialReplyTarget(threadRef: string, channel: MetaSocialChannel, events: SheetRow[]): string {
  let verifiedBrowserTarget = "";
  let sawBrowserImport = false;
  let sawNonBrowserImport = false;
  for (const event of [...events].reverse()) {
    if (isBrowserImportedSocialEvent(event)) {
      sawBrowserImport = true;
      if (!verifiedBrowserTarget && isBrowserVerifiedSocialEvent(event)) {
        verifiedBrowserTarget = metadataStringValue(event.provider_metadata, BROWSER_IMPORT_SEND_TARGET_KEYS);
      }
      continue;
    }
    sawNonBrowserImport = true;
    const metadataTarget = metadataStringValue(event.provider_metadata, socialSendTargetKeys(channel));
    if (metadataTarget) return metadataTarget;
    if (event.direction !== "inbound") continue;
    const direct = String(event.phone || "").trim();
    if (direct) return direct;
    const eventThreadRef = String(event.thread_ref || "").trim();
    if (eventThreadRef.startsWith(`${channel}:`)) {
      const stripped = eventThreadRef.slice(channel.length + 1).trim();
      if (stripped) return stripped;
    }
  }
  if (verifiedBrowserTarget) return verifiedBrowserTarget;
  if (sawBrowserImport && !sawNonBrowserImport) return "";
  if (threadRef.startsWith(`${channel}:`)) return threadRef.slice(channel.length + 1).trim();
  return "";
}

function socialReplyTargetCandidates(threadRef: string, channel: MetaSocialChannel, events: SheetRow[]): Set<string> {
  const candidates = new Set<string>();
  addCandidate(candidates, socialReplyTarget(threadRef, channel, events));
  const onlyBrowserImports = events.length > 0 && events.every(isBrowserImportedSocialEvent);
  for (const event of events) {
    if (isBrowserImportedSocialEvent(event)) {
      if (isBrowserVerifiedSocialEvent(event)) {
        addCandidate(candidates, metadataStringValue(event.provider_metadata, BROWSER_IMPORT_SEND_TARGET_KEYS));
      }
      continue;
    }
    addCandidate(candidates, metadataStringValue(event.provider_metadata, socialSendTargetKeys(channel)));
    if (event.direction === "inbound") addCandidate(candidates, event.phone);
    const eventThreadRef = String(event.thread_ref || "").trim();
    if (event.direction === "inbound" && eventThreadRef.startsWith(`${channel}:`)) addCandidate(candidates, eventThreadRef.slice(channel.length + 1));
  }
  if (!onlyBrowserImports && threadRef.startsWith(`${channel}:`)) addCandidate(candidates, threadRef.slice(channel.length + 1));
  return candidates;
}

function targetMessageExists(events: SheetRow[], messageId: string) {
  const clean = messageId.trim();
  return events.some((event) => {
    const providerMessageId = String(event.provider_message_id || "").trim();
    const gmailMessageId = String(event.gmail_message_id || "").trim();
    return providerMessageId === clean || gmailMessageId === clean || gmailMessageId.endsWith(`:${clean}`);
  });
}

async function connectionForChannel(channel: MetaSocialChannel) {
  const { connections } = await listChannelConnections();
  return connections
    .filter((connection) =>
      connection.channel === channel
      && connection.provider === "meta_direct"
      && connection.status === "connected"
      && Boolean(resolvePageAccessToken(connection))
    )
    .sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || ""))[0] || null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const audit = createRequestAudit({
    headers: req.headers,
    route: "/api/threads/[threadRef]/reaction",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");
  const input = (await req.json()) as ReactionBody;
  if (!["instagram", "messenger"].includes(input.channel) || !input.to || !input.messageId) {
    await audit.write("validate", "failed", {
      channel: input.channel,
      contactRef: input.to,
      providerMessageId: input.messageId,
      statusCode: 400,
      errorMessage: "channel, to, and messageId required",
    });
    return NextResponse.json({ ok: false, error: "channel, to, and messageId required" }, { status: 400 });
  }
  if (input.action !== "unreact" && input.reaction && !ALLOWED_REACTIONS.has(input.reaction)) {
    await audit.write("validate", "failed", {
      channel: input.channel,
      contactRef: input.to,
      providerMessageId: input.messageId,
      statusCode: 400,
      errorCode: "unsupported_reaction",
      errorMessage: "Unsupported reaction",
    });
    return NextResponse.json({ ok: false, error: "Unsupported reaction" }, { status: 400 });
  }
  const channel = input.channel as MetaSocialChannel;
  const recentEvents = databaseEnabled()
    ? await readEventsForThreadOrContactFromDatabase({ threadRef, channel, limit: 80 }).catch(() => [])
    : [];
  if (!targetMessageExists(recentEvents, input.messageId)) {
    await audit.write("validate_target", "failed", {
      channel,
      contactRef: input.to,
      providerMessageId: input.messageId,
      statusCode: 409,
      errorCode: "target_not_in_thread",
      errorMessage: "Reaction target message does not belong to this thread",
    });
    return NextResponse.json({ ok: false, error: "Reaction target message does not belong to this thread" }, { status: 409 });
  }
  const targetMatches = [...socialReplyTargetCandidates(threadRef, channel, recentEvents)]
    .some((candidate) => normalizeTarget(candidate) === normalizeTarget(input.to));
  if (!targetMatches) {
    await audit.write("validate_target", "failed", {
      channel,
      contactRef: input.to,
      providerMessageId: input.messageId,
      statusCode: 409,
      errorCode: "recipient_mismatch",
      errorMessage: "Reaction recipient does not match this thread",
    });
    return NextResponse.json({ ok: false, error: "Reaction recipient does not match this thread" }, { status: 409 });
  }
  const connection = await connectionForChannel(channel);
  const result = await sendMetaSocialReaction({
    channel,
    to: socialReplyTarget(threadRef, channel, recentEvents) || input.to,
    messageId: input.messageId,
    reaction: input.reaction,
    action: input.action,
    pageAccessToken: resolvePageAccessToken(connection),
  });
  if (!result.sent) {
    await audit.write("send", "failed", {
      channel,
      contactRef: input.to,
      providerMessageId: input.messageId,
      statusCode: 502,
      errorCode: "reaction_send_failed",
      errorMessage: result.error || "Reaction not sent",
    });
    return NextResponse.json({ ok: false, error: result.error || "Reaction not sent" }, { status: 502 });
  }

  const reaction = input.action === "unreact" ? "" : (input.reaction || "love");
  await recordChannelInteraction({
    channel,
    direction: "outbound",
    agentName: "Owner",
    source: "human_takeover",
    phone: input.to,
    threadRef,
    eventType: `${channel}_reaction`,
    messageText: input.action === "unreact" ? "Reaction removed" : `Reaction: ${reaction}`,
    summary: input.action === "unreact" ? "Owner removed a reaction from the dashboard." : "Owner reacted from the dashboard.",
    status: "sent",
    gmailMessageId: `${channel}:reaction:${input.messageId}:owner:${Date.now()}`,
    providerMessageId: result.messageIds[0] || "",
    providerThreadId: threadRef,
    providerMetadata: {
      reactionTargetMessageId: input.messageId,
      reactionEmoji: reaction,
      reactionAction: input.action === "unreact" ? "unreact" : "react",
      senderId: input.to,
      manualSendMessageIds: result.messageIds,
    },
  });

  await audit.write("send", "sent", {
    channel,
    contactRef: input.to,
    providerMessageId: result.messageIds[0] || input.messageId,
    statusCode: 200,
    metadata: { action: input.action || "react", reaction },
  });
  return NextResponse.json({ ok: true, reaction });
}
