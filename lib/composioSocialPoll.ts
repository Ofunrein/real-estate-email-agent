import { recordChannelInteraction } from "@/lib/channelIngest";
import { listChannelConnections, type ChannelConnectionRecord } from "@/lib/channelConnections";
import { composioExternalUserId, createComposioClient } from "@/lib/composioConnection";
import { sendComposioSocialMessage, type ComposioSocialChannel } from "@/lib/composioSocial";
import { metaSocialDirectEnabled } from "@/lib/metaSocial";
import {
  claimEventDedupeInDatabase,
  conversationEventMessageIdExists,
  findCandidatePropertiesFromDatabase,
  findLeadInDatabase,
  findPropertiesByAddressesFromDatabase,
  readReplyJobByDedupeKeyFromDatabase,
  readEventsForThreadFromDatabase,
  readEventsForThreadOrContactFromDatabase,
  readInboxSettingsFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { deepgramAudioEnabled, transcribeDeepgramAudio } from "@/lib/deepgramAudio";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";
import {
  buildSocialRouterResult,
  shouldTheoHandleSocialDm,
  socialDmAgentEnabled,
  type SocialDmChannel,
  type SocialDmPayload,
} from "@/lib/manychatSocial";
import { fetchStyleContext } from "@/lib/styleTraining";
import { generateTheoReply } from "@/lib/theoAgent";
import { enrichTheoData, extractTheoListedPropertyAddresses, extractTheoPropertySearchIntent, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { isMediaTranscribable, normalizedMessageText, type OmnichannelMedia } from "@/lib/omnichannelEvents";
import { understandMediaItems } from "@/lib/mediaUnderstanding";
import { writeRequestAuditEvent } from "@/lib/requestAudit";

type PollChannel = Extract<SocialDmChannel, "instagram" | "messenger">;
const FALLBACK_SOURCE = "composio_fallback";

type ComposioMessage = {
  id: string;
  conversationId: string;
  channel: PollChannel;
  createdTime: string;
  text: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  recipientId: string;
  accountLabel: string;
  media: OmnichannelMedia[];
};

export type ComposioSocialPollResult = {
  ok: boolean;
  checked: number;
  imported: number;
  replied: number;
  skipped: number;
  errors: string[];
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayAt(value: unknown, path: string[]): Record<string, unknown>[] {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return [];
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return Array.isArray(cursor)
    ? cursor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function dataArray(value: unknown): Record<string, unknown>[] {
  return [
    ...arrayAt(value, ["data", "data"]),
    ...arrayAt(value, ["data", "messages", "data"]),
    ...arrayAt(value, ["data"]),
  ];
}

function nestedString(value: unknown, path: string[]): string {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return "";
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" || typeof cursor === "number" ? String(cursor).trim() : "";
}

function firstRecipientId(message: Record<string, unknown>): string {
  return [
    nestedString(message, ["to", "data", "0", "id"]),
    nestedString(message, ["to", "id"]),
  ].find(Boolean) || "";
}

function firstRecipientName(message: Record<string, unknown>): string {
  return [
    nestedString(message, ["to", "data", "0", "username"]),
    nestedString(message, ["to", "data", "0", "name"]),
    nestedString(message, ["to", "username"]),
    nestedString(message, ["to", "name"]),
  ].find(Boolean) || "";
}

function mediaTypeFrom(value: Record<string, unknown>, url: string): OmnichannelMedia["type"] {
  const declared = String(value.type || value.media_type || value.mime_type || value.content_type || "").toLowerCase();
  const contentType = String(value.mime_type || value.content_type || value.contentType || "").toLowerCase();
  const source = `${declared} ${contentType} ${url}`.toLowerCase();
  if (source.includes("audio") || /\.(?:aac|m4a|mp3|oga|ogg|opus|wav|webm)(?:$|[?#])/i.test(source)) return "audio";
  if (source.includes("video") || /\.(?:mp4|mov|webm)(?:$|[?#])/i.test(source)) return "video";
  if (source.includes("image") || /\.(?:avif|gif|jpeg|jpg|png|webp)(?:$|[?#])/i.test(source)) return "image";
  if (source.includes("file")) return "file";
  return "unknown";
}

function mediaUrlFrom(value: Record<string, unknown>): string {
  return [
    value.url,
    value.file_url,
    value.fileUrl,
    value.media_url,
    value.mediaUrl,
    value.preview_url,
    value.previewUrl,
    nestedString(value, ["image_data", "url"]),
    nestedString(value, ["video_data", "url"]),
    nestedString(value, ["audio_data", "url"]),
    nestedString(value, ["payload", "url"]),
  ].map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim() : "").find(Boolean) || "";
}

export function extractComposioMessageMediaForTest(value: unknown): OmnichannelMedia[] {
  const media: OmnichannelMedia[] = [];
  const seen = new Set<string>();
  const visit = (item: unknown, depth: number) => {
    if (!item || depth > 6) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const url = mediaUrlFrom(record);
    if (url && !seen.has(url)) {
      seen.add(url);
      media.push({
        id: String(record.id || record.attachment_id || record.media_id || "").trim() || undefined,
        url,
        type: mediaTypeFrom(record, url),
        contentType: String(record.mime_type || record.content_type || record.contentType || "").trim() || undefined,
        filename: String(record.name || record.filename || "").trim() || undefined,
        providerMetadata: {
          type: record.type,
          media_type: record.media_type,
        },
      });
    }
    for (const [key, child] of Object.entries(record)) {
      if (["from", "to"].includes(key)) continue;
      if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return media;
}

function filenameFromMedia(media: OmnichannelMedia, index: number): string {
  const fromUrl = media.url ? media.url.split(/[/?#]/).filter(Boolean).at(-1) : "";
  const candidate = media.filename || fromUrl || `social-media-${index}`;
  return candidate.includes(".") ? candidate : `${candidate}.${media.type === "video" ? "mp4" : "mp3"}`;
}

async function transcribeSocialMedia(media: OmnichannelMedia, index: number): Promise<OmnichannelMedia> {
  if (!deepgramAudioEnabled() || !media.url || !isMediaTranscribable(media)) return media;
  try {
    const response = await fetch(media.url);
    if (!response.ok) {
      return {
        ...media,
        providerMetadata: {
          ...media.providerMetadata,
          transcription_error: `download_failed_${response.status}`,
        },
      };
    }
    const contentType = response.headers.get("content-type") || media.contentType || "application/octet-stream";
    const file = new File([Buffer.from(await response.arrayBuffer())], filenameFromMedia(media, index), { type: contentType });
    const transcript = await transcribeDeepgramAudio(file);
    return {
      ...media,
      contentType,
      filename: media.filename || file.name,
      transcript: transcript.text,
      providerMetadata: {
        ...media.providerMetadata,
        transcription: transcript.segments || { provider: "deepgram" },
        duration: transcript.duration,
      },
    };
  } catch (error) {
    return {
      ...media,
      providerMetadata: {
        ...media.providerMetadata,
        transcription_error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function transcribeSocialMediaItems(media: OmnichannelMedia[]): Promise<OmnichannelMedia[]> {
  const next: OmnichannelMedia[] = [];
  for (let index = 0; index < media.length; index += 1) {
    next.push(await transcribeSocialMedia(media[index], index));
  }
  return next;
}

function conversationIdFrom(record: Record<string, unknown>) {
  return String(record.id || record.conversation_id || "").trim();
}

function isSelfMessage(message: ComposioMessage, connection: ChannelConnectionRecord) {
  const ownIds = [
    connection.selected_asset_id,
    connection.connected_account_id,
    String(connection.metadata?.instagram_user_id || ""),
    String(connection.metadata?.page_id || ""),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const ownNames = [
    connection.selected_asset_name,
    String(connection.metadata?.username || ""),
    String(connection.metadata?.page_name || ""),
  ].map((value) => String(value || "").replace(/^@/, "").trim().toLowerCase()).filter(Boolean);
  return ownIds.includes(message.senderId)
    || ownNames.includes(message.senderUsername.replace(/^@/, "").trim().toLowerCase())
    || ownNames.includes(message.senderName.replace(/^@/, "").trim().toLowerCase());
}

async function executeTool(
  slug: string,
  userId: string,
  connectedAccountId: string,
  args: Record<string, unknown>,
) {
  return createComposioClient().tools.execute(slug, {
    userId,
    connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
}

async function instagramMessages(userId: string, connection: ChannelConnectionRecord, limit: number): Promise<ComposioMessage[]> {
  const conversations = await executeTool(
    "INSTAGRAM_LIST_ALL_CONVERSATIONS",
    userId,
    connection.connected_account_id,
    { limit: Math.min(limit, 25), ig_user_id: String(connection.metadata?.instagram_user_id || "me") },
  );
  const accountLabel = connection.selected_asset_name || "Instagram";
  const messages: ComposioMessage[] = [];
  for (const conversation of dataArray(conversations).slice(0, Math.min(limit, 10))) {
    const conversationId = conversationIdFrom(conversation);
    if (!conversationId) continue;
    const result = await executeTool(
      "INSTAGRAM_LIST_ALL_MESSAGES",
      userId,
      connection.connected_account_id,
      { limit: Math.min(limit, 25), conversation_id: conversationId },
    );
    for (const message of dataArray(result)) {
      const from = jsonRecord(message.from);
      const senderId = String(from.id || "").trim();
      const senderUsername = String(from.username || "").trim();
      const senderName = String(from.name || senderUsername || senderId || "Instagram lead").trim();
      messages.push({
        id: String(message.id || "").trim(),
        conversationId,
        channel: "instagram",
        createdTime: String(message.created_time || message.createdTime || "").trim(),
        text: String(message.message || message.text || "").trim(),
        senderId,
        senderName,
        senderUsername,
        recipientId: firstRecipientId(message),
        accountLabel,
        media: extractComposioMessageMediaForTest(message),
      });
    }
  }
  return messages;
}

async function messengerMessages(userId: string, connection: ChannelConnectionRecord, limit: number): Promise<ComposioMessage[]> {
  const pageId = String(connection.metadata?.page_id || connection.selected_asset_id || "").trim();
  if (!pageId) return [];
  const conversations = await executeTool(
    "FACEBOOK_GET_PAGE_CONVERSATIONS",
    userId,
    connection.connected_account_id,
    { page_id: pageId, limit: Math.min(limit, 25), fields: "participants,updated_time,id" },
  );
  const accountLabel = connection.selected_asset_name || "Messenger";
  const messages: ComposioMessage[] = [];
  for (const conversation of dataArray(conversations).slice(0, Math.min(limit, 10))) {
    const conversationId = conversationIdFrom(conversation);
    if (!conversationId) continue;
    const result = await executeTool(
      "FACEBOOK_GET_CONVERSATION_MESSAGES",
      userId,
      connection.connected_account_id,
      { page_id: pageId, conversation_id: conversationId, limit: Math.min(limit, 25), fields: "id,created_time,from,to,message,attachments" },
    );
    for (const message of dataArray(result)) {
      const from = jsonRecord(message.from);
      const senderId = String(from.id || "").trim();
      const senderName = String(from.name || senderId || "Messenger lead").trim();
      messages.push({
        id: String(message.id || "").trim(),
        conversationId,
        channel: "messenger",
        createdTime: String(message.created_time || message.createdTime || "").trim(),
        text: String(message.message || message.text || "").trim(),
        senderId,
        senderName,
        senderUsername: senderName,
        recipientId: firstRecipientId(message),
        accountLabel,
        media: extractComposioMessageMediaForTest(message),
      });
    }
  }
  return messages;
}

function socialPayloadFromMessage(message: ComposioMessage): SocialDmPayload {
  const text = normalizedMessageText(message);
  return {
    channel: message.channel,
    messageText: text,
    contactId: message.senderId,
    threadId: message.conversationId,
    senderName: message.senderName,
    senderUsername: message.senderUsername,
    accountLabel: message.accountLabel,
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  };
}

function eventDateValue(value: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function automatedOutboundEvent(event: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>[number]) {
  const source = String(event.source || "").toLowerCase();
  const agentName = String(event.agent_name || "").toLowerCase();
  if (source.includes("human") || source.includes("owner") || agentName === "owner") return false;
  return event.direction !== "inbound";
}

function alreadyHandledInbound(messageKey: string, events: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>) {
  const inbound = events.find((event) => event.gmail_message_id === messageKey && event.direction === "inbound");
  if (!inbound) return true;
  const inboundAt = eventDateValue(inbound.event_at || inbound.created_at || "");
  if (!inboundAt) return true;
  return events.some((event) =>
    automatedOutboundEvent(event) &&
    eventDateValue(event.event_at || event.created_at || "") > inboundAt
  );
}

export function socialPollInboundAlreadyHandledForTest(
  messageKey: string,
  events: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>,
) {
  return alreadyHandledInbound(messageKey, events);
}

async function findComposioSocialProperties(message: string, recentEvents: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>) {
  const previousOutbound = recentEvents
    .filter((event) => event.direction !== "inbound")
    .map((event) => event.message_text || event.summary || "")
    .filter(Boolean);
  const requestedAddresses = extractTheoListedPropertyAddresses(message, ...previousOutbound);
  const addressMatches = await findPropertiesByAddressesFromDatabase(requestedAddresses, 5);
  const propertySearch = extractTheoPropertySearchIntent(message);
  const propertyQuery = extractTheoPropertySearchQuery(message);
  const shouldSearch = Boolean(
    propertyQuery ||
    propertySearch.area ||
    propertySearch.beds ||
    propertySearch.baths ||
    propertySearch.minPrice ||
    propertySearch.maxPrice ||
    propertySearch.mode !== "general",
  );
  const candidateMatches = shouldSearch
    ? await findCandidatePropertiesFromDatabase(
      {
        query: propertyQuery,
        area: propertySearch.area,
        beds: propertySearch.beds,
        baths: propertySearch.baths,
        minPrice: propertySearch.minPrice,
        maxPrice: propertySearch.maxPrice,
        mode: propertySearch.mode,
        excludeAddresses: addressMatches.map((property) => property.address).filter(Boolean),
      },
      5,
    )
    : [];
  return [...addressMatches, ...candidateMatches]
    .filter((property, index, list) =>
      property.address && list.findIndex((item) => item.address?.toLowerCase() === property.address.toLowerCase()) === index,
    )
    .slice(0, 5);
}

async function processMessage(message: ComposioMessage, connection: ChannelConnectionRecord): Promise<"imported" | "replied" | "skipped"> {
  if (!message.id || !message.senderId) return "skipped";
  if (isSelfMessage(message, connection)) return "skipped";
  const messageKey = `${message.channel}:${message.id}`;
  const media = await understandMediaItems(await transcribeSocialMediaItems(message.media || []));
  const messageText = normalizedMessageText({ text: message.text, media });
  if (!messageText) return "skipped";
  const payload = socialPayloadFromMessage(message);
  payload.messageText = messageText;
  const guard = shouldTheoHandleSocialDm(payload);
  const threadRef = `${message.channel}:${message.conversationId}`;
  const sourceDetail = [
    `account ${message.accountLabel}`,
    `sender_id ${message.senderId}`,
    message.recipientId ? `recipient_id ${message.recipientId}` : "",
    `message_id ${message.id}`,
  ].filter(Boolean).join("; ");
  const existingJob = await readReplyJobByDedupeKeyFromDatabase(messageKey);
  if (existingJob?.status === "sent") return "skipped";
  const dedupe = await claimEventDedupeInDatabase({
    dedupeKey: messageKey,
    channel: message.channel,
    provider: message.channel === "messenger" ? "facebook" : message.channel,
    providerMessageId: message.id,
    threadRef,
    metadata: { connectionId: connection.id, accountLabel: message.accountLabel },
  });
  const replyJob = await upsertReplyJobInDatabase({
    dedupeKey: messageKey,
    channel: message.channel,
    provider: FALLBACK_SOURCE,
    threadRef,
    contactRef: message.senderId,
    status: dedupe.inserted ? "fallback_active" : "duplicate_suppressed",
    mediaJson: media,
    metadata: { connectionId: connection.id, providerMessageId: message.id, fallback: true, primaryProvider: "meta_direct" },
  });

  const duplicate = await conversationEventMessageIdExists(messageKey);
  if (!duplicate) {
    await writeRequestAuditEvent({
      route: "/api/social/composio/poll",
      method: "POST",
      channel: message.channel,
      provider: FALLBACK_SOURCE,
      threadRef,
      contactRef: message.senderId,
      providerMessageId: message.id,
      stage: "fallback_ingest",
      outcome: "fallback_active",
      statusCode: 200,
      metadata: {
        connectionId: connection.id,
        accountLabel: message.accountLabel,
        directMetaMissed: true,
        mediaCount: media.length,
      },
    });
  }
  const result = duplicate
    ? null
    : await recordChannelInteraction({
      channel: message.channel,
      direction: "inbound",
      eventAt: message.createdTime || undefined,
      agentName: IRIS_AGENT_NAME,
      phone: message.senderId,
      fullName: message.senderUsername || message.senderName,
      source: FALLBACK_SOURCE,
      sourceDetail,
      threadRef,
      eventType: `${message.channel}_inbound`,
      messageText,
      summary: `Inbound ${message.channel} DM: ${messageText}`,
      preferredChannel: message.channel,
      intent: guard.intent,
      aiAction: guard.allowed ? "fallback_ingested" : "fallback_handoff",
      handoffStatus: guard.needsHuman ? "needs_human" : "",
      handoffReason: guard.reason,
      nextAction: guard.allowed ? "reply_with_iris" : "human_follow_up",
      status: guard.allowed ? "fallback_active" : "needs_human",
      gmailMessageId: messageKey,
      providerMessageId: message.id,
      providerThreadId: message.conversationId,
      mediaJson: media,
      providerMetadata: {
        connectionId: connection.id,
        fallback: true,
        primaryProvider: "meta_direct",
        senderId: message.senderId,
        senderName: message.senderName,
        senderUsername: message.senderUsername,
        recipientId: message.recipientId,
        accountLabel: message.accountLabel,
      },
      replyJobId: replyJob?.id || "",
    });

  if (!socialDmAgentEnabled()) {
    await upsertReplyJobInDatabase({
      dedupeKey: messageKey,
      channel: message.channel,
      provider: FALLBACK_SOURCE,
      threadRef,
      contactRef: message.senderId,
      status: "agent_disabled",
      nextAction: "human_review",
    });
    return duplicate ? "skipped" : "imported";
  }

  const settings = await readInboxSettingsFromDatabase();
  if (!guard.allowed || !channelEnabled(settings, message.channel) || await isTakeoverActive(threadRef, message.channel)) {
    await upsertReplyJobInDatabase({
      dedupeKey: messageKey,
      channel: message.channel,
      provider: FALLBACK_SOURCE,
      threadRef,
      contactRef: message.senderId,
      status: guard.allowed ? "blocked" : "needs_human",
      error: guard.allowed ? "Channel disabled or active human takeover." : guard.reason,
      nextAction: "human_review",
    });
    return duplicate ? "skipped" : "imported";
  }

  const recentEvents = await readEventsForThreadOrContactFromDatabase({
    threadRef,
    channel: message.channel,
    limit: 12,
  });
  if (duplicate && alreadyHandledInbound(messageKey, recentEvents)) {
    return "skipped";
  }
  const lead = await findLeadInDatabase({ full_name: message.senderName });
  const properties = await findComposioSocialProperties(messageText, recentEvents);
  const enriched = await enrichTheoData({
    message: messageText,
    lead: lead || result?.lead,
    properties,
  });
  const reply = await generateTheoReply({
    message: messageText,
    lead: lead || result?.lead,
    properties: enriched.properties,
    recentEvents,
    source: message.channel,
    dataContext: enriched.context,
    styleContext: await fetchStyleContext(),
  });
  const routeResult = buildSocialRouterResult({
    channel: message.channel,
    threadRef,
    guard,
    reply,
    reason: reply.handoffReason,
  });
  if (!routeResult.should_send || !shouldAutoSendForChannel(settings, message.channel)) {
    await upsertReplyJobInDatabase({
      dedupeKey: messageKey,
      channel: message.channel,
      provider: FALLBACK_SOURCE,
      threadRef,
      contactRef: message.senderId,
      status: routeResult.needs_human ? "needs_human" : "review_ready",
      modelClassify: "claude-3-5-haiku",
      modelReply: "claude-sonnet-4-6",
      replyText: routeResult.reply,
      nextAction: "human_review",
      metadata: { reason: routeResult.reason || "", fallback: true, primaryProvider: "meta_direct" },
    });
    await recordChannelInteraction({
      channel: message.channel,
      direction: "outbound",
      agentName: IRIS_AGENT_NAME,
      phone: message.senderId,
      fullName: message.senderUsername || message.senderName,
      source: FALLBACK_SOURCE,
      sourceDetail,
      threadRef,
      eventType: `${message.channel}_reply_ready`,
      messageText: routeResult.reply,
      summary: routeResult.reason || "Iris prepared a social DM reply through Composio fallback.",
      aiAction: "fallback_reply_ready",
      status: routeResult.needs_human ? "needs_human" : "review_ready",
      handoffReason: routeResult.reason,
      nextAction: "human_review",
    });
    return "imported";
  }

  const sendResult = await sendComposioSocialMessage({
    channel: message.channel as ComposioSocialChannel,
    to: message.senderId,
    body: routeResult.reply,
    mediaUrls: routeResult.media_urls,
    threadRef,
  });
  await upsertReplyJobInDatabase({
    dedupeKey: messageKey,
    channel: message.channel,
    provider: FALLBACK_SOURCE,
    threadRef,
    contactRef: message.senderId,
    status: sendResult.ok ? "sent" : "send_failed",
    modelClassify: "claude-3-5-haiku",
    modelReply: "claude-sonnet-4-6",
    replyText: routeResult.reply,
    error: sendResult.ok ? "" : sendResult.error,
    nextAction: sendResult.ok ? "monitor_reply" : "human_review",
    metadata: { fallback: true, primaryProvider: "meta_direct" },
  });
  await writeRequestAuditEvent({
    route: "/api/social/composio/poll",
    method: "POST",
    channel: message.channel,
    provider: FALLBACK_SOURCE,
    threadRef,
    contactRef: message.senderId,
    providerMessageId: message.id,
    stage: "fallback_send",
    outcome: sendResult.ok ? "sent" : "failed",
    statusCode: sendResult.ok ? 200 : 502,
    errorCode: sendResult.ok ? "" : "fallback_send_failed",
    errorMessage: sendResult.ok ? "" : sendResult.error,
    metadata: {
      connectionId: connection.id,
      mediaCount: routeResult.media_urls.length,
      primaryProvider: "meta_direct",
    },
  });
  await recordChannelInteraction({
    channel: message.channel,
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    phone: message.senderId,
    fullName: message.senderUsername || message.senderName,
    source: FALLBACK_SOURCE,
    sourceDetail,
    threadRef,
    eventType: `${message.channel}_ai_reply`,
    messageText: routeResult.reply,
    summary: sendResult.ok ? "Iris replied to social DM through Composio fallback." : `Composio fallback send failed: ${sendResult.error}`,
    aiAction: sendResult.ok ? "fallback_sent" : "fallback_send_failed",
    status: sendResult.ok ? "sent" : "needs_human",
    handoffReason: sendResult.ok ? "" : sendResult.error,
    nextAction: sendResult.ok ? "monitor_reply" : "human_follow_up",
  });

  return sendResult.ok ? "replied" : "imported";
}

export async function pollComposioSocial(input: {
  userEmail: string;
  channels?: PollChannel[];
  limit?: number;
  sinceMinutes?: number;
}): Promise<ComposioSocialPollResult> {
  const result: ComposioSocialPollResult = { ok: true, checked: 0, imported: 0, replied: 0, skipped: 0, errors: [] };
  const fallbackUserId = composioExternalUserId(input.userEmail);
  const requestedChannels: PollChannel[] = input.channels?.length ? input.channels : ["instagram", "messenger"];
  const channels = new Set<PollChannel>(
    requestedChannels.filter((channel) => !metaSocialDirectEnabled(channel)),
  );
  if (!channels.size) {
    return result;
  }
  const limit = Math.max(1, Math.min(input.limit || 10, 50));
  const sinceMinutes = Math.max(1, Math.min(input.sinceMinutes || Number(process.env.COMPOSIO_SOCIAL_POLL_LOOKBACK_MINUTES || 360), 60 * 24 * 30));
  const sinceMs = Date.now() - sinceMinutes * 60 * 1000;
  const status = await listChannelConnections();
  const connections = status.connections
    .filter((connection) =>
      connection.status === "connected"
      && connection.connected_account_id
      && (
        (channels.has("instagram") && connection.channel === "instagram" && connection.provider === "composio_instagram")
        || (channels.has("messenger") && connection.channel === "messenger" && connection.provider === "composio_facebook")
      )
    )
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

  for (const connection of connections) {
    try {
      const userId = connection.external_user_id || fallbackUserId;
      const messages = connection.channel === "instagram"
        ? await instagramMessages(userId, connection, limit)
        : await messengerMessages(userId, connection, limit);
      for (const message of messages.sort((a, b) => Date.parse(a.createdTime || "") - Date.parse(b.createdTime || ""))) {
        result.checked += 1;
        const createdAt = Date.parse(message.createdTime || "");
        if (Number.isFinite(createdAt) && createdAt < sinceMs) {
          result.skipped += 1;
          continue;
        }
        const action = await processMessage(message, connection);
        if (action === "replied") result.replied += 1;
        else if (action === "imported") result.imported += 1;
        else result.skipped += 1;
      }
    } catch (error) {
      result.ok = false;
      result.errors.push(`${connection.channel}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
