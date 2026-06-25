import crypto from "crypto";

import { mediaProxyUrl } from "@/lib/mediaProxy";
import type { OmnichannelMedia } from "@/lib/omnichannelEvents";

export type MetaSocialChannel = "instagram" | "messenger";

export type MetaSocialInboundMessage = {
  channel: MetaSocialChannel;
  senderId: string;
  senderName: string;
  senderUsername: string;
  recipientId: string;
  messageId: string;
  createdTime: string;
  text: string;
  media: OmnichannelMedia[];
  entryId: string;
};

export type MetaSocialSendResult = {
  sent: boolean;
  skipped: boolean;
  messageIds: string[];
  error: string;
  deliveredBody: string;
  deliveredMediaUrls: string[];
  droppedMediaUrls: string[];
};

// Unified normalized message shape for all Meta webhook event types.
export type MetaMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "sticker"
  | "reaction"
  | "read_receipt"
  | "postback"
  | "quick_reply"
  | "unknown";

export type NormalizedMetaMessage = {
  type: MetaMessageType;
  content: string;
  mediaUrl?: string;
  mimeType?: string;
  stickerId?: string;
  reactionEmoji?: string;
  reactionAction?: "react" | "unreact";
  watermark?: number;
  postbackPayload?: string;
  quickReplyPayload?: string;
  senderId: string;
  pageId: string;
  timestamp: number;
  raw: Record<string, unknown>;
};

type ConnectionHints = {
  instagramIds?: Iterable<string>;
  messengerIds?: Iterable<string>;
};

function envFlag(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function metaGraphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
}

function metaSocialAccessToken(pageAccessToken?: string): string {
  return cleanText(pageAccessToken);
}

// Resolve per-page token from a channel_connections record metadata.
export function resolvePageAccessToken(connection?: { metadata?: Record<string, unknown>; page_access_token?: string } | null): string {
  const fromRecord = cleanText(connection?.page_access_token || String(connection?.metadata?.page_access_token || ""));
  return fromRecord;
}

function absoluteMediaUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  const base = cleanText(process.env.PUBLIC_BASE_URL).replace(/\/$/, "");
  if (!base || !trimmed.startsWith("/")) return trimmed;
  return `${base}${trimmed}`;
}

function sendEndpoint(channel: MetaSocialChannel): string {
  const custom = channel === "instagram"
    ? cleanText(process.env.META_INSTAGRAM_SEND_ENDPOINT)
    : cleanText(process.env.META_MESSENGER_SEND_ENDPOINT);
  if (custom) return custom;
  return `https://graph.facebook.com/${metaGraphVersion()}/me/messages`;
}

function channelFlag(channel: MetaSocialChannel): boolean {
  return channel === "instagram"
    ? envFlag(process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK)
    : envFlag(process.env.ENABLE_MESSENGER_DIRECT_WEBHOOK);
}

export function metaSocialDirectEnabled(channel?: MetaSocialChannel): boolean {
  const globalEnabled = envFlag(process.env.ENABLE_META_SOCIAL_WEBHOOKS);
  if (channel) return channelFlag(channel) || globalEnabled;
  return globalEnabled || channelFlag("instagram") || channelFlag("messenger");
}

