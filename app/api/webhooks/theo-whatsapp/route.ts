import { NextRequest, NextResponse } from "next/server";

import { metaWhatsAppIngestInput, normalizeTwilioContactAddress, recordChannelInteraction, smsControlAction, type ChannelIngestInput } from "@/lib/channelIngest";
import { findLeadInDatabase, findPropertiesByAddressesFromDatabase, readEventsForThreadFromDatabase, readInboxSettingsFromDatabase, upsertAiDraftInDatabase, upsertPropertyToDatabase } from "@/lib/database";
import { appendPropertyToSheets } from "@/lib/googleSheets";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { extractMetaWhatsAppMessages, sendMetaWhatsApp, verifyMetaSignature, whatsAppMessageWithMediaLog } from "@/lib/metaWhatsapp";
import { fetchStyleContext } from "@/lib/styleTraining";
import { generateIrisTextReply } from "@/lib/irisTextAgent";
import { enrichTheoData, extractTheoListedPropertyAddresses, extractTheoPropertySearchIntent, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { addTheoSessionCost, elapsedMs, formatUsd, nowMs, theoSessionCost, type TheoMetric } from "@/lib/theoTelemetry";
import { isUnsafeSmsRecipient, sendTheoHandoffAlert } from "@/lib/twilioSms";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { writeTheoMetricAuditEvents } from "@/lib/agentCostAudit";
import { shouldAutoSendForChannel } from "@/lib/inboxSettings";
import { createRequestAudit } from "@/lib/requestAudit";
import { retrievePropertiesForAgent } from "@/lib/propertyRetrieval";
import { understandMediaItems, mediaVisionEnabled } from "@/lib/mediaUnderstanding";
import { normalizedMessageText, type OmnichannelMedia } from "@/lib/omnichannelEvents";
import { queueIrisReplySend } from "@/lib/irisReplyQueue";

export const dynamic = "force-dynamic";

type TheoWhatsAppOutboundInput = Omit<ChannelIngestInput, "channel" | "direction" | "agentName" | "source" | "preferredChannel">;

function maskPhone(value = "") {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return value || "unknown";
  return `***${digits.slice(-4)}`;
}

function logTheoWhatsApp(message: string, details: Record<string, unknown> = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (key.toLowerCase().includes("phone") || key.toLowerCase() === "from" || key.toLowerCase() === "to") {
        return [key, maskPhone(String(value || ""))];
      }
      return [key, value];
    }),
  );
  console.info(`[Theo WhatsApp] ${message}`, safeDetails);
}

function graphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
}

async function resolveWhatsAppMediaItem(item: OmnichannelMedia): Promise<OmnichannelMedia> {
  const mediaId = String(item.providerMetadata?.mediaId || item.id || "").trim();
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  if (!mediaId || !token) return item;
  try {
    const metaResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaResponse.ok) return item;
    const meta = await metaResponse.json() as Record<string, unknown>;
    const url = String(meta.url || "").trim();
    const mimeType = String(meta.mime_type || item.contentType || "").trim();
    const next: OmnichannelMedia = {
      ...item,
      url: url || item.url,
      contentType: mimeType || item.contentType,
      providerMetadata: {
        ...(item.providerMetadata || {}),
        mediaUrlResolved: Boolean(url),
        fileSize: meta.file_size,
      },
    };
    if (mediaVisionEnabled() && next.type === "image" && url) {
      const bytesResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (bytesResponse.ok) {
        const contentType = bytesResponse.headers.get("content-type") || mimeType || "image/jpeg";
        next.providerMetadata = {
          ...next.providerMetadata,
          visionContentType: contentType,
          visionBytesBase64: Buffer.from(await bytesResponse.arrayBuffer()).toString("base64"),
        };
      }
    }
    return next;
  } catch (error) {
    logTheoWhatsApp("media resolution skipped", {
      mediaId,
      error: error instanceof Error ? error.message : "media_resolution_failed",
    });
    return item;
  }
}

