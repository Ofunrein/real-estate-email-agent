import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { type EmailAttachment, sendManualReply } from "@/lib/manualReply";
import {
  databaseEnabled,
  readEventsForThreadFromDatabase,
  readEventsForThreadOrContactFromDatabase,
  upsertThreadLinkInDatabase,
} from "@/lib/database";
import { readMediaUpload } from "@/lib/mediaUploads";
import { createRequestAudit } from "@/lib/requestAudit";
import type { SheetRow } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

type ReplyBody = {
  channel: "sms" | "whatsapp" | "email" | "instagram" | "messenger";
  to: string;
  body: string;
  mediaUrls?: string[];
  mediaTranscripts?: Array<{ url?: string; text?: string }>;
  subject?: string;
  threadId?: string;
  messageId?: string;
  references?: string;
};

type ReplyMediaTranscript = NonNullable<ReplyBody["mediaTranscripts"]>[number];

// Map public /uploads/<filename> URL → absolute disk path for email attachment reads.
async function resolveAttachments(mediaUrls: string[] = [], channel: ReplyBody["channel"]): Promise<EmailAttachment[]> {
  if (channel !== "email") return [];
  const attachments: EmailAttachment[] = [];
  for (const url of mediaUrls) {
    const dbMatch = /\/api\/media\/uploads\/([^/?#]+)\/([^?#]+)$/.exec(url);
    if (dbMatch) {
      const upload = await readMediaUpload(decodeURIComponent(dbMatch[1]));
      if (upload) {
        attachments.push({
          filename: upload.filename,
          contentType: upload.contentType,
          data: upload.data,
        });
      }
      continue;
    }

    const match = /\/uploads\/([^?#]+)$/.exec(url);
    if (!match) continue;
    const filename = decodeURIComponent(match[1]);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const contentTypeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
      caf: "audio/x-caf", m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg",
      wav: "audio/wav", webm: "audio/webm", mp4: "video/mp4",
    };
    attachments.push({
      filename,
      contentType: contentTypeMap[ext] ?? "application/octet-stream",
      path: join(process.cwd(), "public", "uploads", filename),
    });
  }
  return attachments;
}

function mediaLogLabel(channel: ReplyBody["channel"], url: string): string {
  if (/\.(?:aac|caf|m4a|mp3|mpeg|ogg|opus|wav|webm)(?:$|[?#])/i.test(url)) return "Voice note";
  if (channel === "whatsapp") return "WhatsApp media";
  if (channel === "instagram" || channel === "messenger") return "Social DM media";
  if (channel === "email") return "Attachment";
  return "MMS media";
}

function messageWithMediaLog(input: Pick<ReplyBody, "channel"> & {
  body: string;
  mediaUrls?: string[];
  mediaTranscripts?: ReplyBody["mediaTranscripts"];
}): string {
  const body = input.body?.trim() || "";
  const mediaLines = (input.mediaUrls || []).flatMap((url) => {
    const transcript = input.mediaTranscripts?.find((item) => item.url === url)?.text?.trim();
    return [
      `${mediaLogLabel(input.channel, url)}: ${url}`,
      transcript ? `Voice note transcript: ${transcript}` : "",
    ].filter(Boolean);
  });
  return [body, ...mediaLines].filter(Boolean).join("\n\n");
}

function inferReplyMediaType(url: string): "audio" | "image" | "video" | "file" {
  const clean = url.trim().toLowerCase();
  if (/\.(?:png|jpe?g|gif|webp)(?:$|[?#])/.test(clean)) return "image";
  if (/\.(?:aac|caf|m4a|mp3|mpeg|ogg|opus|wav|webm)(?:$|[?#])/.test(clean)) return "audio";
  if (/\.(?:mov|mp4|webm)(?:$|[?#])/.test(clean)) return "video";
  return "file";
}

function normalizeMediaTranscripts(
  mediaUrls: string[],
  mediaTranscripts: ReplyBody["mediaTranscripts"] = [],
): ReplyMediaTranscript[] {
  const allowed = new Set(mediaUrls);
  return mediaTranscripts.filter((item): item is ReplyMediaTranscript =>
    Boolean(item?.url && allowed.has(item.url) && item.text?.trim()),
  );
}

function mediaJsonForReply(
  mediaUrls: string[],
  mediaTranscripts: ReplyBody["mediaTranscripts"] = [],
) {
  return mediaUrls.map((url) => {
    const transcript = mediaTranscripts.find((item) => item.url === url)?.text?.trim() || "";
    return {
      url,
      type: inferReplyMediaType(url),
      transcript: transcript || undefined,
      providerMetadata: { source: "manual_reply" },
    };
  });
}

function normalizeChannel(value: string): ReplyBody["channel"] | "" {
  const channel = value.toLowerCase().trim();
  if (["sms", "whatsapp", "email", "instagram", "messenger"].includes(channel)) {
    return channel as ReplyBody["channel"];
  }
  return "";
}

function normalizeTarget(channel: ReplyBody["channel"], value: string) {
  const clean = value.trim();
  if (channel === "email") return clean.toLowerCase();
  if (channel === "sms" || channel === "whatsapp") return clean.replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  return clean;
}

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
];
const BROWSER_IMPORT_THREAD_KEYS = ["threadId", "thread_id", "directThreadId", "direct_thread_id", "threadFbid", "thread_fbid"];

function socialSendTargetKeys(channel: ReplyBody["channel"]): string[] {
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

function socialReplyTarget(threadRef: string, channel: ReplyBody["channel"], events: SheetRow[]): string {
  let verifiedBrowserTarget = "";
  let browserThreadTarget = "";
  let sawBrowserImport = false;
  let sawNonBrowserImport = false;
  for (const event of [...events].reverse()) {
    if (isBrowserImportedSocialEvent(event)) {
      sawBrowserImport = true;
      if (!verifiedBrowserTarget && isBrowserVerifiedSocialEvent(event)) {
          verifiedBrowserTarget = metadataStringValue(event.provider_metadata, BROWSER_IMPORT_SEND_TARGET_KEYS);
      }
      if (channel === "instagram" && !browserThreadTarget && isBrowserVerifiedSocialEvent(event)) {
        const browserThreadId = metadataStringValue(event.provider_metadata, BROWSER_IMPORT_THREAD_KEYS) || String(event.provider_thread_id || "").trim();
        if (browserThreadId) browserThreadTarget = `browser_thread:${browserThreadId}`;
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
  if (browserThreadTarget) return browserThreadTarget;
  if (sawBrowserImport && !sawNonBrowserImport) return "";
  if (threadRef.startsWith(`${channel}:`)) return threadRef.slice(channel.length + 1).trim();
  return "";
}

function socialReplyTargetCandidates(
  threadRef: string,
  channel: ReplyBody["channel"],
  events: SheetRow[],
): Set<string> {
  const candidates = new Set<string>();
  addCandidate(candidates, socialReplyTarget(threadRef, channel, events));
  const onlyBrowserImports = events.length > 0 && events.every(isBrowserImportedSocialEvent);
  for (const event of events) {
    if (isBrowserImportedSocialEvent(event)) {
      if (isBrowserVerifiedSocialEvent(event)) {
        addCandidate(candidates, metadataStringValue(event.provider_metadata, BROWSER_IMPORT_SEND_TARGET_KEYS));
        const browserThreadId = metadataStringValue(event.provider_metadata, BROWSER_IMPORT_THREAD_KEYS) || String(event.provider_thread_id || "").trim();
        if (channel === "instagram" && browserThreadId) addCandidate(candidates, `browser_thread:${browserThreadId}`);
      }
      continue;
    }
    addCandidate(candidates, metadataStringValue(event.provider_metadata, socialSendTargetKeys(channel)));
    if (event.direction === "inbound") addCandidate(candidates, event.phone);
    const eventThreadRef = String(event.thread_ref || "").trim();
    if (event.direction === "inbound" && eventThreadRef.startsWith(`${channel}:`)) {
      addCandidate(candidates, eventThreadRef.slice(channel.length + 1));
    }
  }
  if (!onlyBrowserImports && threadRef.startsWith(`${channel}:`)) addCandidate(candidates, threadRef.slice(channel.length + 1));
  return candidates;
}

function threadReplyTarget(threadRef: string, events: SheetRow[]): { channel: ReplyBody["channel"]; to: string } | null {
  const latest = events[events.length - 1];
  if (!latest) return null;
  const channel = normalizeChannel(latest.channel || "");
  if (!channel) return null;
  const to = channel === "email"
    ? latest.email || threadRef
    : channel === "sms" || channel === "whatsapp"
      ? latest.phone || threadRef
      : socialReplyTarget(threadRef, channel, events);
  return to ? { channel, to } : null;
}

function isSocialReplyChannel(channel: ReplyBody["channel"]) {
  return channel === "instagram" || channel === "messenger";
}

function canonicalReplyThreadRef(threadRef: string, channel: ReplyBody["channel"], events: SheetRow[]) {
  if (!isSocialReplyChannel(channel)) return threadRef;
  return [...events]
    .reverse()
    .find((event) => event.thread_ref?.startsWith(`${channel}:`))
    ?.thread_ref || threadRef;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const audit = createRequestAudit({
    headers: req.headers,
    route: "/api/threads/[threadRef]/reply",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");
  const input = (await req.json()) as ReplyBody;

  if (!input.channel || !input.to || (!input.body?.trim() && !input.mediaUrls?.length)) {
    await audit.write("validate", "failed", {
      channel: input.channel,
      contactRef: input.to,
      statusCode: 400,
      errorCode: "missing_required_fields",
      errorMessage: "channel, to, and body/media required",
    });
    return NextResponse.json({ ok: false, error: "channel, to, and body/media required" }, { status: 400 });
  }

  if (!(await isTakeoverActive(threadRef, input.channel))) {
    await audit.write("takeover_guard", "blocked", {
      channel: input.channel,
      contactRef: input.to,
      statusCode: 403,
      errorCode: "no_active_takeover",
      errorMessage: "No active takeover for this thread",
    });
    return NextResponse.json({ ok: false, error: "No active takeover for this thread" }, { status: 403 });
  }

  const recentEvents = databaseEnabled()
    ? await (
      isSocialReplyChannel(input.channel)
        ? readEventsForThreadOrContactFromDatabase({ threadRef, channel: input.channel, limit: 20 })
        : readEventsForThreadFromDatabase(threadRef, 20)
    ).catch(() => [])
    : [];
  const resolvedTarget = threadReplyTarget(threadRef, recentEvents);
  const persistedThreadRef = canonicalReplyThreadRef(threadRef, input.channel, recentEvents);
  if (resolvedTarget) {
    if (resolvedTarget.channel !== input.channel) {
      await audit.write("validate_target", "failed", {
        channel: input.channel,
        contactRef: input.to,
        statusCode: 409,
        errorCode: "channel_mismatch",
        errorMessage: "Reply channel does not match this thread",
      });
      return NextResponse.json({ ok: false, error: "Reply channel does not match this thread" }, { status: 409 });
    }
    const normalizedInputTarget = normalizeTarget(input.channel, input.to);
    const targetMatches = isSocialReplyChannel(input.channel)
      ? [...socialReplyTargetCandidates(threadRef, input.channel, recentEvents)]
        .some((candidate) => normalizeTarget(input.channel, candidate) === normalizedInputTarget)
      : normalizedInputTarget === normalizeTarget(resolvedTarget.channel, resolvedTarget.to);
    if (!targetMatches) {
      await audit.write("validate_target", "failed", {
        channel: input.channel,
        contactRef: input.to,
        statusCode: 409,
        errorCode: "recipient_mismatch",
        errorMessage: "Reply recipient does not match this thread",
        metadata: { candidateCount: socialReplyTargetCandidates(threadRef, input.channel, recentEvents).size },
      });
      return NextResponse.json({ ok: false, error: "Reply recipient does not match this thread" }, { status: 409 });
    }
    input.to = resolvedTarget.to;
  } else if (isSocialReplyChannel(input.channel)) {
    await audit.write("validate_target", "blocked", {
      channel: input.channel,
      contactRef: input.to,
      statusCode: 409,
      errorCode: "missing_meta_recipient",
      errorMessage: "Missing Meta webhook recipient id for this thread.",
    });
    return NextResponse.json({
      ok: false,
      error: "Missing Meta webhook recipient id for this thread. Wait for a new inbound DM through the connected Meta webhook, then reply from the dashboard.",
    }, { status: 409 });
  }

  const result = await sendManualReply({
    ...input,
    attachments: await resolveAttachments(input.mediaUrls, input.channel),
  });
  if (!result.ok) {
    await audit.write("send", "failed", {
      channel: input.channel,
      contactRef: input.to,
      statusCode: 502,
      errorCode: "provider_send_failed",
      errorMessage: result.error || "Provider send failed",
      metadata: { mediaCount: input.mediaUrls?.length || 0 },
    });
    return NextResponse.json(result, { status: 502 });
  }

  const deliveredBody = result.deliveredBody || input.body;
  const deliveredMediaUrls = result.deliveredMediaUrls || input.mediaUrls || [];
  const deliveredMediaTranscripts = normalizeMediaTranscripts(deliveredMediaUrls, input.mediaTranscripts);
  const droppedMediaUrls = result.droppedMediaUrls || [];
  const socialProviderMessageId = isSocialReplyChannel(input.channel)
    ? result.messageIds?.[0] || ""
    : "";

  await recordChannelInteraction({
    channel: input.channel,
    direction: "outbound",
    agentName: "Owner",
    source: "human_takeover",
    phone: input.channel !== "email" ? input.to : undefined,
    email: input.channel === "email" ? input.to : undefined,
    threadRef: persistedThreadRef,
    messageText: messageWithMediaLog({
      channel: input.channel,
      body: deliveredBody,
      mediaUrls: deliveredMediaUrls,
      mediaTranscripts: deliveredMediaTranscripts,
    }),
    status: droppedMediaUrls.length
      ? "sent_with_fallback"
      : result.fallbackReason
        ? "sent_fresh"
        : "sent",
    mailboxEmail: input.channel === "email" ? result.mailboxEmail : "",
    gmailThreadId: input.channel === "email" ? result.gmailThreadId : "",
    gmailMessageId: input.channel === "email" ? result.gmailMessageId : socialProviderMessageId ? `${input.channel}:${socialProviderMessageId}` : "",
    threadStatus: input.channel === "email"
      ? result.threaded ? "current_mailbox_thread" : "sent_fresh_from_current_mailbox"
      : "",
    providerMessageId: socialProviderMessageId,
    providerThreadId: isSocialReplyChannel(input.channel) ? persistedThreadRef : "",
    mediaJson: mediaJsonForReply(deliveredMediaUrls, deliveredMediaTranscripts),
    providerMetadata: socialProviderMessageId ? {
      senderId: input.to,
      manualSendMessageIds: result.messageIds || [],
    } : undefined,
  });

  await audit.write("send", "sent", {
    channel: input.channel,
    contactRef: input.to,
    providerMessageId: socialProviderMessageId,
    statusCode: 200,
    metadata: {
      mediaCount: deliveredMediaUrls.length,
      droppedMediaCount: droppedMediaUrls.length,
      persistedThreadRef,
    },
  });

  if (databaseEnabled() && input.channel === "email" && result.ok) {
    await upsertThreadLinkInDatabase({
      threadRef,
      channel: "email",
      mailboxEmail: result.mailboxEmail,
      gmailThreadId: result.gmailThreadId || input.threadId,
      gmailMessageId: result.gmailMessageId,
      threadStatus: result.threaded ? "current_mailbox_thread" : "sent_fresh_from_current_mailbox",
    });
  }

  return NextResponse.json(result);
}
