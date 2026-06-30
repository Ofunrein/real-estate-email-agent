import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { listChannelConnections } from "@/lib/channelConnections";
import {
  claimEventDedupeInDatabase,
  conversationEventMessageIdExists,
  findLeadInDatabase,
  findPropertiesByAddressesFromDatabase,
  findSocialBrowserThreadByUsernameFromDatabase,
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
import { createRequestAudit } from "@/lib/requestAudit";
import { understandMediaItems } from "@/lib/mediaUnderstanding";
import {
  buildSocialRouterResult,
  shouldTheoHandleDirectMetaDm,
  socialDmAgentEnabled,
  type SocialDmPayload,
} from "@/lib/manychatSocial";
import {
  extractMetaSocialMessages,
  fetchMetaSocialSenderProfile,
  metaSocialDirectEnabled,
  metaSocialVerifyToken,
  normalizeMetaMessage,
  resolvePageAccessToken,
  sendMetaSocialMessage,
  verifyMetaSocialSignature,
  type MetaSocialChannel,
} from "@/lib/metaSocial";
import { isMediaTranscribable, normalizedMessageText, type OmnichannelMedia } from "@/lib/omnichannelEvents";
import { retrievePropertiesForAgent } from "@/lib/propertyRetrieval";

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

function normalizeFollowupText(message = ""): string {
  return message
    .replace(/\boptiosn\b/gi, "options")
    .replace(/\boptoins\b/gi, "options")
    .replace(/\boptons\b/gi, "options")
    .replace(/\bsimiliar\b/gi, "similar")
    .replace(/\bsimliar\b/gi, "similar")
    .replace(/\bmroe\b/gi, "more")
    .replace(/\bdetials\b/gi, "details");
}

function referencesPriorProperties(message = ""): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(those|that|these|them|it|links?|urls?|photos?|pictures?|similar|same spec|same specs|neighboring|neighbor|nearby|next to|close by|comparable|alternatives?|other options?|amenit(?:y|ies)|features?|details?|property you just sent|listing you just sent|one you just sent|for the property|for that property|for this property)\b/i.test(normalized);
}

function wantsRelatedProperties(message = ""): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(similar|same spec|same specs|same size|same price|neighboring|neighbor|nearby|next to|close by|close to (?:the )?(?:\d+\s*)?(?:bed|bd|bedroom|layout)|\d+\s*(?:bed|bd|bedroom).{0,40}layout|something close|comparable|alternatives?|other options?|cheaper|lower price|less expensive|more affordable|more expensive|higher price|bigger|larger|smaller|more bedrooms?|more baths?)\b/i.test(normalized);
}

function rejectsPriorProperty(message = ""): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(?:no longer|not)\s+interested\b/i.test(normalized)
    || /\b(?:don't|dont|do not)\s+(?:like|want)\b/i.test(normalized)
    || /\bnot\s+(?:this|that)\s+(?:one|property|listing)\b/i.test(normalized)
    || /\b(?:send|show|find|share)\s+(?:me\s+)?another\s+(?:one|option|property|listing)?\b/i.test(normalized)
    || /\banother\s+(?:one|option|property|listing)\b/i.test(normalized);
}

