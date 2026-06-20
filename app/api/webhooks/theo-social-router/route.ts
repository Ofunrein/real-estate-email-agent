import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction, type ChannelIngestInput } from "@/lib/channelIngest";
import { findCandidatePropertiesFromDatabase, findLeadInDatabase, findPropertiesByAddressesFromDatabase, readEventsForThreadFromDatabase, upsertPropertyToDatabase } from "@/lib/database";
import { appendPropertyToSheets } from "@/lib/googleSheets";
import { isTakeoverActive } from "@/lib/humanTakeover";
import {
  buildSocialRouterResult,
  formatManyChatDynamicBlock,
  normalizeManyChatPayload,
  shouldTheoHandleSocialDm,
  socialDmAgentEnabled,
  socialDmIngestInput,
  socialThreadRef,
  type SocialDmPayload,
  type SocialDmRouterResult,
  type SocialDmChannel,
} from "@/lib/manychatSocial";
import { fetchStyleContext } from "@/lib/styleTraining";
import { generateTheoReply } from "@/lib/theoAgent";
import { enrichTheoData, extractTheoListedPropertyAddresses, extractTheoPropertySearchIntent, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { addTheoSessionCost, elapsedMs, formatUsd, nowMs, theoSessionCost, type TheoMetric } from "@/lib/theoTelemetry";
import { sendTheoHandoffAlert } from "@/lib/twilioSms";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

export const dynamic = "force-dynamic";

type TheoSocialOutboundInput = Omit<ChannelIngestInput, "direction" | "agentName" | "source" | "preferredChannel">;

function wantsManyChatFormat(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("format") === "manychat";
}

function routerResponse(request: NextRequest, result: SocialDmRouterResult, init: ResponseInit = {}) {
  if (wantsManyChatFormat(request)) {
    return NextResponse.json(formatManyChatDynamicBlock(result), init);
  }
  return NextResponse.json(result, init);
}

function logTheoSocial(message: string, details: Record<string, unknown> = {}) {
  console.info(`[Theo Social] ${message}`, details);
}

function logTheoMetrics(metrics: TheoMetric[]) {
  for (const metric of metrics) {
    const sessionTotal = addTheoSessionCost(metric.costUsd || 0);
    logTheoSocial("metric", {
      service: metric.service,
      label: metric.label,
      status: metric.status,
      elapsedMs: metric.elapsedMs,
      cost: formatUsd(metric.costUsd || 0),
      sessionCost: formatUsd(sessionTotal),
      detail: metric.detail || "",
    });
  }
}

function combinedInboundMessage(events: Record<string, string>[] = [], currentMessage = ""): string {
  const lastOutboundIndex = events.map((event) => event.direction).lastIndexOf("outbound");
  const pendingInbound = events
    .slice(lastOutboundIndex + 1)
    .filter((event) => event.direction === "inbound")
    .map((event) => event.message_text || event.summary || "")
    .map((message) => message.trim())
    .filter(Boolean);
  const messages = pendingInbound.length ? pendingInbound : [currentMessage.trim()].filter(Boolean);
  return messages.slice(-5).join("\n");
}

function referencesPriorProperties(message = ""): boolean {
  return /\b(those|that|these|them|it|links?|urls?|photos?|pictures?|similar|same spec|same specs|neighboring|neighbor|nearby|next to|close by|comparable|alternatives?|other options?|amenit(?:y|ies)|features?|details?|property you just sent|listing you just sent|one you just sent|for the property|for that property|for this property)\b/i.test(message);
}

function wantsRelatedProperties(message = ""): boolean {
  return /\b(similar|same spec|same specs|same size|same price|neighboring|neighbor|nearby|next to|close by|close to (?:the )?(?:\d+\s*)?(?:bed|bd|bedroom|layout)|\d+\s*(?:bed|bd|bedroom).{0,40}layout|something close|comparable|alternatives?|other options?)\b/i.test(message);
}

function recentInboundAddresses(events: Record<string, string>[] = []): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const event of [...events].reverse()) {
    if (event.direction !== "inbound") continue;
    for (const address of extractTheoListedPropertyAddresses(event.message_text || "")) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addresses.push(address);
    }
    if (addresses.length) break;
  }
  return addresses;
}