export function verifyMetaSocialSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = cleanText(process.env.META_SOCIAL_APP_SECRET || process.env.META_APP_SECRET);
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  if (signatureHeader.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

export function metaSocialVerifyToken(): string {
  return cleanText(process.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
}

function attachmentTypeFrom(value: Record<string, unknown>, url: string): OmnichannelMedia["type"] {
  const source = `${cleanText(value.type)} ${cleanText(value.mime_type)} ${cleanText(value.content_type)} ${url}`.toLowerCase();
  if (source.includes("audio") || /\.(?:aac|m4a|mp3|mpeg|oga|ogg|opus|wav|webm)(?:$|[?#])/i.test(source)) return "audio";
  if (source.includes("video") || /\.(?:mp4|mov|webm)(?:$|[?#])/i.test(source)) return "video";
  if (source.includes("image") || /\.(?:avif|gif|jpeg|jpg|png|webp)(?:$|[?#])/i.test(source)) return "image";
  if (source.includes("file")) return "file";
  return "unknown";
}

function attachmentUrl(value: Record<string, unknown>): string {
  const payload = jsonRecord(value.payload);
  const imageData = jsonRecord(value.image_data);
  const videoData = jsonRecord(value.video_data);
  const audioData = jsonRecord(value.audio_data);
  return [
    value.url,
    value.file_url,
    value.attachment_url,
    payload.url,
    payload.src,
    imageData.url,
    videoData.url,
    audioData.url,
  ].map((item) => cleanText(item)).find(Boolean) || "";
}

function extractAttachments(value: unknown): OmnichannelMedia[] {
  const media: OmnichannelMedia[] = [];
  const seen = new Set<string>();
  const visit = (input: unknown, depth: number) => {
    if (!input || depth > 6) return;
    if (Array.isArray(input)) {
      for (const child of input) visit(child, depth + 1);
      return;
    }
    if (typeof input !== "object") return;
    const record = input as Record<string, unknown>;
    const url = attachmentUrl(record);
    if (url && !seen.has(url)) {
      seen.add(url);
      media.push({
        id: cleanText(record.id || record.attachment_id),
        url,
        type: attachmentTypeFrom(record, url),
        contentType: cleanText(record.mime_type || record.content_type || record.contentType) || undefined,
        filename: cleanText(record.name || record.filename) || undefined,
      });
    }
    for (const [key, child] of Object.entries(record)) {
      if (["sender", "recipient", "from", "to"].includes(key)) continue;
      if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return media;
}

function inferChannel(event: Record<string, unknown>, entryId: string, hints?: ConnectionHints): MetaSocialChannel | "" {
  const lower = JSON.stringify(event).toLowerCase();
  if (lower.includes("instagram")) return "instagram";
  const senderId = cleanText(jsonRecord(event.sender).id || jsonRecord(event.from).id);
  const recipientId = cleanText(jsonRecord(event.recipient).id || jsonRecord(event.to).id);
  const instagramIds = new Set([...(hints?.instagramIds || [])].map((value) => cleanText(value)).filter(Boolean));
  const messengerIds = new Set([...(hints?.messengerIds || [])].map((value) => cleanText(value)).filter(Boolean));
  if ([entryId, senderId, recipientId].some((value) => instagramIds.has(value))) return "instagram";
  if ([entryId, senderId, recipientId].some((value) => messengerIds.has(value))) return "messenger";
  return "messenger";
}

function normalizeEvent(
  event: Record<string, unknown>,
  entryId: string,
  hints?: ConnectionHints,
): MetaSocialInboundMessage | null {
  const channel = inferChannel(event, entryId, hints);
  if (!channel) return null;
  const sender = jsonRecord(event.sender || event.from);
  const recipient = jsonRecord(event.recipient || event.to);
  const message = jsonRecord(event.message);
  if (message.is_echo === true || event.message_echo === true) return null;
  const text = cleanText(message.text || event.text || jsonRecord(event.postback).title);
  const senderId = cleanText(sender.id);
  const recipientId = cleanText(recipient.id);
  const messageId = cleanText(message.mid || message.id || event.mid || event.id);
  const senderName = cleanText(sender.name || sender.username || senderId);
  const senderUsername = cleanText(sender.username || sender.name || senderId);
  const createdAt = String(event.timestamp || message.timestamp || Date.now());
  const media = extractAttachments(message.attachments || event.attachments);
  if (!senderId || !messageId || (!text && !media.length)) return null;
  return {
    channel,
    senderId,
    senderName,
    senderUsername,
    recipientId,
    messageId,
    createdTime: /^\d+$/.test(createdAt) ? new Date(Number(createdAt)).toISOString() : createdAt,
    text,
    media,
    entryId,
  };
}

export function extractMetaSocialMessages(payload: Record<string, unknown>, hints?: ConnectionHints): MetaSocialInboundMessage[] {
  const messages: MetaSocialInboundMessage[] = [];
  for (const entry of records(payload.entry)) {
    const entryId = cleanText(entry.id);
    for (const messaging of records(entry.messaging)) {
      const normalized = normalizeEvent(messaging, entryId, hints);
      if (normalized) messages.push(normalized);
    }
    for (const change of records(entry.changes)) {
      const value = jsonRecord(change.value);
      for (const messaging of records(value.messaging)) {
        const normalized = normalizeEvent(messaging, entryId, hints);
        if (normalized) messages.push(normalized);
      }
    }
  }
  return messages;
}

async function postMetaSocialMessage(
  channel: MetaSocialChannel,
  body: Record<string, unknown>,
  pageAccessToken?: string,
): Promise<{ ok: boolean; id: string; error: string }> {
  const token = metaSocialAccessToken(pageAccessToken);
  if (!token) return { ok: false, id: "", error: `Connect ${channel} with Meta before sending. No page access token is stored for this channel.` };
  const response = await fetch(sendEndpoint(channel), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as {
    message_id?: string;
    recipient_id?: string;
    error?: { message?: string };
  };
  if (!response.ok) {
    return {
      ok: false,
      id: "",
      error: payload.error?.message || response.statusText || `Meta ${channel} send failed`,
    };
  }
  return {
    ok: true,
    id: cleanText(payload.message_id || payload.recipient_id),
    error: "",
  };
}

function attachmentPayloadType(url: string): "image" | "audio" | "video" | "file" {
  const lower = url.toLowerCase();
  if (/\.(?:png|jpe?g|gif|webp)(?:$|[?#])/.test(lower)) return "image";
  if (/\.(?:aac|m4a|mp3|mpeg|oga|ogg|opus|wav|webm)(?:$|[?#])/.test(lower)) return "audio";
  if (/\.(?:mp4|mov|webm)(?:$|[?#])/.test(lower)) return "video";
  return "file";
}

function sendableMediaUrls(mediaUrls: string[] = []): string[] {
  return mediaUrls
    .map((url) => absoluteMediaUrl(mediaProxyUrl(url)))
    .map((url) => url.trim())
    .filter((url) => /^https:\/\//i.test(url));
}

export async function sendMetaSocialMessage(input: {
  channel: MetaSocialChannel;
  to: string;
  body: string;
  mediaUrls?: string[];
  pageAccessToken?: string;
}): Promise<MetaSocialSendResult> {
  if (!metaSocialDirectEnabled(input.channel)) {
    return {
      sent: false,
      skipped: true,
      messageIds: [],
      error: `${input.channel} direct webhook/send mode is not enabled`,
      deliveredBody: "",
      deliveredMediaUrls: [],
      droppedMediaUrls: input.mediaUrls ?? [],
    };
  }
  const recipientId = cleanText(input.to);
  const body = cleanText(input.body);
  const mediaUrls = sendableMediaUrls(input.mediaUrls);
  if (!recipientId || (!body && !mediaUrls.length)) {
    return {
      sent: false,
      skipped: true,
      messageIds: [],
      error: "Missing Meta social recipient or content",
      deliveredBody: "",
      deliveredMediaUrls: [],
      droppedMediaUrls: input.mediaUrls ?? [],
    };
  }

  const messageIds: string[] = [];
  if (body) {
    const textResult = await postMetaSocialMessage(input.channel, {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: body },
    }, input.pageAccessToken);
    if (!textResult.ok) {
      return {
        sent: false,
        skipped: false,
        messageIds,
        error: textResult.error,
        deliveredBody: "",
        deliveredMediaUrls: [],
        droppedMediaUrls: input.mediaUrls ?? [],
      };
    }
    if (textResult.id) messageIds.push(textResult.id);
  }

  const deliveredMediaUrls: string[] = [];
  for (const url of mediaUrls) {
    const type = attachmentPayloadType(url);
    const attachmentResult = await postMetaSocialMessage(input.channel, {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: type === "file" ? "file" : type,
          payload: { url, is_reusable: false },
        },
      },
    }, input.pageAccessToken);
    if (!attachmentResult.ok) {
      return {
        sent: false,
        skipped: false,
        messageIds,
        error: attachmentResult.error,
        deliveredBody: body,
        deliveredMediaUrls,
        droppedMediaUrls: (input.mediaUrls ?? []).filter((candidate) => !deliveredMediaUrls.includes(candidate)),
      };
    }
    deliveredMediaUrls.push(url);
    if (attachmentResult.id) messageIds.push(attachmentResult.id);
  }

  return {
    sent: true,
    skipped: false,
    messageIds,
    error: "",
    deliveredBody: body,
    deliveredMediaUrls,
    droppedMediaUrls: [],
  };
}

// Send a single media attachment with optional text caption (sent as a separate message).
export async function sendMediaMessage(input: {
  channel: MetaSocialChannel;
  to: string;
  mediaType: "image" | "video" | "audio" | "file";
  mediaUrl: string;
  caption?: string;
  pageAccessToken?: string;
}): Promise<MetaSocialSendResult> {
  const urls = input.caption
    ? [input.mediaUrl]
    : [input.mediaUrl];
  const result = await sendMetaSocialMessage({
    channel: input.channel,
    to: input.to,
    body: input.caption || "",
    mediaUrls: urls,
    pageAccessToken: input.pageAccessToken,
  });
  return result;
}

// Map any raw Meta webhook event object to a unified NormalizedMetaMessage.
// Returns null for events that should not produce a message (e.g. echoes).
export function normalizeMetaMessage(
  event: Record<string, unknown>,
  pageId: string,
): NormalizedMetaMessage | null {
  const sender = jsonRecord(event.sender || event.from);
  const message = jsonRecord(event.message);
  const senderId = cleanText(sender.id);
  if (!senderId) return null;
  if (message.is_echo === true || event.message_echo === true) return null;

  const ts = Number(event.timestamp || message.timestamp || Date.now());

  // Reaction
  const reaction = jsonRecord(event.reaction);
  if (reaction.mid || reaction.emoji) {
    return {
      type: "reaction",
      content: cleanText(reaction.emoji),
      reactionEmoji: cleanText(reaction.emoji),
      reactionAction: String(reaction.action || "react") === "unreact" ? "unreact" : "react",
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  // Read receipt
  const read = jsonRecord(event.read);
  if (read.watermark !== undefined) {
    return {
      type: "read_receipt",
      content: "",
      watermark: Number(read.watermark),
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  // Postback
  const postback = jsonRecord(event.postback);
  if (postback.payload !== undefined || postback.title !== undefined) {
    return {
      type: "postback",
      content: cleanText(postback.title || postback.payload),
      postbackPayload: cleanText(postback.payload),
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  // Quick reply inside message
  const quickReply = jsonRecord(message.quick_reply);
  if (quickReply.payload !== undefined) {
    return {
      type: "quick_reply",
      content: cleanText(message.text || quickReply.payload),
      quickReplyPayload: cleanText(quickReply.payload),
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  // Sticker
  const attachments = records(message.attachments);
  const stickerAttachment = attachments.find((a) => cleanText(a.type) === "sticker");
  if (stickerAttachment) {
    const payload = jsonRecord(stickerAttachment.payload);
    return {
      type: "sticker",
      content: "",
      stickerId: cleanText(payload.sticker_id),
      mediaUrl: cleanText(payload.url || stickerAttachment.url),
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  // Media attachments (image/video/audio/file)
  if (attachments.length > 0) {
    const first = attachments[0];
    const url = attachmentUrl(first);
    const mediaType = attachmentTypeFrom(first, url);
    const validMedia: MetaMessageType = (["image", "video", "audio", "file"] as const).includes(mediaType as "image") ? mediaType as MetaMessageType : "file";
    return {
      type: validMedia,
      content: cleanText(message.text),
      mediaUrl: url || undefined,
      mimeType: cleanText(first.mime_type || first.content_type) || undefined,
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  // Plain text
  const text = cleanText(message.text || event.text);
  if (text) {
    return {
      type: "text",
      content: text,
      senderId,
      pageId,
      timestamp: ts,
      raw: event,
    };
  }

  return null;
}