function webhookEventSummaries(payload: Record<string, unknown>) {
  const summaries: Array<Record<string, unknown>> = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const entryRecord = entry as Record<string, unknown>;
    const entryId = String(entryRecord.id || "").trim();
    const appendMessaging = (event: Record<string, unknown>, source: string, field?: string) => {
      const sender = event.sender && typeof event.sender === "object" && !Array.isArray(event.sender)
        ? event.sender as Record<string, unknown>
        : event.from && typeof event.from === "object" && !Array.isArray(event.from)
          ? event.from as Record<string, unknown>
          : {};
      const recipient = event.recipient && typeof event.recipient === "object" && !Array.isArray(event.recipient)
        ? event.recipient as Record<string, unknown>
        : event.to && typeof event.to === "object" && !Array.isArray(event.to)
          ? event.to as Record<string, unknown>
          : {};
      const message = event.message && typeof event.message === "object" && !Array.isArray(event.message)
        ? event.message as Record<string, unknown>
        : {};
      const reaction = event.reaction && typeof event.reaction === "object" && !Array.isArray(event.reaction)
        ? event.reaction as Record<string, unknown>
        : {};
      summaries.push({
        source,
        field: field || "",
        entryId,
        keys: Object.keys(event).sort(),
        senderId: String(sender.id || ""),
        recipientId: String(recipient.id || ""),
        messageId: String(message.mid || message.id || event.mid || event.id || reaction.mid || ""),
        hasText: Boolean(message.text || event.text),
        attachmentCount: Array.isArray(message.attachments) ? message.attachments.length : Array.isArray(event.attachments) ? event.attachments.length : 0,
        hasReaction: Boolean(reaction.mid || reaction.emoji),
        isEcho: message.is_echo === true || event.message_echo === true,
        hasRead: Boolean(event.read),
        timestamp: event.timestamp || message.timestamp || "",
      });
    };
    for (const messaging of Array.isArray(entryRecord.messaging) ? entryRecord.messaging : []) {
      if (messaging && typeof messaging === "object" && !Array.isArray(messaging)) {
        appendMessaging(messaging as Record<string, unknown>, "entry.messaging");
      }
    }
    for (const change of Array.isArray(entryRecord.changes) ? entryRecord.changes : []) {
      if (!change || typeof change !== "object" || Array.isArray(change)) continue;
      const changeRecord = change as Record<string, unknown>;
      const value = changeRecord.value && typeof changeRecord.value === "object" && !Array.isArray(changeRecord.value)
        ? changeRecord.value as Record<string, unknown>
        : {};
      for (const messaging of Array.isArray(value.messaging) ? value.messaging : []) {
        if (messaging && typeof messaging === "object" && !Array.isArray(messaging)) {
          appendMessaging(messaging as Record<string, unknown>, "entry.changes.messaging", String(changeRecord.field || ""));
        }
      }
      if (!Array.isArray(value.messaging)) {
        summaries.push({
          source: "entry.changes",
          field: String(changeRecord.field || ""),
          entryId,
          keys: Object.keys(value).sort(),
        });
      }
    }
  }
  return summaries.slice(0, 20);
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

function socialContactKey(threadRef: string, fallback: string): string {
  const separator = threadRef.indexOf(":");
  if (separator >= 0 && threadRef.slice(separator + 1).trim()) {
    return threadRef.slice(separator + 1).trim();
  }
  return fallback;
}

function opaqueMetaId(value: string) {
  return /^\d{12,}$/.test(value.trim().replace(/^@/, ""));
}

async function resolveInboundIdentity(input: {
  channel: MetaSocialChannel;
  senderId: string;
  senderName: string;
  senderUsername: string;
  pageAccessToken?: string;
}) {
  const fallbackThreadRef = `${input.channel}:${input.senderId}`;
  const profile = await fetchMetaSocialSenderProfile(input.channel, input.senderId, input.pageAccessToken).catch(() => null);
  const senderUsername = profile?.username || (!opaqueMetaId(input.senderUsername) ? input.senderUsername : "");
  const senderName = profile?.name || (!opaqueMetaId(input.senderName) ? input.senderName : "") || senderUsername || input.senderId;
  const browserThread = senderUsername
    ? await findSocialBrowserThreadByUsernameFromDatabase({
      channel: input.channel,
      username: senderUsername,
    }).catch(() => null)
    : null;
  const threadRef = browserThread?.threadRef || fallbackThreadRef;
  return {
    senderName,
    senderUsername: senderUsername || senderName,
    profile,
    threadRef,
    webhookThreadRef: fallbackThreadRef,
    contactKey: input.senderId,
    displayName: browserThread?.displayName || (senderUsername ? `@${senderUsername.replace(/^@/, "")}` : senderName),
  };
}