async function cacheTheoProperties(properties: Record<string, string>[]): Promise<{ database: number; sheets: number; errors: string[] }> {
  let database = 0;
  let sheets = 0;
  const errors: string[] = [];
  for (const property of properties) {
    if (!property.address) continue;
    try {
      const saved = await upsertPropertyToDatabase(property, "social_dm_lookup");
      if (saved) database += 1;
    } catch (error) {
      errors.push(`database:${error instanceof Error ? error.message : "failed"}`);
    }
    try {
      if (await appendPropertyToSheets(property)) sheets += 1;
    } catch (error) {
      errors.push(`sheets:${error instanceof Error ? error.message : "failed"}`);
    }
  }
  return { database, sheets, errors };
}

async function recordTheoSocialOutbound(input: TheoSocialOutboundInput) {
  return recordChannelInteraction({
    ...input,
    eventType: input.eventType || `${input.channel}_outbound`,
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    source: "manychat",
    preferredChannel: input.channel,
  });
}

async function findSocialProperties(input: SocialDmPayload, messageForReply: string, recentEvents: Record<string, string>[]) {
  const propertySearch = extractTheoPropertySearchIntent(
    input.listingAddress,
    messageForReply,
  );
  const propertyQuery = extractTheoPropertySearchQuery(
    input.listingAddress,
    messageForReply,
  );
  const requestedAddresses = extractTheoListedPropertyAddresses(input.listingAddress, messageForReply);
  const priorAddresses = referencesPriorProperties(messageForReply) || wantsRelatedProperties(messageForReply)
    ? extractTheoListedPropertyAddresses(...recentEvents.filter((event) => event.direction === "outbound").map((event) => event.message_text || ""))
    : [];
  const recentAddresses = !requestedAddresses.length && referencesPriorProperties(messageForReply)
    ? recentInboundAddresses(recentEvents)
    : [];
  const addressMatches = await findPropertiesByAddressesFromDatabase(
    [...requestedAddresses, ...priorAddresses, ...recentAddresses],
    5,
  );
  const referenceAddress = propertySearch.query || requestedAddresses[0] || priorAddresses[0] || recentAddresses[0] || input.listingAddress;
  const candidateMatches = propertySearch.mode !== "general" || propertyQuery || propertySearch.area
    ? await findCandidatePropertiesFromDatabase(
      {
        query: propertyQuery,
        area: propertySearch.area,
        beds: propertySearch.beds,
        baths: propertySearch.baths,
        minPrice: propertySearch.minPrice,
        maxPrice: propertySearch.maxPrice,
        mode: propertySearch.mode,
        reference: referenceAddress ? { address: referenceAddress } : undefined,
        excludeAddresses: addressMatches.map((property) => property.address).filter(Boolean),
      },
      5,
    )
    : [];
  return [...addressMatches, ...candidateMatches].filter((property, index, list) =>
    property.address && list.findIndex((item) => item.address?.toLowerCase() === property.address.toLowerCase()) === index,
  ).slice(0, 5);
}