async function resolveWhatsAppMediaItems(media: OmnichannelMedia[] = []): Promise<OmnichannelMedia[]> {
  const resolved: OmnichannelMedia[] = [];
  for (const item of media) resolved.push(await resolveWhatsAppMediaItem(item));
  return resolved;
}

function logTheoMetrics(metrics: TheoMetric[]) {
  for (const metric of metrics) {
    const sessionTotal = addTheoSessionCost(metric.costUsd || 0);
    logTheoWhatsApp("metric", {
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

function rejectsPriorProperty(message = ""): boolean {
  return /\b(?:no longer|not)\s+interested\b/i.test(message)
    || /\b(?:don't|dont|do not)\s+(?:like|want)\b/i.test(message)
    || /\bnot\s+(?:this|that)\s+(?:one|property|listing)\b/i.test(message)
    || /\b(?:send|show|find|share)\s+(?:me\s+)?another\s+(?:one|option|property|listing)?\b/i.test(message)
    || /\banother\s+(?:one|option|property|listing)\b/i.test(message);
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

async function recordTheoWhatsAppOutbound(input: TheoWhatsAppOutboundInput) {
  return recordChannelInteraction({
    ...input,
    eventType: input.eventType || "whatsapp_outbound",
    channel: "whatsapp",
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    source: "meta_whatsapp",
    preferredChannel: "whatsapp",
  });
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode") || "";
  const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Invalid WhatsApp verify token" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const requestStarted = nowMs();
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/webhooks/theo-whatsapp",
    method: "POST",
    channel: "whatsapp",
    provider: "meta",
  });
  try {
    const rawBody = await request.text();
    await audit.write("received", "received", { metadata: { bytes: rawBody.length } });
    if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
      await audit.write("signature", "failed", { statusCode: 401, errorCode: "invalid_signature" });
      return NextResponse.json({ ok: false, error: "Invalid Meta signature" }, { status: 401 });
    }
    const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const inboundMessages = extractMetaWhatsAppMessages(payload);
    const results: Record<string, unknown>[] = [];

    for (const inbound of inboundMessages) {
      const leadPhone = normalizeTwilioContactAddress(inbound.from);
      logTheoWhatsApp("inbound received", {
        from: inbound.from,
        messageId: inbound.messageId,
        messageType: inbound.messageType,
        bodyPreview: inbound.body.slice(0, 120),
      });

      if (isUnsafeSmsRecipient(inbound.from)) {
        logTheoWhatsApp("test inbound blocked", { from: inbound.from, messageId: inbound.messageId });
        await audit.write("message", "skipped", {
          contactRef: leadPhone,
          providerMessageId: inbound.messageId,
          metadata: { action: "blocked_test_number", messageType: inbound.messageType },
        });
        results.push({ message_id: inbound.messageId, status: "skipped", action: "blocked_test_number", reply_sent: false });
        continue;
      }

      const inboundMedia = await understandMediaItems(await resolveWhatsAppMediaItems(inbound.media || []));
      const inboundInput = metaWhatsAppIngestInput(inbound);
      if (inboundMedia.length) {
        inboundInput.mediaJson = inboundMedia;
        inboundInput.messageText = normalizedMessageText({ text: inbound.body || "", media: inboundMedia });
        inboundInput.summary = `Inbound WhatsApp with ${inboundMedia.length} media item${inboundMedia.length === 1 ? "" : "s"}.`;
      }
      const result = await recordChannelInteraction(inboundInput);
      const controlAction = smsControlAction(inbound.body || "");
      logTheoWhatsApp("inbound logged", {
        threadRef: result.event.thread_ref,
        eventType: result.event.event_type,
        totalMs: elapsedMs(requestStarted),
      });
      await audit.write("inbound_logged", "received", {
        threadRef: result.event.thread_ref,
        contactRef: leadPhone,
        providerMessageId: inbound.messageId,
        metadata: { eventType: result.event.event_type, messageType: inbound.messageType },
      });

      if (controlAction === "stop") {
        await audit.write("message", "skipped", {
          threadRef: result.event.thread_ref,
          contactRef: leadPhone,
          providerMessageId: inbound.messageId,
          metadata: { action: result.event.ai_action, status: result.event.status },
        });
        results.push({ message_id: inbound.messageId, status: result.event.status, action: result.event.ai_action, reply_sent: false });
        continue;
      }

      if (controlAction === "start" || controlAction === "help") {
        const body = controlAction === "start"
          ? "You're opted back in. What home or area can I help with?"
          : "Iris with Austin Realty here. Reply with the home or area you're asking about, or STOP to opt out.";
        const sendResult = await sendMetaWhatsApp(inbound.from, body);
        let handoffAlertSent = false;
        let handoffAlertError = "";
        if (controlAction === "help") {
          const alertResult = await sendTheoHandoffAlert({
            leadPhone,
            leadName: inbound.profileName,
            reason: "Lead asked for WhatsApp help",
            summary: inbound.body || "HELP",
            threadRef: result.event.thread_ref,
          });
          handoffAlertSent = alertResult.sent;
          handoffAlertError = alertResult.error;
        }
        await recordTheoWhatsAppOutbound({
          phone: leadPhone,
          fullName: inbound.profileName,
          sourceDetail: inbound.displayPhoneNumber ? `to ${inbound.displayPhoneNumber}` : "",
          threadRef: result.event.thread_ref,
          messageText: body,
          summary: controlAction === "start" ? "Iris sent WhatsApp opt-in confirmation." : "Iris sent WhatsApp help response.",
          aiAction: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
          status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
          handoffReason: sendResult.error,
          nextAction: controlAction === "help" ? "human_follow_up" : "await_response",
        });
        await audit.write("control_reply", sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "failed", {
          threadRef: result.event.thread_ref,
          contactRef: leadPhone,
          providerMessageId: inbound.messageId,
          errorMessage: sendResult.error || handoffAlertError || "",
          metadata: { controlAction, handoffAlertSent },
        });
        results.push({
          message_id: inbound.messageId,
          status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
          action: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
          reply_sent: sendResult.sent,
          handoff_alert_sent: handoffAlertSent,
          handoff_alert_error: handoffAlertError || undefined,
          send_error: sendResult.error || undefined,
        });
        continue;
      }

      if (await isTakeoverActive(result.event.thread_ref, result.event.channel)) {
        logTheoWhatsApp("human takeover active - skipping AI reply", {
          leadPhone: inbound.from,
          threadRef: result.event.thread_ref,
        });
        await audit.write("message", "blocked", {
          threadRef: result.event.thread_ref,
          contactRef: leadPhone,
          providerMessageId: inbound.messageId,
          metadata: { action: "ai_skipped_human_takeover" },
        });
        results.push({ message_id: inbound.messageId, status: "human_takeover", action: "ai_skipped_human_takeover", reply_sent: false });
        continue;
      }

      const lead = await findLeadInDatabase({ phone: leadPhone, full_name: inbound.profileName });
      const recentEvents = await readEventsForThreadFromDatabase(result.event.thread_ref, 12);
      const messageForReply = combinedInboundMessage(recentEvents, inbound.body || "");
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
      const requestedAddresses = extractTheoListedPropertyAddresses(messageForReply);
      const rejectedPriorProperty = rejectsPriorProperty(messageForReply);
      const referencedInboundAddresses = !requestedAddresses.length && (referencesPriorProperties(messageForReply) || rejectedPriorProperty)
        ? recentInboundAddresses(recentEvents)
        : [];
      const priorAddresses = !requestedAddresses.length && !referencedInboundAddresses.length && (referencesPriorProperties(messageForReply) || rejectedPriorProperty)
        ? extractTheoListedPropertyAddresses(...recentEvents.filter((event) => event.direction === "outbound").map((event) => event.message_text || ""))
        : [];
      const exactAddresses = requestedAddresses.length ? requestedAddresses : referencedInboundAddresses.length ? referencedInboundAddresses : priorAddresses;
      const relatedRequest = rejectedPriorProperty || wantsRelatedProperties(messageForReply) || propertySearch.mode !== "general";
      const candidateSearchMode = relatedRequest && propertySearch.mode === "general" ? "similar" : propertySearch.mode;
      const referenceProperties = relatedRequest && exactAddresses.length
        ? await findPropertiesByAddressesFromDatabase(exactAddresses, 5)
        : [];
      const properties = !rejectedPriorProperty && (requestedAddresses.length || (!relatedRequest && exactAddresses.length))
        ? await findPropertiesByAddressesFromDatabase(exactAddresses, 5)
        : await retrievePropertiesForAgent({
          ...propertySearch,
          mode: candidateSearchMode,
          query: propertyQuery,
          reference: referenceProperties[0],
          excludeAddresses: [
            ...referenceProperties.map((property) => property.address).filter(Boolean),
            ...exactAddresses,
          ].filter(Boolean),
        }, 5, { channel: "whatsapp" });
      logTheoWhatsApp("context read complete", {
        leadPhone: inbound.from,
        propertyRows: properties.length,
        referencePropertyRows: referenceProperties.length,
        propertyQuery,
        threadEvents: recentEvents.length,
      });

      const propertyInterest = exactAddresses[0] || propertyQuery || lead?.property_interest || result.lead.property_interest || "";
      const enriched = await enrichTheoData({
        message: messageForReply,
        lead: lead || result.lead,
        properties,
        propertyInterest,
      });
      logTheoMetrics(enriched.metrics);
      await writeTheoMetricAuditEvents(enriched.metrics, {
        requestId: audit.requestId,
        route: "agent:theo-whatsapp",
        channel: "whatsapp",
        provider: "anthropic",
        threadRef: result.event.thread_ref,
        contactRef: inbound.from,
        providerMessageId: inbound.messageId,
      });
      const cacheResult = await cacheTheoProperties(enriched.properties);
      logTheoWhatsApp("property cache processed", {
        leadPhone: inbound.from,
        databaseRows: cacheResult.database,
        sheetRows: cacheResult.sheets,
        errorCount: cacheResult.errors.length,
        errors: cacheResult.errors.slice(0, 2),
      });

      const reply = await generateIrisTextReply({
        message: messageForReply,
        lead: lead || result.lead,
        properties: enriched.properties,
        recentEvents,
        propertyInterest,
        source: "whatsapp",
        dataContext: enriched.context,
        styleContext: await fetchStyleContext(),
      });
      logTheoMetrics(reply.metrics);
      await writeTheoMetricAuditEvents(reply.metrics, {
        requestId: audit.requestId,
        route: "agent:theo-whatsapp",
        channel: "whatsapp",
        provider: "anthropic",
        threadRef: result.event.thread_ref,
        contactRef: inbound.from,
        providerMessageId: inbound.messageId,
      });
      logTheoWhatsApp("reply generated", {
        leadPhone: inbound.from,
        intent: reply.classification.intent,
        status: reply.status,
        action: reply.aiAction,
        handoffReason: reply.handoffReason,
        mediaCount: reply.mediaUrls.length,
      });

      if (!reply.shouldSend) {
        await audit.write("message", "blocked", {
          threadRef: result.event.thread_ref,
          contactRef: leadPhone,
          providerMessageId: inbound.messageId,
          metadata: { status: reply.status, action: reply.aiAction, handoffReason: reply.handoffReason },
        });
        results.push({ message_id: inbound.messageId, status: reply.status, action: reply.aiAction, reply_sent: false });
        continue;
      }

      const settings = await readInboxSettingsFromDatabase();
      if (!shouldAutoSendForChannel(settings, "whatsapp")) {
        await upsertAiDraftInDatabase({
          thread_ref: result.event.thread_ref,
          channel: "whatsapp",
          body: whatsAppMessageWithMediaLog(reply.reply, reply.mediaUrls),
          category_slug: reply.classification.intent || "needs_reply",
          confidence: 0.82,
          reason: settings.draft_first ? "Draft first is enabled." : "WhatsApp auto-send is disabled.",
          next_action: "review_send",
          safe_to_auto_send: true,
          needs_human: reply.status === "needs_human",
          model: "theo_whatsapp",
          fingerprint: `whatsapp:${result.event.thread_ref}:${Date.now()}`,
        });
        results.push({
          message_id: inbound.messageId,
          status: "review_ready",
          action: "reply_drafted",
          reply_sent: false,
          media_count: reply.mediaUrls.length,
        });
        await audit.write("message", "drafted", {
          threadRef: result.event.thread_ref,
          contactRef: leadPhone,
          providerMessageId: inbound.messageId,
          metadata: { reason: settings.draft_first ? "draft_first" : "auto_send_disabled", mediaCount: reply.mediaUrls.length },
        });
        continue;
      }

      let handoffAlertSent = false;
      let handoffAlertError = "";
      if (reply.status === "needs_human") {
        const alertResult = await sendTheoHandoffAlert({
          leadPhone,
          leadName: inbound.profileName,
          reason: reply.handoffReason,
          summary: messageForReply || reply.reply,
          threadRef: result.event.thread_ref,
        });
        handoffAlertSent = alertResult.sent;
        handoffAlertError = alertResult.error;
      }
      await queueIrisReplySend({
        dedupeKey: `whatsapp:${inbound.messageId}`,
        channel: "whatsapp",
        provider: "meta_whatsapp",
        threadRef: result.event.thread_ref,
        contactRef: inbound.from,
        replyText: reply.reply,
        mediaUrls: reply.mediaUrls,
        nextAction: reply.status === "needs_human" ? "human_follow_up" : "await_reply",
        metadata: {
          reason: reply.handoffReason || reply.aiAction,
          lead: { fullName: inbound.profileName, phone: leadPhone, preferredChannel: "whatsapp", smsConsent: "inbound_text" },
        },
      });
      await audit.write("message", "queued", {
        threadRef: result.event.thread_ref,
        contactRef: leadPhone,
        providerMessageId: inbound.messageId,
        errorMessage: handoffAlertError || "",
        metadata: {
          status: reply.status,
          intent: reply.classification.intent,
          handoffReason: reply.handoffReason,
          handoffAlertSent,
          mediaCount: reply.mediaUrls.length,
        },
      });
      results.push({
        message_id: inbound.messageId,
        status: "queued",
        action: "reply_queued",
        reply_sent: false,
        media_count: reply.mediaUrls.length,
        handoff_alert_sent: handoffAlertSent,
        handoff_alert_error: handoffAlertError || undefined,
      });
    }

    const responseBody = {
      ok: true,
      channel: "whatsapp",
      processed: results.length,
      results,
      total_ms: elapsedMs(requestStarted),
      session_cost: formatUsd(theoSessionCost()),
    };
    await audit.write("processed", results.some((result) => result.reply_sent) ? "sent" : results.some((result) => result.status === "queued") ? "queued" : "skipped", {
      metadata: { processed: results.length },
    });
    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Iris WhatsApp webhook.";
    logTheoWhatsApp("webhook error", { error: message, totalMs: elapsedMs(requestStarted), sessionCost: formatUsd(theoSessionCost()) });
    const status = message.includes("DATABASE_URL") ? 503 : 500;
    await audit.write("processed", "failed", { statusCode: status, errorMessage: message });
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
