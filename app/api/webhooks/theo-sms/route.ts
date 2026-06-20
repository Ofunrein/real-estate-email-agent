import { NextRequest, NextResponse } from "next/server";

import { normalizeTwilioContactAddress, recordChannelInteraction, smsControlAction, twilioSmsIngestInput, type ChannelIngestInput } from "@/lib/channelIngest";
import { findCandidatePropertiesFromDatabase, findLeadInDatabase, findPropertiesByAddressesFromDatabase, hasNewerInboundForThreadInDatabase, readEventsForThreadFromDatabase, upsertPropertyToDatabase } from "@/lib/database";
import { appendPropertyToSheets } from "@/lib/googleSheets";
import { generateTheoReply } from "@/lib/theoAgent";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { enrichTheoData, extractTheoListedPropertyAddresses, extractTheoPropertySearchIntent, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { addTheoSessionCost, elapsedMs, formatUsd, nowMs, theoSessionCost, type TheoMetric } from "@/lib/theoTelemetry";
import { isUnsafeSmsRecipient, sendTheoHandoffAlert, sendTheoSms, smsMessageWithMediaLog } from "@/lib/twilioSms";
import { fetchStyleContext } from "@/lib/styleTraining";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

export const dynamic = "force-dynamic";

function stringPayload(payload: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value == null ? "" : String(value)]));
}

type TheoOutboundInput = Omit<ChannelIngestInput, "channel" | "direction" | "agentName" | "source" | "preferredChannel">;

function wantsJsonResponse(request: NextRequest) {
  const url = new URL(request.url);
  return (
    url.searchParams.get("debug") === "json" ||
    request.headers.get("x-lumenosis-debug-json") === "true"
  );
}

function webhookResponse(request: NextRequest, payload: Record<string, unknown>, init: ResponseInit = {}) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json(payload, init);
  }
  return new NextResponse("<Response></Response>", {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers || {}).entries()),
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

// Detects automated OTP/verification messages from platforms like Meta, Google, Apple, etc.
// These should never receive an AI reply.
function isSystemOtpMessage(body: string, from: string): boolean {
  const normalized = body.trim();
  // Short codes (4-6 digits) are almost always automated system senders
  const fromDigits = from.replace(/\D/g, "");
  if (fromDigits.length >= 4 && fromDigits.length <= 6) return true;
  // Match verification code body patterns
  const otpPattern = /(\b\d{4,8}\b.{0,80}(code|verify|verification|otp|one.?time|password|auth(?:entication|enticate)?|login|confirm|passcode|pin\b)|(code|verify|verification|otp|one.?time|password|auth(?:entication|enticate)?|login|confirm|passcode|\bpin\b).{0,80}\b\d{4,8}\b)/i;
  return otpPattern.test(normalized);
}

function maskPhone(value = "") {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return value || "unknown";
  return `***${digits.slice(-4)}`;
}

function logTheo(message: string, details: Record<string, unknown> = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (key.toLowerCase().includes("phone") || key.toLowerCase() === "from" || key.toLowerCase() === "to") {
        return [key, maskPhone(String(value || ""))];
      }
      return [key, value];
    }),
  );
  console.info(`[Theo SMS] ${message}`, safeDetails);
}

