import crypto from "crypto";

import { mediaProxyUrl } from "@/lib/mediaProxy";
import { isUnsafeSmsRecipient } from "@/lib/twilioSms";
import type { OmnichannelMedia } from "@/lib/omnichannelEvents";

export type MetaWhatsAppSendResult = {
  sent: boolean;
  skipped: boolean;
  messageIds: string[];
  error: string;
  mediaCount: number;
};

export type MetaWhatsAppInboundMessage = {
  from: string;
  body: string;
  profileName: string;
  messageId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  messageType: string;
  media?: OmnichannelMedia[];
};

function envFlag(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function whatsAppAgentEnabled(): boolean {
  return envFlag(process.env.ENABLE_WHATSAPP_AGENT);
}

function missingConfig(): string {
  const missing = ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"].filter((key) => !process.env[key]);
  return missing.join(", ");
}

function cleanRecipient(value: string): string {
  return value.replace(/^whatsapp:/i, "").replace(/[^\d]/g, "").trim();
}

function maxWhatsAppImages(): number {
  return Math.max(0, Number(process.env.WHATSAPP_MAX_IMAGES || process.env.SMS_MAX_IMAGES || "3"));
}

function cleanMediaUrls(mediaUrls: string[] = []): string[] {
  return mediaUrls
    .map((url) => url.trim())
    .filter((url) => /^https:\/\//i.test(url))
    .map((url) => mediaProxyUrl(url))
    .slice(0, maxWhatsAppImages());
}

function graphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
}

function messagesUrl(): string {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  return `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/messages`;
}

async function postMetaMessage(body: Record<string, unknown>): Promise<{ ok: boolean; id: string; error: string }> {
  const response = await fetch(messagesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      ...body,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    return {
      ok: false,
      id: "",
      error: payload.error?.message || response.statusText || "Meta WhatsApp send failed",
    };
  }
  return { ok: true, id: payload.messages?.[0]?.id || "", error: "" };
}

export function whatsAppMessageWithMediaLog(body: string, mediaUrls: string[] = []): string {
  const cleanBody = body.trim();
  const cleanUrls = cleanMediaUrls(mediaUrls);
  if (!cleanUrls.length) return cleanBody;
  return [cleanBody, "", ...cleanUrls.map((url) => `WhatsApp image: ${url}`)].join("\n");
}

export async function sendMetaWhatsApp(to: string, body: string, mediaUrls: string[] = []): Promise<MetaWhatsAppSendResult> {
  const cleanUrls = cleanMediaUrls(mediaUrls);
  if (!whatsAppAgentEnabled()) {
    return { sent: false, skipped: true, messageIds: [], error: "ENABLE_WHATSAPP_AGENT is not true", mediaCount: cleanUrls.length };
  }

  const missing = missingConfig();
  if (missing) {
    return { sent: false, skipped: true, messageIds: [], error: `Missing Meta WhatsApp config: ${missing}`, mediaCount: cleanUrls.length };
  }

  const recipient = cleanRecipient(to);
  const message = body.trim();
  if (!recipient || !message) {
    return { sent: false, skipped: true, messageIds: [], error: "Missing WhatsApp recipient or body", mediaCount: cleanUrls.length };
  }
  if (isUnsafeSmsRecipient(recipient)) {
    return { sent: false, skipped: true, messageIds: [], error: `Blocked unsafe WhatsApp recipient: ${recipient}`, mediaCount: cleanUrls.length };
  }

  const messageIds: string[] = [];
  const textResult = await postMetaMessage({
    to: recipient,
    type: "text",
    text: { preview_url: true, body: message },
  });
  if (!textResult.ok) {
    return { sent: false, skipped: false, messageIds, error: textResult.error, mediaCount: cleanUrls.length };
  }
  if (textResult.id) messageIds.push(textResult.id);

  for (const url of cleanUrls) {
    const imageResult = await postMetaMessage({
      to: recipient,
      type: "image",
      image: { link: url },
    });
    if (!imageResult.ok) {
      return { sent: false, skipped: false, messageIds, error: imageResult.error, mediaCount: cleanUrls.length };
    }
    if (imageResult.id) messageIds.push(imageResult.id);
  }

  return { sent: true, skipped: false, messageIds, error: "", mediaCount: cleanUrls.length };
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET || "";
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  if (signatureHeader.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

function textFromMessage(message: Record<string, unknown>): string {
  const type = String(message.type || "");
  const text = message.text && typeof message.text === "object" ? message.text as Record<string, unknown> : {};
  const image = message.image && typeof message.image === "object" ? message.image as Record<string, unknown> : {};
  const button = message.button && typeof message.button === "object" ? message.button as Record<string, unknown> : {};
  if (type === "text") return String(text.body || "");
  if (type === "image") return String(image.caption || "[WhatsApp image received]");
  if (type === "button") return String(button.text || "");
  return `[Unsupported WhatsApp ${type || "message"} received]`;
}

function mediaFromMessage(message: Record<string, unknown>): OmnichannelMedia[] {
  const type = String(message.type || "");
  const source = message[type] && typeof message[type] === "object" ? message[type] as Record<string, unknown> : {};
  const mediaTypes = new Set(["image", "audio", "video", "document", "sticker"]);
  if (!mediaTypes.has(type)) return [];
  const id = String(source.id || "").trim();
  const mimeType = String(source.mime_type || source.mimeType || "").trim();
  return [{
    id,
    type: type === "document" ? "file" : type === "sticker" ? "image" : type as OmnichannelMedia["type"],
    contentType: mimeType,
    filename: String(source.filename || source.caption || `whatsapp-${type}`).trim(),
    providerMetadata: {
      provider: "meta_whatsapp",
      mediaId: id,
      caption: String(source.caption || "").trim(),
      sha256: String(source.sha256 || "").trim(),
    },
  }];
}

export function extractMetaWhatsAppMessages(payload: Record<string, unknown>): MetaWhatsAppInboundMessage[] {
  const messages: MetaWhatsAppInboundMessage[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const entryObject = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const changes = Array.isArray(entryObject.changes) ? entryObject.changes : [];
    for (const change of changes) {
      const changeObject = change && typeof change === "object" ? change as Record<string, unknown> : {};
      const value = changeObject.value && typeof changeObject.value === "object" ? changeObject.value as Record<string, unknown> : {};
      const metadata = value.metadata && typeof value.metadata === "object" ? value.metadata as Record<string, unknown> : {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const contactByWaId = new Map<string, string>();
      for (const contact of contacts) {
        const contactObject = contact && typeof contact === "object" ? contact as Record<string, unknown> : {};
        const profile = contactObject.profile && typeof contactObject.profile === "object" ? contactObject.profile as Record<string, unknown> : {};
        contactByWaId.set(String(contactObject.wa_id || ""), String(profile.name || ""));
      }
      const valueMessages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of valueMessages) {
        const messageObject = message && typeof message === "object" ? message as Record<string, unknown> : {};
        const from = cleanRecipient(String(messageObject.from || ""));
        if (!from) continue;
        messages.push({
          from,
          body: textFromMessage(messageObject),
          profileName: contactByWaId.get(from) || "",
          messageId: String(messageObject.id || ""),
        phoneNumberId: String(metadata.phone_number_id || ""),
        displayPhoneNumber: String(metadata.display_phone_number || ""),
        messageType: String(messageObject.type || ""),
        media: mediaFromMessage(messageObject),
      });
      }
    }
  }
  return messages;
}
