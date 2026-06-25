import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { listChannelConnections } from "@/lib/channelConnections";
import {
  claimEventDedupeInDatabase,
  conversationEventMessageIdExists,
  findCandidatePropertiesFromDatabase,
  findLeadInDatabase,
  findPropertiesByAddressesFromDatabase,
  readEventsForThreadFromDatabase,
  readEventsForThreadOrContactFromDatabase,
  readInboxSettingsFromDatabase,
  readReplyJobByDedupeKeyFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { deepgramAudioEnabled, transcribeDeepgramAudio } from "@/lib/deepgramAudio";
import { fetchStyleContext } from "@/lib/styleTraining";
import { generateTheoReply } from "@/lib/theoAgent";
import { enrichTheoData, extractTheoListedPropertyAddresses, extractTheoPropertySearchIntent, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import {
  buildSocialRouterResult,
  shouldTheoHandleSocialDm,
  socialDmAgentEnabled,
  type SocialDmPayload,
} from "@/lib/manychatSocial";
import {
  extractMetaSocialMessages,
  metaSocialDirectEnabled,
  metaSocialVerifyToken,
  normalizeMetaMessage,
  resolvePageAccessToken,
  sendMetaSocialMessage,
  verifyMetaSocialSignature,
  type MetaSocialChannel,
} from "@/lib/metaSocial";
import { isMediaTranscribable, normalizedMessageText, type OmnichannelMedia } from "@/lib/omnichannelEvents";

export const dynamic = "force-dynamic";

function stringMap(values: Array<string | undefined>): Set<string> {
  return new Set(values.map((value) => String(value || "").trim()).filter(Boolean));
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
    eventDateValue(event.event_at || event.created_at || "") > inboundAt,
  );
}

function socialPayloadFromMessage(input: {
  channel: MetaSocialChannel;
  senderId: string;
  senderName: string;
  senderUsername: string;
  messageText: string;
}): SocialDmPayload {
  return {
    channel: input.channel,
    messageText: input.messageText,
    contactId: input.senderId,
    threadId: input.senderId,
    senderName: input.senderName,
    senderUsername: input.senderUsername,
    accountLabel: input.channel === "instagram" ? "Instagram" : "Messenger",
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  };
}

async function findSocialProperties(message: string, recentEvents: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>) {
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

function filenameFromMedia(media: OmnichannelMedia, index: number): string {
  const fromUrl = media.url ? media.url.split(/[/?#]/).filter(Boolean).at(-1) : "";
  const candidate = media.filename || fromUrl || `meta-social-${index}`;
  return candidate.includes(".") ? candidate : `${candidate}.${media.type === "video" ? "mp4" : "mp3"}`;
}

async function transcribeMedia(media: OmnichannelMedia, index: number): Promise<OmnichannelMedia> {
  if (!deepgramAudioEnabled() || !media.url || !isMediaTranscribable(media)) return media;
  try {
    const response = await fetch(media.url);
    if (!response.ok) return media;
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
  } catch {
    return media;
  }
}

async function transcribeMediaItems(media: OmnichannelMedia[]): Promise<OmnichannelMedia[]> {
  const next: OmnichannelMedia[] = [];
  for (let index = 0; index < media.length; index += 1) {
    next.push(await transcribeMedia(media[index], index));
  }
  return next;
}

async function processInbound(input: {
  channel: MetaSocialChannel;
  senderId: string;
  senderName: string;
  senderUsername: string;
  recipientId: string;
  messageId: string;
  createdTime: string;
  text: string;
  media: OmnichannelMedia[];
  pageAccessToken?: string;
}) {
  const messageKey = `${input.channel}:${input.messageId}`;
  const threadRef = `${input.channel}:${input.senderId}`;
  const messageText = normalizedMessageText({ text: input.text, media: input.media });
  if (!messageText) return "skipped" as const;

  const payload = socialPayloadFromMessage({
    channel: input.channel,
    senderId: input.senderId,
    senderName: input.senderName,
    senderUsername: input.senderUsername,
    messageText,
  });
  const guard = shouldTheoHandleSocialDm(payload);
  const existingJob = await readReplyJobByDedupeKeyFromDatabase(messageKey);
  if (existingJob?.status === "sent") return "skipped" as const;

  const dedupe = await claimEventDedupeInDatabase({
    dedupeKey: messageKey,
    channel: input.channel,
    provider: "meta_social",
    providerMessageId: input.messageId,
    threadRef,
    metadata: { recipientId: input.recipientId },
  });
  const replyJob = await upsertReplyJobInDatabase({
    dedupeKey: messageKey,
    channel: input.channel,
    provider: "meta_social",
    threadRef,
    contactRef: input.senderId,
    status: dedupe.inserted ? "received" : "duplicate_suppressed",
    mediaJson: input.media,
    metadata: { providerMessageId: input.messageId, recipientId: input.recipientId },
  });

  const duplicate = await conversationEventMessageIdExists(messageKey);
  const result = duplicate
    ? null
    : await recordChannelInteraction({
      channel: input.channel,
      direction: "inbound",
      eventAt: input.createdTime || undefined,
      agentName: IRIS_AGENT_NAME,
      phone: input.senderId,
      fullName: input.senderUsername || input.senderName,
      source: "meta_social",
      sourceDetail: `recipient_id ${input.recipientId}; message_id ${input.messageId}`,
      threadRef,
      eventType: `${input.channel}_inbound`,
      messageText,
      summary: `Inbound ${input.channel} DM: ${messageText}`,
      preferredChannel: input.channel,
      intent: guard.intent,
      aiAction: guard.allowed ? "social_dm_routed" : "social_dm_handoff",
      handoffStatus: guard.needsHuman ? "needs_human" : "",
      handoffReason: guard.reason,
      nextAction: guard.allowed ? "reply_with_iris" : "human_follow_up",
      status: guard.allowed ? "received" : "needs_human",
      gmailMessageId: messageKey,
      providerMessageId: input.messageId,
      providerThreadId: threadRef,
      mediaJson: input.media,
      providerMetadata: {
        senderId: input.senderId,
        senderName: input.senderName,
        senderUsername: input.senderUsername,
        recipientId: input.recipientId,
      },
      replyJobId: replyJob?.id || "",
    });

  if (!socialDmAgentEnabled()) {
    await upsertReplyJobInDatabase({
      dedupeKey: messageKey,
      channel: input.channel,
      provider: "meta_social",
      threadRef,
      contactRef: input.senderId,
      status: "agent_disabled",
      nextAction: "human_review",
    });
    return duplicate ? "skipped" as const : "imported" as const;
  }

  const settings = await readInboxSettingsFromDatabase();
  if (!guard.allowed || !channelEnabled(settings, input.channel) || await isTakeoverActive(threadRef)) {
    await upsertReplyJobInDatabase({
      dedupeKey: messageKey,
      channel: input.channel,
      provider: "meta_social",
      threadRef,
      contactRef: input.senderId,
      status: guard.allowed ? "blocked" : "needs_human",
      error: guard.allowed ? "Channel disabled or active human takeover." : guard.reason,
      nextAction: "human_review",
    });
    return duplicate ? "skipped" as const : "imported" as const;
  }

  const recentEvents = await readEventsForThreadOrContactFromDatabase({
    threadRef,
    channel: input.channel,
    limit: 12,
  });
  if (duplicate && alreadyHandledInbound(messageKey, recentEvents)) {
    return "skipped" as const;
  }

  const lead = await findLeadInDatabase({ full_name: input.senderName });
  const properties = await findSocialProperties(messageText, recentEvents);
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
    source: input.channel,
    dataContext: enriched.context,
    styleContext: await fetchStyleContext(),
  });
  const routeResult = buildSocialRouterResult({
    channel: input.channel,
    threadRef,
    guard,
    reply,
    reason: reply.handoffReason,
  });

  if (!routeResult.should_send || !shouldAutoSendForChannel(settings, input.channel)) {
    await upsertReplyJobInDatabase({
      dedupeKey: messageKey,
      channel: input.channel,
      provider: "meta_social",
      threadRef,
      contactRef: input.senderId,
      status: routeResult.needs_human ? "needs_human" : "review_ready",
      modelClassify: "claude-3-5-haiku",
      modelReply: "claude-sonnet-4-6",
      replyText: routeResult.reply,
      nextAction: "human_review",
      metadata: { reason: routeResult.reason || "" },
    });
    await recordChannelInteraction({
      channel: input.channel,
      direction: "outbound",
      agentName: IRIS_AGENT_NAME,
      phone: input.senderId,
      fullName: input.senderUsername || input.senderName,
      source: "meta_social",
      sourceDetail: `recipient_id ${input.recipientId}; message_id ${input.messageId}`,
      threadRef,
      eventType: `${input.channel}_reply_ready`,
      messageText: routeResult.reply,
      summary: routeResult.reason || "Iris prepared a social DM reply.",
      aiAction: "social_dm_reply_ready",
      status: routeResult.needs_human ? "needs_human" : "review_ready",
      handoffReason: routeResult.reason,
      nextAction: "human_review",
    });
    return "imported" as const;
  }

  const sendResult = await sendMetaSocialMessage({
    channel: input.channel,
    to: input.senderId,
    body: routeResult.reply,
    mediaUrls: routeResult.media_urls,
    pageAccessToken: input.pageAccessToken,
  });
  await upsertReplyJobInDatabase({
    dedupeKey: messageKey,
    channel: input.channel,
    provider: "meta_social",
    threadRef,
    contactRef: input.senderId,
    status: sendResult.sent ? "sent" : "send_failed",
    modelClassify: "claude-3-5-haiku",
    modelReply: "claude-sonnet-4-6",
    replyText: routeResult.reply,
    error: sendResult.sent ? "" : sendResult.error,
    nextAction: sendResult.sent ? "monitor_reply" : "human_review",
  });
  await recordChannelInteraction({
    channel: input.channel,
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    phone: input.senderId,
    fullName: input.senderUsername || input.senderName,
    source: "meta_social",
    sourceDetail: `recipient_id ${input.recipientId}; message_id ${input.messageId}`,
    threadRef,
    eventType: `${input.channel}_ai_reply`,
    messageText: sendResult.deliveredBody,
    summary: sendResult.sent ? "Iris replied to social DM through Meta webhook/send." : `Meta social send failed: ${sendResult.error}`,
    aiAction: sendResult.sent ? "social_dm_sent" : "social_dm_send_failed",
    status: sendResult.sent ? "sent" : "needs_human",
    handoffReason: sendResult.sent ? "" : sendResult.error,
    nextAction: sendResult.sent ? "monitor_reply" : "human_follow_up",
  });

  return sendResult.sent ? "replied" as const : "imported" as const;
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode") || "";
  const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  const expected = metaSocialVerifyToken();
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Invalid Meta social verify token" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!metaSocialDirectEnabled()) {
    return NextResponse.json({ ok: false, error: "Meta social direct webhook mode is disabled" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyMetaSocialSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false, error: "Invalid Meta signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  const connections = await listChannelConnections();
  const instagramIds = stringMap(
    connections.connections
      .filter((connection) => connection.channel === "instagram")
      .flatMap((connection) => [
        connection.selected_asset_id,
        String(connection.metadata?.instagram_user_id || ""),
        String(connection.metadata?.page_id || ""),
      ]),
  );
  const messengerIds = stringMap(
    connections.connections
      .filter((connection) => connection.channel === "messenger")
      .flatMap((connection) => [
        connection.selected_asset_id,
        String(connection.metadata?.page_id || ""),
      ]),
  );

  const inboundMessages = extractMetaSocialMessages(payload, { instagramIds, messengerIds });
  const results: Array<Record<string, unknown>> = [];
  for (const inbound of inboundMessages) {
    const connection = connections.connections.find((candidate) => {
      if (candidate.channel !== inbound.channel) return false;
      const ids = stringMap([
        candidate.selected_asset_id,
        String(candidate.metadata?.page_id || ""),
        String(candidate.metadata?.instagram_user_id || ""),
      ]);
      return ids.has(inbound.recipientId) || ids.has(inbound.entryId);
    });
    // Derive normalized type for logging; skip reactions and read receipts.
    const rawEvent = payload as Record<string, unknown>;
    const normalized = normalizeMetaMessage(
      { sender: { id: inbound.senderId }, message: { text: inbound.text }, ...rawEvent },
      inbound.recipientId,
    );
    const msgType = normalized?.type ?? "text";
    if (msgType === "reaction" || msgType === "read_receipt") {
      results.push({ message_id: inbound.messageId, channel: inbound.channel, action: "skipped", type: msgType });
      continue;
    }
    const media = await transcribeMediaItems(inbound.media || []);
    const action = await processInbound({ ...inbound, media, pageAccessToken: resolvePageAccessToken(connection) });
    results.push({
      message_id: inbound.messageId,
      channel: inbound.channel,
      action,
      type: msgType,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