function logTheoMetrics(metrics: TheoMetric[]) {
  for (const metric of metrics) {
    const sessionTotal = addTheoSessionCost(metric.costUsd || 0);
    logTheo("metric", {
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

function theoReplyDebounceMs(): number {
  const value = Number(process.env.THEO_REPLY_DEBOUNCE_MS || "2500");
  if (!Number.isFinite(value)) return 2500;
  return Math.max(0, Math.min(value, 12000));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return /\b(those|that|these|them|it|links?|urls?|photos?|pictures?|similar|same spec|same specs|neighboring|neighbor|nearby|next to|close by|comparable|alternatives?|other options?)\b/i.test(normalized);
}

function wantsRelatedProperties(message = ""): boolean {
  const normalized = normalizeFollowupText(message);
  return /\b(similar|same spec|same specs|same size|same price|neighboring|neighbor|nearby|next to|close by|close to (?:the )?(?:\d+\s*)?(?:bed|bd|bedroom|layout)|\d+\s*(?:bed|bd|bedroom).{0,40}layout|something close|comparable|alternatives?|other options?|cheaper|lower price|less expensive|more affordable|more expensive|higher price|bigger|larger|smaller|more bedrooms?|more baths?)\b/i.test(normalized);
}

function hasFreshPropertySearchCriteria(search: ReturnType<typeof extractTheoPropertySearchIntent>): boolean {
  return Boolean(search.area || search.beds || search.baths || search.minPrice || search.maxPrice);
}

function ordinalReferenceIndex(message = ""): number | null {
  const normalized = normalizeFollowupText(message);
  if (/\b(first|1st|#\s*1|number\s+1|one)\b/i.test(normalized)) return 0;
  if (/\b(second|2nd|#\s*2|number\s+2|two)\b/i.test(normalized)) return 1;
  if (/\b(third|3rd|#\s*3|number\s+3|three)\b/i.test(normalized)) return 2;
  return null;
}

function recentOutboundAddresses(events: Record<string, string>[] = [], options: { preferDetailPrompt?: boolean } = {}): string[] {
  if (options.preferDetailPrompt) {
    for (const event of [...events].reverse()) {
      if (event.direction !== "outbound") continue;
      if (!/\bfind similar options\b/i.test(event.message_text || "")) continue;
      const addresses = extractTheoListedPropertyAddresses(event.message_text || "");
      if (addresses.length) return addresses.slice(0, 1);
    }
  }
  for (const event of [...events].reverse()) {
    if (event.direction !== "outbound") continue;
    const addresses = extractTheoListedPropertyAddresses(event.message_text || "");
    if (addresses.length) return addresses;
  }
  return [];
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
      const saved = await upsertPropertyToDatabase(property, "live_lookup");
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

async function recordTheoOutbound(input: TheoOutboundInput) {
  return recordChannelInteraction({
    ...input,
    eventType: input.eventType || "sms_outbound",
    channel: "sms",
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    source: "twilio",
    preferredChannel: "sms",
  });
}

export async function POST(request: NextRequest) {
  const requestStarted = nowMs();
  try {
    assertWebhookSecret(request);
    const parseStarted = nowMs();
    const payload = stringPayload(await parseWebhookPayload(request));
    const leadPhone = normalizeTwilioContactAddress(payload.From || "");
    logTheo("inbound received", {
      from: payload.From,
      to: payload.To,
      messageSid: payload.MessageSid || "",
      bodyPreview: (payload.Body || "").slice(0, 120),
      parseMs: elapsedMs(parseStarted),
    });
    if (isUnsafeSmsRecipient(payload.From || "")) {
      logTheo("test inbound blocked", {
        from: payload.From,
        to: payload.To,
        messageSid: payload.MessageSid || "",
        totalMs: elapsedMs(requestStarted),
      });
      return webhookResponse(request, {
        ok: true,
        channel: "sms",
        status: "skipped",
        action: "blocked_test_number",
        reply_sent: false,
      });
    }

    if (isSystemOtpMessage(payload.Body || "", payload.From || "")) {
      logTheo("system otp message — skipped", {
        from: payload.From,
        to: payload.To,
        messageSid: payload.MessageSid || "",
        bodyPreview: (payload.Body || "").slice(0, 60),
        totalMs: elapsedMs(requestStarted),
      });
      return webhookResponse(request, {
        ok: true,
        channel: "sms",
        status: "skipped",
        action: "blocked_system_otp",
        reply_sent: false,
      });
    }
    const inboundInput = twilioSmsIngestInput(payload);
    const inboundWriteStarted = nowMs();
    const result = await recordChannelInteraction(inboundInput);
    logTheo("inbound logged", {
      threadRef: result.event.thread_ref,
      eventType: result.event.event_type,
      elapsedMs: elapsedMs(inboundWriteStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const controlAction = smsControlAction(payload.Body || "");

    if (controlAction === "stop") {
      logTheo("opt-out recorded", { from: payload.From, threadRef: result.event.thread_ref, totalMs: elapsedMs(requestStarted) });
      return webhookResponse(request, {
        ok: true,
        channel: result.event.channel,
        status: result.event.status,
        action: result.event.ai_action,
        reply_sent: false,
      });
    }

    if (controlAction === "start" || controlAction === "help") {
      const body = controlAction === "start"
        ? "You're opted back in. What home or area can I help with?"
        : "Iris with Austin Realty here. Reply with the home or area you're asking about, or STOP to opt out.";
      const controlSendStarted = nowMs();
      const sendResult = await sendTheoSms(payload.From || "", body);
      const controlSendMs = elapsedMs(controlSendStarted);
      let handoffAlertSent = false;
      let handoffAlertError = "";
      if (controlAction === "help") {
        const alertStarted = nowMs();
        const alertResult = await sendTheoHandoffAlert({
          leadPhone,
          leadName: payload.ProfileName || "",
          reason: "Lead asked for SMS help",
          summary: payload.Body || "HELP",
          threadRef: result.event.thread_ref,
        });
        handoffAlertSent = alertResult.sent;
        handoffAlertError = alertResult.error;
        logTheo("handoff alert processed", {
          leadPhone: payload.From,
          sent: handoffAlertSent,
          elapsedMs: elapsedMs(alertStarted),
          error: handoffAlertError,
        });
      }
      logTheo("control reply processed", {
        action: controlAction,
        leadPhone: payload.From,
        replySent: sendResult.sent,
        replyStatus: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
        elapsedMs: controlSendMs,
        sendError: sendResult.error || "",
        handoffAlertSent,
        handoffAlertError,
      });
      const outboundWriteStarted = nowMs();
      await recordTheoOutbound({
        phone: leadPhone,
        fullName: payload.ProfileName || "",
        sourceDetail: payload.To ? `to ${payload.To}` : "",
        threadRef: result.event.thread_ref,
        messageText: body,
        summary: controlAction === "start" ? "Iris sent SMS opt-in confirmation." : "Iris sent SMS help response.",
        aiAction: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
        status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
        handoffReason: sendResult.error,
        nextAction: controlAction === "help" ? "human_follow_up" : "await_response",
      });
      logTheo("outbound logged", {
        leadPhone: payload.From,
        elapsedMs: elapsedMs(outboundWriteStarted),
        totalMs: elapsedMs(requestStarted),
      });
      logTheo("webhook complete", {
        leadPhone: payload.From,
        action: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
        totalMs: elapsedMs(requestStarted),
        sessionCost: formatUsd(theoSessionCost()),
      });
      return webhookResponse(request, {
        ok: true,
        channel: result.event.channel,
        status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
        action: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
        reply_sent: sendResult.sent,
        handoff_alert_sent: handoffAlertSent,
        handoff_alert_error: handoffAlertError || undefined,
        send_error: sendResult.error || undefined,
      });
    }

    // Human takeover: owner is handling this thread — log inbound, skip AI reply.
    if (await isTakeoverActive(result.event.thread_ref)) {
      logTheo("human takeover active — skipping AI reply", {
        leadPhone: payload.From,
        threadRef: result.event.thread_ref,
        totalMs: elapsedMs(requestStarted),
      });
      return webhookResponse(request, {
        ok: true,
        channel: result.event.channel,
        status: "human_takeover",
        action: "ai_skipped_human_takeover",
        reply_sent: false,
      });
    }

    const debounceMs = theoReplyDebounceMs();
    if (debounceMs > 0) {
      const debounceStarted = nowMs();
      await delay(debounceMs);
      const hasNewerInbound = await hasNewerInboundForThreadInDatabase(result.event.thread_ref, result.event.event_at || "");
      logTheo("debounce checked", {
        leadPhone: payload.From,
        debounceMs,
        hasNewerInbound,
        elapsedMs: elapsedMs(debounceStarted),
        totalMs: elapsedMs(requestStarted),
      });
      if (hasNewerInbound) {
        logTheo("reply skipped for newer inbound", {
          leadPhone: payload.From,
          threadRef: result.event.thread_ref,
          totalMs: elapsedMs(requestStarted),
        });
        return webhookResponse(request, {
          ok: true,
          channel: result.event.channel,
          status: "superseded",
          action: "reply_deferred_to_newer_inbound",
          reply_sent: false,
        });
      }
    }

    const lookupStarted = nowMs();
    const lead = await findLeadInDatabase({ phone: leadPhone, full_name: payload.ProfileName || "" });
    logTheo("lead lookup complete", {
      leadPhone: payload.From,
      found: Boolean(lead),
      elapsedMs: elapsedMs(lookupStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const contextReadStarted = nowMs();
    const recentEvents = await readEventsForThreadFromDatabase(result.event.thread_ref, 12);
    const messageForReply = combinedInboundMessage(recentEvents, payload.Body || "");
    const recentSearchContext = recentEvents
      .slice(-6)
      .filter((event) => event.direction === "inbound")
      .map((event) => event.message_text || event.summary || "")
      .join(" ");
    const propertySearch = extractTheoPropertySearchIntent(
      messageForReply,
      lead?.area || "",
      result.lead.area || "",
      lead?.property_interest || "",
      result.lead.property_interest || "",
      recentSearchContext,
    );
    const propertyQuery = extractTheoPropertySearchQuery(
      messageForReply,
      lead?.area || "",
      result.lead.area || "",
      lead?.property_interest || "",
      result.lead.property_interest || "",
      recentSearchContext,
    );
    const currentMessageSearch = extractTheoPropertySearchIntent(messageForReply);
    const freshPropertySearch = hasFreshPropertySearchCriteria(currentMessageSearch);
    const requestedAddresses = extractTheoListedPropertyAddresses(messageForReply);
    const ordinalIndex = ordinalReferenceIndex(messageForReply);
    const normalizedReply = normalizeFollowupText(messageForReply);
    const preferDetailPrompt = /\bsimilar|same spec|same specs|other|another|alternative|options?\b/i.test(normalizedReply);
    const ordinalAddresses = ordinalIndex == null ? [] : recentOutboundAddresses(recentEvents).slice(ordinalIndex, ordinalIndex + 1);
    const referencedInboundAddresses = !ordinalAddresses.length && !freshPropertySearch && !requestedAddresses.length && referencesPriorProperties(messageForReply)
      ? recentInboundAddresses(recentEvents)
      : [];
    const priorAddresses = !ordinalAddresses.length && !freshPropertySearch && !requestedAddresses.length && !referencedInboundAddresses.length && referencesPriorProperties(messageForReply)
      ? recentOutboundAddresses(recentEvents, { preferDetailPrompt })
      : [];
    const exactAddresses = requestedAddresses.length ? requestedAddresses : ordinalAddresses.length ? ordinalAddresses : referencedInboundAddresses.length ? referencedInboundAddresses : priorAddresses;
    const relatedRequest = wantsRelatedProperties(messageForReply) || propertySearch.mode !== "general";
    const candidateSearchMode = relatedRequest && propertySearch.mode === "general" ? "similar" : propertySearch.mode;
    const referenceProperties = relatedRequest && !requestedAddresses.length && exactAddresses.length
      ? await findPropertiesByAddressesFromDatabase(exactAddresses, 5)
      : [];
    const properties = requestedAddresses.length || (!relatedRequest && exactAddresses.length)
      ? await findPropertiesByAddressesFromDatabase(exactAddresses, 5)
      : await findCandidatePropertiesFromDatabase({
        ...propertySearch,
        mode: candidateSearchMode,
        query: propertyQuery,
        reference: referenceProperties[0],
        excludeAddresses: referenceProperties.map((property) => property.address).filter(Boolean),
      }, 5);
    logTheo("context read complete", {
      leadPhone: payload.From,
      propertyRows: properties.length,
      referencePropertyRows: referenceProperties.length,
      relatedRequest,
      propertyQuery,
      propertySearchMode: candidateSearchMode,
      propertySearchArea: propertySearch.area || "",
      freshPropertySearch,
      ordinalIndex,
      ordinalAddressRows: ordinalAddresses.length,
      combinedMessages: messageForReply.split("\n").filter(Boolean).length,
      requestedAddressRows: requestedAddresses.length,
      referencedInboundAddressRows: referencedInboundAddresses.length,
      priorAddressRows: priorAddresses.length,
      threadEvents: recentEvents.length,
      elapsedMs: elapsedMs(contextReadStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const propertyInterest = exactAddresses[0] || propertyQuery || lead?.property_interest || result.lead.property_interest || "";
    const enrichmentStarted = nowMs();
    const enriched = await enrichTheoData({
      message: messageForReply,
      lead: lead || result.lead,
      properties,
      propertyInterest,
    });
    logTheoMetrics(enriched.metrics);
    logTheo("data enrichment complete", {
      leadPhone: payload.From,
      propertyRows: enriched.properties.length,
      contextChars: enriched.context.length,
      elapsedMs: elapsedMs(enrichmentStarted),
      reportedElapsedMs: enriched.elapsedMs,
      cost: formatUsd(enriched.costUsd),
      totalMs: elapsedMs(requestStarted),
    });
    const cacheStarted = nowMs();
    const cacheResult = await cacheTheoProperties(enriched.properties);
    logTheo("property cache processed", {
      leadPhone: payload.From,
      databaseRows: cacheResult.database,
      sheetRows: cacheResult.sheets,
      errorCount: cacheResult.errors.length,
      errors: cacheResult.errors.slice(0, 2),
      elapsedMs: elapsedMs(cacheStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const aiStarted = nowMs();
    const reply = await generateTheoReply({
      message: messageForReply,
      lead: lead || result.lead,
      properties: enriched.properties,
      recentEvents,
      propertyInterest,
      source: "sms",
      dataContext: enriched.context,
      styleContext: await fetchStyleContext(),
    });
    logTheoMetrics(reply.metrics);
    const aiCost = reply.metrics.reduce((total, metric) => total + (metric.costUsd || 0), 0);
    logTheo("reply generated", {
      leadPhone: payload.From,
      intent: reply.classification.intent,
      leadRole: reply.classification.leadRole,
      opportunityTags: reply.classification.opportunityTags || [],
      toneState: reply.classification.toneState || "",
      nextBestQuestion: reply.classification.nextBestQuestion || "",
      status: reply.status,
      action: reply.aiAction,
      handoffReason: reply.handoffReason,
      elapsedMs: elapsedMs(aiStarted),
      cost: formatUsd(aiCost),
      sessionCost: formatUsd(theoSessionCost()),
      mediaCount: reply.mediaUrls.length,
      replyPreview: reply.reply.slice(0, 160),
    });

    if (!reply.shouldSend) {
      logTheo("reply blocked", {
        leadPhone: payload.From,
        status: reply.status,
        action: reply.aiAction,
        handoffReason: reply.handoffReason,
        totalMs: elapsedMs(requestStarted),
      });
      return webhookResponse(request, {
        ok: true,
        channel: result.event.channel,
        status: reply.status,
        action: reply.aiAction,
        reply_sent: false,
      });
    }

    const sendStarted = nowMs();
    const sendResult = await sendTheoSms(payload.From || "", reply.reply, reply.mediaUrls);
    const sendMs = elapsedMs(sendStarted);
    let handoffAlertSent = false;
    let handoffAlertError = "";
    if (reply.status === "needs_human") {
      const alertStarted = nowMs();
      const alertResult = await sendTheoHandoffAlert({
        leadPhone,
        leadName: payload.ProfileName || "",
        reason: reply.handoffReason,
        summary: messageForReply || reply.reply,
        threadRef: result.event.thread_ref,
      });
      handoffAlertSent = alertResult.sent;
      handoffAlertError = alertResult.error;
      logTheo("handoff alert processed", {
        leadPhone: payload.From,
        sent: handoffAlertSent,
        elapsedMs: elapsedMs(alertStarted),
        error: handoffAlertError,
      });
    } else if ((reply.classification.opportunityTags || []).includes("hot_lead")) {
      const alertStarted = nowMs();
      const alertResult = await sendTheoHandoffAlert({
        leadPhone,
        leadName: payload.ProfileName || "",
        reason: "Hot lead detected",
        summary: messageForReply || reply.reply,
        threadRef: result.event.thread_ref,
      });
      handoffAlertSent = alertResult.sent;
      handoffAlertError = alertResult.error;
      logTheo("hot lead alert processed", {
        leadPhone: payload.From,
        sent: handoffAlertSent,
        elapsedMs: elapsedMs(alertStarted),
        error: handoffAlertError,
      });
    }
    logTheo("reply send processed", {
      leadPhone: payload.From,
      replySent: sendResult.sent,
      replyStatus: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      elapsedMs: sendMs,
      mediaCount: sendResult.mediaCount,
      sendError: sendResult.error || "",
      handoffAlertSent,
      handoffAlertError,
    });
    const outboundWriteStarted = nowMs();
    await recordTheoOutbound({
      phone: leadPhone,
      fullName: payload.ProfileName || "",
      sourceDetail: payload.To ? `to ${payload.To}` : "",
      threadRef: result.event.thread_ref,
      eventType: reply.status === "needs_human" ? "sms_handoff_reply" : "sms_ai_reply",
      messageText: smsMessageWithMediaLog(reply.reply, reply.mediaUrls),
      summary: `Iris ${sendResult.sent ? "sent" : "prepared"} SMS reply for ${reply.classification.intent}${sendResult.mediaCount ? ` with ${sendResult.mediaCount} image(s)` : ""}.`,
      aiAction: sendResult.sent ? "reply_sent" : "reply_generated",
      handoffReason: reply.handoffReason || sendResult.error,
      status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      leadRole: reply.classification.leadRole,
      intent: reply.classification.intent,
      smsConsent: "inbound_text",
      handoffStatus: reply.status === "needs_human" ? "needs_human" : "",
      nextAction: reply.status === "needs_human" ? "human_follow_up" : "await_response",
    });
    logTheo("outbound logged", {
      leadPhone: payload.From,
      elapsedMs: elapsedMs(outboundWriteStarted),
      totalMs: elapsedMs(requestStarted),
    });
    logTheo("webhook complete", {
      leadPhone: payload.From,
      action: sendResult.sent ? "reply_sent" : "reply_generated",
      replySent: sendResult.sent,
      totalMs: elapsedMs(requestStarted),
      sessionCost: formatUsd(theoSessionCost()),
    });

    return webhookResponse(request, {
      ok: true,
      channel: result.event.channel,
      status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      action: sendResult.sent ? "reply_sent" : "reply_generated",
      reply_sent: sendResult.sent,
      handoff_alert_sent: handoffAlertSent,
      handoff_alert_error: handoffAlertError || undefined,
      send_error: sendResult.error || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Iris SMS webhook.";
    logTheo("webhook error", { error: message, totalMs: elapsedMs(requestStarted), sessionCost: formatUsd(theoSessionCost()) });
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return webhookResponse(request, { ok: false, error: message }, { status });
  }
}