async function findSocialProperties(message: string, recentEvents: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>) {
  const previousOutbound = recentEvents
    .filter((event) => event.direction !== "inbound")
    .map((event) => event.message_text || event.summary || "")
    .filter(Boolean);
  const rejectedPriorProperty = rejectsPriorProperty(message);
  const priorAddresses = referencesPriorProperties(message) || wantsRelatedProperties(message) || rejectedPriorProperty
    ? extractTheoListedPropertyAddresses(...previousOutbound)
    : [];
  const requestedAddresses = extractTheoListedPropertyAddresses(message);
  const exactAddresses = [...requestedAddresses, ...priorAddresses];
  const addressMatches = rejectedPriorProperty ? [] : await findPropertiesByAddressesFromDatabase(exactAddresses, 5);
  const propertySearch = extractTheoPropertySearchIntent(message);
  const propertyQuery = extractTheoPropertySearchQuery(message);
  const shouldSearch = Boolean(
    rejectedPriorProperty ||
    propertyQuery ||
    propertySearch.area ||
    propertySearch.beds ||
    propertySearch.baths ||
    propertySearch.minPrice ||
    propertySearch.maxPrice ||
    propertySearch.mode !== "general",
  );
  const candidateMatches = shouldSearch
    ? await retrievePropertiesForAgent(
      {
        query: propertyQuery,
        area: propertySearch.area,
        beds: propertySearch.beds,
        baths: propertySearch.baths,
        minPrice: propertySearch.minPrice,
        maxPrice: propertySearch.maxPrice,
        mode: rejectedPriorProperty && propertySearch.mode === "general" ? "similar" : propertySearch.mode,
        reference: priorAddresses[0] ? { address: priorAddresses[0] } : undefined,
        excludeAddresses: [
          ...addressMatches.map((property) => property.address).filter(Boolean),
          ...exactAddresses,
        ].filter(Boolean),
      },
      5,
      { channel: "social" },
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
  const identity = await resolveInboundIdentity(input);
  const threadRef = identity.threadRef;
  // Use media fallback so attachment-only DMs still get stored — without a conversation
  // event the senderId is never persisted and the thread becomes un-repliable.
  const messageText = normalizedMessageText({ text: input.text, media: input.media })
    || (input.media.length > 0 ? `[${input.media[0]?.type || "attachment"}]` : "");
  if (!messageText) return "skipped" as const;

  const payload = socialPayloadFromMessage({
    channel: input.channel,
    senderId: input.senderId,
    senderName: identity.senderName,
    senderUsername: identity.senderUsername,
    messageText,
  });
  const guard = shouldTheoHandleDirectMetaDm(payload);
  const existingJob = await readReplyJobByDedupeKeyFromDatabase(messageKey);
  if (existingJob?.status === "sent") return "skipped" as const;

  const dedupe = await claimEventDedupeInDatabase({
    dedupeKey: messageKey,
    channel: input.channel,
    provider: "meta_social",
    providerMessageId: input.messageId,
    threadRef,
    metadata: { recipientId: input.recipientId, webhookThreadRef: identity.webhookThreadRef },
  });
  const replyJob = await upsertReplyJobInDatabase({
    dedupeKey: messageKey,
    channel: input.channel,
    provider: "meta_social",
    threadRef,
    contactRef: input.senderId,
    status: dedupe.inserted ? "received" : "duplicate_suppressed",
    mediaJson: input.media,
    metadata: { providerMessageId: input.messageId, recipientId: input.recipientId, webhookThreadRef: identity.webhookThreadRef },
  });

  const duplicate = await conversationEventMessageIdExists(messageKey);
  const result = duplicate
    ? null
    : await recordChannelInteraction({
      channel: input.channel,
      direction: "inbound",
      eventAt: input.createdTime || undefined,
      agentName: IRIS_AGENT_NAME,
      phone: identity.contactKey,
      fullName: identity.displayName,
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
        senderName: identity.senderName,
        senderUsername: identity.senderUsername,
        recipientId: input.recipientId,
        profilePic: identity.profile?.profilePic || "",
        webhookThreadRef: identity.webhookThreadRef,
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

  const lead = await findLeadInDatabase({ full_name: identity.senderName });
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
      phone: identity.contactKey,
      fullName: identity.displayName,
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
    phone: identity.contactKey,
    fullName: identity.displayName,
    source: "meta_social",
    sourceDetail: `recipient_id ${input.recipientId}; message_id ${input.messageId}`,
    threadRef,
    eventType: routeResult.needs_human ? `${input.channel}_handoff_reply` : `${input.channel}_ai_reply`,
    messageText: sendResult.deliveredBody,
    summary: sendResult.sent ? "Iris replied to social DM through Meta webhook/send." : `Meta social send failed: ${sendResult.error}`,
    aiAction: sendResult.sent ? "social_dm_sent" : "social_dm_send_failed",
    status: sendResult.sent ? "sent" : "needs_human",
    handoffReason: sendResult.sent ? routeResult.reason : sendResult.error,
    handoffStatus: sendResult.sent && routeResult.needs_human ? "needs_human" : "",
    nextAction: sendResult.sent ? routeResult.needs_human ? "human_follow_up" : "monitor_reply" : "human_follow_up",
  });

  return sendResult.sent ? "replied" as const : "imported" as const;
}

async function processOutboundEcho(input: {
  channel: MetaSocialChannel;
  senderId: string;
  recipientId: string;
  messageId: string;
  createdTime: string;
  text: string;
  media: OmnichannelMedia[];
  pageAccessToken?: string;
}) {
  const contactId = input.recipientId || input.senderId;
  const messageKey = `${input.channel}:${input.messageId}`;
  const identity = await resolveInboundIdentity({
    channel: input.channel,
    senderId: contactId,
    senderName: contactId,
    senderUsername: contactId,
    pageAccessToken: input.pageAccessToken,
  });
  const messageText = normalizedMessageText({ text: input.text, media: input.media })
    || (input.media.length > 0 ? `[${input.media[0]?.type || "attachment"}]` : "");
  if (!messageText) return "skipped" as const;
  if (await conversationEventMessageIdExists(messageKey)) return "skipped" as const;
  await claimEventDedupeInDatabase({
    dedupeKey: messageKey,
    channel: input.channel,
    provider: "meta_social_echo",
    providerMessageId: input.messageId,
    threadRef: identity.threadRef,
    metadata: { recipientId: input.recipientId, senderId: input.senderId, webhookThreadRef: identity.webhookThreadRef },
  });
  await recordChannelInteraction({
    channel: input.channel,
    direction: "outbound",
    eventAt: input.createdTime || undefined,
    agentName: "Owner",
    phone: identity.contactKey,
    fullName: identity.displayName,
    source: "meta_social_echo",
    sourceDetail: `platform_sender_id ${input.senderId}; recipient_id ${input.recipientId}; message_id ${input.messageId}`,
    threadRef: identity.threadRef,
    eventType: `${input.channel}_platform_echo`,
    messageText,
    summary: `Owner sent ${input.channel} DM from the native platform.`,
    status: "sent",
    gmailMessageId: messageKey,
    providerMessageId: input.messageId,
    providerThreadId: identity.threadRef,
    mediaJson: input.media,
    providerMetadata: {
      senderId: contactId,
      platformSenderId: input.senderId,
      recipientId: input.recipientId,
      isEcho: true,
      webhookThreadRef: identity.webhookThreadRef,
    },
  });
  return "imported_echo" as const;
}

async function processReaction(input: {
  channel: MetaSocialChannel;
  senderId: string;
  recipientId: string;
  createdTime: string;
  normalized: NonNullable<ReturnType<typeof normalizeMetaMessage>>;
  isOwnerAction: boolean;
  pageAccessToken?: string;
}) {
  const targetMessageId = input.normalized.reactionTargetMessageId || "";
  if (!targetMessageId) return "skipped" as const;
  const contactId = input.isOwnerAction ? input.recipientId : input.senderId;
  const identity = await resolveInboundIdentity({
    channel: input.channel,
    senderId: contactId,
    senderName: contactId,
    senderUsername: contactId,
    pageAccessToken: input.pageAccessToken,
  });
  const action = input.normalized.reactionAction || "react";
  const emoji = input.normalized.reactionEmoji || "";
  const messageKey = `${input.channel}:reaction:${targetMessageId}:${input.senderId}:${input.normalized.timestamp}`;
  if (await conversationEventMessageIdExists(messageKey)) return "skipped" as const;
  await recordChannelInteraction({
    channel: input.channel,
    direction: input.isOwnerAction ? "outbound" : "inbound",
    eventAt: input.createdTime || undefined,
    agentName: input.isOwnerAction ? "Owner" : IRIS_AGENT_NAME,
    phone: identity.contactKey,
    fullName: identity.displayName,
    source: "meta_social",
    sourceDetail: `reaction_to ${targetMessageId}; sender_id ${input.senderId}`,
    threadRef: identity.threadRef,
    eventType: `${input.channel}_reaction`,
    messageText: action === "unreact" ? "Reaction removed" : `Reaction: ${emoji || "love"}`,
    summary: `${input.isOwnerAction ? "Owner" : "Contact"} ${action === "unreact" ? "removed a reaction" : "reacted"} on ${input.channel}.`,
    status: input.isOwnerAction ? "sent" : "received",
    gmailMessageId: messageKey,
    providerMessageId: messageKey,
    providerThreadId: identity.threadRef,
    providerMetadata: {
      reactionTargetMessageId: targetMessageId,
      reactionEmoji: emoji,
      reactionAction: action,
      senderId: contactId,
      platformSenderId: input.senderId,
      recipientId: input.recipientId,
    },
  });
  return "imported_reaction" as const;
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
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/webhooks/theo-meta-social",
    method: "POST",
    provider: "meta_social",
  });
  await audit.write("received", "received");
  if (!metaSocialDirectEnabled()) {
    await audit.write("blocked", "blocked", {
      statusCode: 503,
      errorMessage: "Meta social direct webhook mode is disabled",
    });
    return NextResponse.json({ ok: false, error: "Meta social direct webhook mode is disabled" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyMetaSocialSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    await audit.write("verify_signature", "failed", {
      statusCode: 401,
      errorCode: "invalid_signature",
      errorMessage: "Invalid Meta signature",
    });
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
  await audit.write("normalized", "received", {
    metadata: {
      object: String(payload.object || ""),
      entries: Array.isArray(payload.entry) ? payload.entry.length : 0,
      extracted: inboundMessages.length,
      events: webhookEventSummaries(payload),
    },
  });
  console.info("meta_social_webhook_received", JSON.stringify({
    object: String(payload.object || ""),
    entries: Array.isArray(payload.entry) ? payload.entry.length : 0,
    extracted: inboundMessages.length,
    events: webhookEventSummaries(payload),
  }));
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
    // Derive normalized type from the exact messaging event, not the webhook envelope.
    const normalized = normalizeMetaMessage(inbound.raw, inbound.recipientId);
    const msgType = normalized?.type ?? "text";
    if (msgType === "read_receipt") {
      await audit.write("message", "skipped", {
        channel: inbound.channel,
        providerMessageId: inbound.messageId,
        statusCode: 200,
        metadata: { type: msgType, reason: "read_receipt" },
      });
      results.push({ message_id: inbound.messageId, channel: inbound.channel, action: "skipped", type: msgType });
      continue;
    }
    const connectionIds = stringMap([
      connection?.selected_asset_id,
      String(connection?.metadata?.page_id || ""),
      String(connection?.metadata?.instagram_user_id || ""),
      inbound.entryId,
    ]);
    if (normalized && msgType === "reaction") {
      const action = await processReaction({
        channel: inbound.channel,
        senderId: inbound.senderId,
        recipientId: inbound.recipientId,
        createdTime: inbound.createdTime,
        normalized,
        isOwnerAction: connectionIds.has(inbound.senderId),
        pageAccessToken: resolvePageAccessToken(connection),
      });
      results.push({ message_id: inbound.messageId, channel: inbound.channel, action, type: msgType });
      continue;
    }
    const media = await understandMediaItems(await transcribeMediaItems(inbound.media || []));
    const action = inbound.isEcho || normalized?.isEcho
      ? await processOutboundEcho({ ...inbound, media, pageAccessToken: resolvePageAccessToken(connection) })
      : await processInbound({ ...inbound, media, pageAccessToken: resolvePageAccessToken(connection) });
    await audit.write("message", action === "replied" || action === "imported_echo" ? "sent" : action === "skipped" ? "skipped" : "received", {
      channel: inbound.channel,
      threadRef: `${inbound.channel}:${inbound.senderId}`,
      contactRef: inbound.senderId,
      providerMessageId: inbound.messageId,
      statusCode: 200,
      metadata: { action, type: msgType, isEcho: inbound.isEcho || normalized?.isEcho || false },
    });
    results.push({
      message_id: inbound.messageId,
      channel: inbound.channel,
      action,
      type: msgType,
    });
  }

  console.info("meta_social_webhook_processed", JSON.stringify({
    processed: results.length,
    results,
  }));
  await audit.write("processed", "received", {
    statusCode: 200,
    metadata: { processed: results.length, results },
  });
  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