export async function POST(request: NextRequest) {
  const requestStarted = nowMs();
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const input = normalizeManyChatPayload(payload);
    const threadRef = socialThreadRef(input);
    const guard = shouldTheoHandleSocialDm(input);
    logTheoSocial("inbound received", {
      channel: input.channel,
      threadRef,
      routeReason: input.routeReason,
      bodyPreview: input.messageText.slice(0, 120),
    });

    if (!socialDmAgentEnabled()) {
      return routerResponse(request, {
        ok: true,
        channel: input.channel,
        thread_ref: threadRef,
        should_send: false,
        needs_human: false,
        status: "skipped",
        intent: guard.intent,
        reply: "",
        media_urls: [],
        media_count: 0,
        reason: "ENABLE_SOCIAL_DM_AGENT is not true",
      });
    }

    const inboundInput = socialDmIngestInput(input, guard);
    const result = await recordChannelInteraction(inboundInput);

    if (!guard.allowed) {
      return routerResponse(request, buildSocialRouterResult({
        channel: input.channel,
        threadRef: result.event.thread_ref,
        guard,
      }));
    }

    const socialChannel = input.channel as SocialDmChannel;
    if (await isTakeoverActive(result.event.thread_ref)) {
      const takeoverGuard = { allowed: false, needsHuman: true, reason: "Human takeover active", intent: guard.intent };
      return routerResponse(request, buildSocialRouterResult({
        channel: input.channel,
        threadRef: result.event.thread_ref,
        guard: takeoverGuard,
      }));
    }

    const recentEvents = await readEventsForThreadFromDatabase(result.event.thread_ref, 12);
    const messageForReply = combinedInboundMessage(recentEvents, input.messageText);
    const lead = await findLeadInDatabase({ full_name: input.senderName });
    const properties = await findSocialProperties(input, messageForReply, recentEvents);
    const enriched = await enrichTheoData({
      message: messageForReply,
      lead: lead || result.lead,
      properties,
      propertyInterest: input.listingAddress,
    });
    logTheoMetrics(enriched.metrics);
    const cacheResult = await cacheTheoProperties(enriched.properties);
    logTheoSocial("property cache processed", cacheResult);

    const reply = await generateTheoReply({
      message: messageForReply,
      lead: lead || result.lead,
      properties: enriched.properties,
      recentEvents,
      propertyInterest: input.listingAddress,
      source: socialChannel,
      dataContext: enriched.context,
      styleContext: await fetchStyleContext(),
    });
    logTheoMetrics(reply.metrics);

    const routeResult = buildSocialRouterResult({
      channel: socialChannel,
      threadRef: result.event.thread_ref,
      guard,
      reply,
      reason: reply.handoffReason,
    });

    let handoffAlertSent = false;
    let handoffAlertError = "";
    if (routeResult.needs_human) {
      const alertResult = await sendTheoHandoffAlert({
        leadPhone: result.event.thread_ref,
        leadName: input.senderName,
        reason: routeResult.reason || "Social DM needs human",
        summary: input.messageText,
        threadRef: result.event.thread_ref,
      });
      handoffAlertSent = alertResult.sent;
      handoffAlertError = alertResult.error;
    }

    await recordTheoSocialOutbound({
      channel: socialChannel,
      fullName: input.senderName,
      sourceDetail: result.event.source_detail,
      threadRef: result.event.thread_ref,
      messageText: [routeResult.reply, ...routeResult.media_urls.map((url) => `Social DM image: ${url}`)].filter(Boolean).join("\n\n"),
      summary: routeResult.should_send
        ? `Iris prepared ${input.channel} reply${routeResult.media_count ? ` with ${routeResult.media_count} image(s)` : ""}.`
        : `Iris routed ${input.channel} DM to human.`,
      aiAction: routeResult.should_send ? "social_dm_reply_ready" : "social_dm_handoff",
      status: routeResult.status,
      handoffReason: routeResult.reason,
      nextAction: routeResult.should_send ? "manychat_send" : "human_follow_up",
    });

    logTheoSocial("webhook complete", {
      channel: input.channel,
      threadRef: result.event.thread_ref,
      status: routeResult.status,
      replyReady: routeResult.should_send,
      mediaCount: routeResult.media_count,
      handoffAlertSent,
      handoffAlertError,
      totalMs: elapsedMs(requestStarted),
      sessionCost: formatUsd(theoSessionCost()),
    });

    return routerResponse(request, routeResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Iris social DM webhook.";
    logTheoSocial("webhook error", { error: message, totalMs: elapsedMs(requestStarted), sessionCost: formatUsd(theoSessionCost()) });
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    const result: SocialDmRouterResult = {
      ok: false,
      channel: "",
      thread_ref: "",
      should_send: false,
      needs_human: true,
      status: "error",
      intent: "",
      reply: "",
      media_urls: [],
      media_count: 0,
      reason: message,
    };
    return routerResponse(request, result, { status });
  }
}
