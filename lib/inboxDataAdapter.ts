import {
  parseVoiceTranscript,
  voiceCallTranscriptSource,
  type AgentInboxData,
} from "@/lib/inboxData";
import { categoryBySlug, type AiDraft, type InboxCategory } from "@/lib/inboxSettings";
import {
  adaptChannelId,
  buildChannelThreads,
  buildVoiceCallThreads,
  conversationKey,
  eventChannel,
  eventNeedsHuman,
  eventText,
  eventTimeValue,
  latestEvent,
  parseDraftKey,
  socialContactIdentity,
  threadNeedsHuman,
  threadIdentity,
  voiceCallKey,
  voiceCallTimeValue,
  voiceThreadIdentity,
} from "@/lib/inboxThreadUtils";
import type { SheetRow } from "@/lib/sheetSchema";
import { formatPrice } from "@/lib/format";
import {
  inboxImagePreviewUrl,
  isDisplayableImageUrl,
  rewriteEmailHtmlForInbox,
} from "@/lib/mediaProxy";
import {
  channelAccounts,
  channelMeta,
  leadCategories,
  type ActivityEvent,
  type Call,
  type CallOutcome,
  type CallTurn,
  type Channel,
  type ChannelId,
  type ChannelStats,
  type EmailMessage,
  type EmailThread,
  type InboxModel,
  type LeadCategoryId,
  type MessageChannelId,
  type Property,
  type ReviewItem,
  type SmsMessage,
  type SmsThread,
  type VoiceContact,
} from "@/components/inbox-mui/data/inboxData";

const DAYS = 14;
const RECENT_ACTIVITY_LIMIT = 30;
const ACTIVITY_BODY_LIMIT = 180;
const HTML_TAG_RE = /<\/?(div|table|img|a|h[1-9]|p|br|span|ul|ol|li|strong|em)\b/i;
const MEDIA_URL_RE = /(https?:\/\/[^\s<>"')]+|\/api\/media\/proxy\?url=[^\s<>"')]+)/gi;
const MEDIA_LABEL_RE = /^\s*(?:(?:MMS|SMS|WhatsApp|Social DM)\s*)?(image|photo|media|attachment|audio|voice note|voice)\s*:\s*(.+?)\s*$/i;
const SYSTEM_PROMPT_RE = /\b(you are\s+(?:iris|arya|a real estate)|brand voice|assistant\s+(?:for|to)\s+(?:austin|the)|tool(?:s|ing)?|system prompt|developer instruction|never reveal|do not reveal|call script)\b/i;
const NON_REAL_ESTATE_EMAIL_RE = /\b(security alert|verification code|password reset|new sign-in|login attempt|oauth application|deployment failed|workflow run|unsubscribe|manage preferences|view in browser|privacy policy|trial discount|end of trial|webinar|newsletter|limited time|book a demo|schedule a demo|product update|sales automation|marketing automation)\b/i;
const REAL_ESTATE_EMAIL_RE = /\b(home|house|condo|property|listing|showing|tour|buy|buyer|sell|seller|rent|lease|realtor|real estate|bedroom|bath|mortgage|valuation|pre.?approved|appointment|zillow|mls)\b/i;
const STREET_ADDRESS_RE = /\b\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,7}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|pkwy|parkway|pl|place|path|trl|trail|ter|terrace)\b/i;
const SYNTHETIC_EMAIL_RE = /(?:^|[<\s])[^@\s<>]+@(?:lumenosis\.local|localhost)(?:[>\s]|$)/i;
const PROPERTY_DETAILS_RE = /^Here are the full details on (.+):$/i;
const DISPLAY_TIME_ZONE = "America/Chicago";
const eventTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayKey(d: Date) {
  return dayKeyFormatter.format(d);
}

function categorySlugToId(slug: string): LeadCategoryId {
  const map: Record<string, LeadCategoryId> = {
    needs_reply: "needs-reply",
    hot_lead: "hot-lead",
    showing: "showing",
    seller: "seller",
    valuation: "seller",
    financing: "financing",
    needs_human: "needs-human",
    nurture: "nurture",
    closed: "closed",
  };
  return map[slug] || "needs-reply";
}

function leadCategoryFor(slug: string | undefined, categories: InboxCategory[]): LeadCategoryId {
  const cat = categoryBySlug(categories, slug || "needs_reply");
  if (cat?.slug) return categorySlugToId(cat.slug);
  return categorySlugToId(slug || "needs_reply");
}

function formatCallDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function callOutcome(call: SheetRow): CallOutcome {
  const v = `${call.ended_reason || ""} ${call.disposition || ""} ${call.outcome_code || ""}`.toLowerCase();
  if (v.includes("voicemail")) return "voicemail";
  if (v.includes("forward")) return "assistant-forwarded-call";
  if (v.includes("silence") || v.includes("timeout") || v.includes("timed")) return "silence-timed-out";
  return "assistant-ended-call";
}

function callDurationSeconds(call: SheetRow): number {
  const raw = call.call_duration_seconds || call.duration_sec || call.duration_seconds || "0";
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function formatEventTimeShort(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return eventTimeFormatter.format(parsed);
}

function formatResponseDuration(seconds: number, empty = "No replies"): string {
  if (!seconds || seconds <= 0) return empty;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function looksLikeHtml(value = ""): boolean {
  return HTML_TAG_RE.test(value);
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function emailSubject(event: SheetRow): string | undefined {
  const direct = (event.source_detail || event.subject || "").trim();
  if (direct) return direct.slice(0, 160);
  const sourceLine = (event.summary || "").match(/^Source:\s*gmail\s*\/\s*(.+)$/im);
  const subject = (sourceLine?.[1] || "").trim();
  return subject ? subject.slice(0, 160) : undefined;
}

function emailBodyPreview(event: SheetRow): string {
  const text = eventText(event) || event.summary || "";
  return looksLikeHtml(text) ? stripHtml(text) : text;
}

function isRealEstateEmailEvent(event: SheetRow): boolean {
  const text = `${event.email || ""}\n${event.thread_ref || ""}\n${event.gmail_message_id || ""}\n${event.source_detail || ""}\n${event.event_type || ""}\n${event.summary || ""}\n${event.message_text || ""}`;
  if (SYNTHETIC_EMAIL_RE.test(text)) return false;
  if (NON_REAL_ESTATE_EMAIL_RE.test(text)) return false;
  return REAL_ESTATE_EMAIL_RE.test(text) || STREET_ADDRESS_RE.test(text);
}

function compactActivityText(value = "", limit = ACTIVITY_BODY_LIMIT): string {
  const compact = stripHtml(value)
    .replace(/\s+/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .trim();
  if (!compact) return "";
  if (compact.length <= limit) return compact;
  const slice = compact.slice(0, limit + 1);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  const wordEnd = slice.lastIndexOf(" ");
  const end = sentenceEnd > 80 ? sentenceEnd + 1 : wordEnd > 80 ? wordEnd : limit;
  return `${slice.slice(0, end).trim()}...`;
}

function usableActivityText(primary = "", fallback = "", limit = ACTIVITY_BODY_LIMIT): string {
  const isSystemPrompt = SYSTEM_PROMPT_RE.test(primary);
  const preferred = isSystemPrompt ? fallback : primary;
  return compactActivityText(preferred || fallback || (isSystemPrompt ? "Activity recorded." : primary), limit);
}

function stableEventHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

type ThreadMedia = { url: string; alt: string; kind?: "image" | "audio" | "video" | "file"; transcript?: string; label?: string; linkUrl?: string; thumbnailUrl?: string };

function messageEventId(event: SheetRow, fallback: string): string {
  const direct = event.gmail_message_id || event.appointment_id || event.call_id;
  if (direct) return direct;
  const key = [
    event.thread_ref,
    event.email,
    event.phone,
    event.channel,
    event.direction,
    event.event_at,
    event.event_type,
    event.message_text,
    event.summary,
  ].join("\u001f");
  return `${event.thread_ref || event.email || event.phone || "event"}-${stableEventHash(key || fallback)}`;
}

function smsTextAndMedia(raw: string): { body: string; html?: string; media: ThreadMedia[] } {
  const media: ThreadMedia[] = [];
  const seen = new Set<string>();
  const textLines: string[] = [];

  const addMedia = (url: string, label = "media") => {
    const trimmed = url.trim().replace(/[.,;]+$/, "");
    const labeledAudio = /audio|voice/i.test(label);
    const displayUrl = isDisplayableImageUrl(trimmed)
      ? inboxImagePreviewUrl(trimmed)
      : labeledAudio
        ? inboxAudioPreviewUrl(trimmed)
        : trimmed;
    if (!displayUrl || seen.has(displayUrl)) return false;
    const kind = isDisplayableImageUrl(displayUrl) ? "image" : isDisplayableAudioUrl(displayUrl) || labeledAudio ? "audio" : "file";
    if (kind === "file" && !/attachment|media/i.test(label)) return false;
    seen.add(displayUrl);
    media.push({
      url: displayUrl,
      alt: kind === "audio" ? "Voice note" : kind === "image" ? "MMS image" : "Attachment",
      kind,
    });
    return true;
  };

  for (const line of raw.split("\n")) {
    const labelMatch = line.match(MEDIA_LABEL_RE);
    if (labelMatch) {
      const label = labelMatch[1] || "media";
      const urls = [...labelMatch[2].matchAll(MEDIA_URL_RE)].map((match) => match[1]);
      if (urls.length && urls.every((url) => addMedia(url, label))) continue;
    }

    let nextLine = line;
    const urls = [...line.matchAll(MEDIA_URL_RE)].map((match) => match[1]);
    for (const url of urls) {
      if (isDisplayableImageUrl(url) && addMedia(url)) {
        nextLine = nextLine.replace(url, "").trimEnd();
      }
    }
    textLines.push(nextLine);
  }

  const body = cleanSmsDisplayText(textLines.join("\n").replace(/\n{3,}$/g, "\n\n").trim());
  return {
    body,
    html: looksLikeHtml(body) ? rewriteEmailHtmlForInbox(body) : undefined,
    media,
  };
}

function jsonMediaArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function eventProviderMessageId(event: SheetRow): string {
  const direct = String(event.provider_message_id || "").trim();
  if (direct) return direct;
  const gmail = String(event.gmail_message_id || "").trim();
  const match = gmail.match(/^(?:instagram|messenger):(.+)$/);
  return match?.[1]?.trim() || "";
}

function reactionTargetMessageId(event: SheetRow): string {
  const metadata = jsonObject(event.provider_metadata);
  return String(metadata.reactionTargetMessageId || metadata.reaction_target_message_id || "").trim();
}

function isReactionEvent(event: SheetRow): boolean {
  return String(event.event_type || "").toLowerCase().includes("reaction") || Boolean(reactionTargetMessageId(event));
}

function reactionsByTarget(events: SheetRow[]) {
  const map = new Map<string, SmsMessage["reactions"]>();
  for (const event of events) {
    const target = reactionTargetMessageId(event);
    if (!target) continue;
    const metadata = jsonObject(event.provider_metadata);
    const action: "react" | "unreact" = String(metadata.reactionAction || metadata.reaction_action || "react") === "unreact" ? "unreact" : "react";
    const emoji = String(metadata.reactionEmoji || metadata.reaction_emoji || "").trim() || (action === "unreact" ? "" : "love");
    const entry = {
      emoji,
      by: event.direction === "inbound" ? "contact" as const : "owner" as const,
      action,
    };
    map.set(target, [...(map.get(target) || []), entry]);
  }
  return map;
}

function isInstagramShareUrl(value: string): boolean {
  return /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv|stories)\//i.test(value.trim());
}

function eventMedia(event: SheetRow): ThreadMedia[] {
  const media: ThreadMedia[] = [];
  const seen = new Set<string>();
  for (const item of jsonMediaArray((event as SheetRow & { media_json?: unknown }).media_json)) {
    const rawUrl = String(item.url || "").trim();
    if (!rawUrl) continue;
    const providerMetadata = item.providerMetadata && typeof item.providerMetadata === "object" && !Array.isArray(item.providerMetadata)
      ? item.providerMetadata as Record<string, unknown>
      : {};
    const mediaContext = providerMetadata.mediaContext && typeof providerMetadata.mediaContext === "object" && !Array.isArray(providerMetadata.mediaContext)
      ? providerMetadata.mediaContext as Record<string, unknown>
      : {};
    const thumbnailCandidate = String(item.thumbnailUrl || item.thumbnail_url || providerMetadata.thumbnailUrl || providerMetadata.thumbnail_url || "").trim();
    const providerLink = String(item.linkUrl || item.link_url || providerMetadata.linkUrl || providerMetadata.targetUrl || "").trim();
    const instagramShare = isInstagramShareUrl(rawUrl) || isInstagramShareUrl(providerLink);
    const linkUrl = providerLink || (instagramShare ? rawUrl : "");
    const displayRawUrl = !isDisplayableImageUrl(rawUrl) && !isDisplayableVideoUrl(rawUrl) && !isDisplayableAudioUrl(rawUrl) && thumbnailCandidate
      ? thumbnailCandidate
      : rawUrl;
    const url = isDisplayableImageUrl(displayRawUrl)
      ? inboxImagePreviewUrl(displayRawUrl)
      : isDisplayableVideoUrl(displayRawUrl)
      ? inboxVideoPreviewUrl(displayRawUrl)
      : isDisplayableAudioUrl(displayRawUrl)
      ? inboxAudioPreviewUrl(displayRawUrl)
      : displayRawUrl;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const declaredType = String(item.type || item.contentType || item.content_type || providerMetadata.attachment_type || "").toLowerCase();
    const kind: ThreadMedia["kind"] = isDisplayableImageUrl(url) || declaredType.includes("image")
      ? "image"
      : isDisplayableVideoUrl(url) || declaredType.includes("video")
      ? "video"
      : isDisplayableAudioUrl(url) || declaredType.includes("audio")
      ? "audio"
      : instagramShare
      ? "image"
      : "file";
    const transcript = String(item.transcript || mediaContext.extractedText || mediaContext.extracted_text || (kind === "video" ? mediaContext.summary : "") || "").trim() || undefined;
    const label = String(item.alt || item.filename || providerMetadata.title || mediaContext.summary || (instagramShare ? "Instagram shared post" : "")).trim();
    const mediaLabel = String(item.label || providerMetadata.label || mediaContext.summary || (instagramShare ? label : "") || "").trim();
    media.push({
      url,
      alt: label || (kind === "audio" ? "Voice note" : kind === "video" ? "Video" : kind === "image" ? "MMS image" : "Attachment"),
      kind,
      transcript,
      label: mediaLabel || undefined,
      linkUrl: linkUrl || undefined,
      thumbnailUrl: thumbnailCandidate || undefined,
    });
  }
  return media;
}

function mergedThreadMedia(...groups: ThreadMedia[][]): ThreadMedia[] {
  const merged: ThreadMedia[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

function mediaPreviewText(media: ThreadMedia[]): string {
  if (!media.length) return "";
  if (media.length === 1) {
    if (media[0].label) return media[0].label;
    if (media[0].kind === "audio") return "1 voice note";
    if (media[0].kind === "video") return "1 video";
    if (media[0].kind === "image") return "1 MMS image";
    return "1 attachment";
  }
  const allImages = media.every((item) => item.kind === "image");
  const allAudio = media.every((item) => item.kind === "audio");
  const allVideo = media.every((item) => item.kind === "video");
  if (allImages) return `${media.length} MMS images`;
  if (allAudio) return `${media.length} voice notes`;
  if (allVideo) return `${media.length} videos`;
  return `${media.length} attachments`;
}

function isDisplayableVideoUrl(value: string): boolean {
  return /\.(?:mp4|mov|webm)(?:$|[?#])/i.test(value);
}

function inboxVideoPreviewUrl(value: string): string {
  return value.trim();
}

function isDisplayableAudioUrl(value: string): boolean {
  return /\/api\/media\/audio\?url=/i.test(value) || /\.(?:aac|caf|m4a|mp3|mpeg|ogg|opus|wav|webm)(?:$|[?#])/i.test(value);
}

function inboxAudioPreviewUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.startsWith("/api/media/audio") || raw.startsWith("/api/media/uploads") || raw.startsWith("/uploads/")) return raw;
  // ponytail: Vapi audio is publicly accessible — serve directly, skip Vercel proxy.
  // Twilio requires Basic auth headers so it still needs the proxy.
  if (/^https:\/\/(?:storage|recordings)\.vapi\.ai\//i.test(raw)) return raw;
  if (/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\//i.test(raw)) {
    return `/api/media/audio?url=${encodeURIComponent(raw)}`;
  }
  return raw;
}

function cleanSmsDisplayText(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.trim().match(PROPERTY_DETAILS_RE);
    const nextLine = lines[i + 1] || "";
    if (match && nextLine.trim()) {
      const address = normalizeSmsAddress(match[1]);
      const next = nextLine.trim();
      const nextNormalized = normalizeSmsAddress(next.split("•")[0] || next);
      if (address && nextNormalized.startsWith(address)) {
        const factText = next.includes("•")
          ? next.slice(next.indexOf("•") + 1).trim()
          : "";
        cleaned.push(line);
        if (factText) cleaned.push(factText);
        i += 1;
        continue;
      }
    }
    cleaned.push(line);
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeSmsAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function realChannelToView(rawChannel: string): MessageChannelId {
  const adapted = adaptChannelId(rawChannel);
  if (adapted === "email") return "email";
  if (adapted === "sms") return "sms";
  if (adapted === "voice") return "voice";
  if (adapted === "instagram") return "instagram";
  if (adapted === "messenger") return "messenger";
  if (adapted === "whatsapp") return "whatsapp";
  return "website";
}

function realChannelToViewRaw(view: string): string {
  return view === "website" ? "website_chat" : view;
}

type DayBin = {
  key: string;
  label: string;
  events: number;
  inbound: number;
  outbound: number;
  needReview: number;
  contacts: Set<string>;
  qualifiedContacts: Set<string>;
  appointments: Set<string>;
  transfers: Set<string>;
};

function cleanToken(value?: string): string {
  return String(value || "").trim();
}

function operationalEventText(event: SheetRow): string {
  return [event.event_type, event.ai_action, event.status, event.outcome_code, event.thread_status, event.handoff_reason, event.ended_reason, event.disposition]
    .map(cleanToken)
    .join(" ")
    .toLowerCase();
}

function operationalLeadText(lead: SheetRow): string {
  return [lead.handoff_status, lead.next_action, lead.intent, lead.lead_role, lead.status, lead.source_detail]
    .map(cleanToken)
    .join(" ")
    .toLowerCase();
}

function leadIdentity(lead: SheetRow, fallback: string): string {
  return cleanToken(lead.email) || cleanToken(lead.phone) || cleanToken(lead.thread_ref) || cleanToken(lead.full_name) || fallback;
}

function actualAppointmentEvent(event: SheetRow): boolean {
  if (cleanToken(event.appointment_id)) return true;
  const text = operationalEventText(event);
  return /\b(?:appointment_(?:booked|scheduled|confirmed|created)|showing_(?:booked|scheduled|confirmed)|tour_(?:booked|scheduled|confirmed)|callback_scheduled|booking_confirmed|calendar_(?:event|booking)_created|meeting_scheduled|call_scheduled)\b/i.test(text);
}

function operationalRowTime(row: SheetRow): string {
  return cleanToken(row.event_at) || cleanToken(row.ended_at) || cleanToken(row.started_at) || cleanToken(row.created_at);
}

function actualAppointmentKey(event: SheetRow): string {
  return cleanToken(event.appointment_id)
    || cleanToken(event.provider_message_id)
    || cleanToken(event.call_id)
    || `${conversationKey(event, eventChannel(event))}:${operationalRowTime(event)}:${cleanToken(event.ai_action) || cleanToken(event.event_type)}`;
}

function actualTransferEvent(event: SheetRow): boolean {
  const text = operationalEventText(event);
  return /\b(?:live_transfer(?:_completed)?|transfer_completed|transferred|human_handoff|handoff_alert_sent|handoff_sent|route_human|routed_to_human|agent_handoff|owner_handoff|assistant-forwarded-call|call_forwarded|forwarded_to_(?:agent|owner|human))\b/i.test(text);
}

function actualTransferKey(event: SheetRow): string {
  return cleanToken(event.provider_message_id)
    || cleanToken(event.call_id)
    || `${conversationKey(event, eventChannel(event))}:${operationalRowTime(event)}:${cleanToken(event.ai_action) || cleanToken(event.event_type)}`;
}

function actualQualifiedLead(lead: SheetRow): boolean {
  const score = Number(lead.lead_score || 0);
  const appointmentCount = Number(lead.appointment_count || 0);
  if (Number.isFinite(score) && score >= 70) return true;
  if (Number.isFinite(appointmentCount) && appointmentCount > 0) return true;
  const text = operationalLeadText(lead);
  if (/\b(?:qualified|hot_lead|buyer_ready|ready_buyer|seller_valuation|valuation_ready|showing_scheduled|appointment_booked|appointment_scheduled|preapproved|pre_approved)\b/i.test(text)) return true;
  const hasCoreIntent = /\b(?:buyer|buy|seller|sell|valuation|showing|tour)\b/i.test(text);
  const hasNeed = Boolean(cleanToken(lead.property_interest) || cleanToken(lead.area) || cleanToken(lead.bedrooms) || cleanToken(lead.bathrooms));
  const hasCommitment = Boolean(cleanToken(lead.budget) || cleanToken(lead.timeline) || cleanToken(lead.sell_before_buy));
  return hasCoreIntent && hasNeed && hasCommitment;
}

function actualQualifiedEvent(event: SheetRow): boolean {
  const text = operationalEventText(event);
  return /\b(?:lead_qualified|qualification_completed|qualified_lead|buyer_qualified|seller_qualified|hot_lead|qualification_status:qualified|appointment_booked|appointment_scheduled|showing_scheduled)\b/i.test(text) || actualAppointmentEvent(event);
}

function leadTimestamp(lead: SheetRow): string {
  return cleanToken(lead.last_ai_touch_at) || cleanToken(lead.updated_at) || cleanToken(lead.created_at) || cleanToken(lead.event_at);
}

function buildOperationalMetrics(data: AgentInboxData) {
  const qualified = new Set<string>();
  data.leads.forEach((lead, index) => {
    if (actualQualifiedLead(lead)) qualified.add(leadIdentity(lead, `lead:${index}`));
  });
  const operationalRows = [...data.events, ...data.voiceCalls];
  operationalRows.forEach((event) => {
    if (actualQualifiedEvent(event)) qualified.add(conversationKey(event, eventChannel(event)) || actualAppointmentKey(event));
  });
  const appointments = new Set(operationalRows.filter(actualAppointmentEvent).map(actualAppointmentKey));
  const transfers = new Set(operationalRows.filter(actualTransferEvent).map(actualTransferKey));
  return { qualified: qualified.size, appointments: appointments.size, transfers: transfers.size };
}

// Build 14-day day bins from events, returning per-day aggregates.
function buildDayBins(events: SheetRow[]) {
  const now = new Date();
  const bins: DayBin[] = [];
  const index = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    index.set(key, bins.length);
    bins.push({
      key,
      label: dayLabelFormatter.format(d),
      events: 0,
      inbound: 0,
      outbound: 0,
      needReview: 0,
      contacts: new Set(),
      qualifiedContacts: new Set(),
      appointments: new Set(),
      transfers: new Set(),
    });
  }
  for (const event of events) {
    const parsed = new Date(event.event_at || "");
    if (Number.isNaN(parsed.getTime())) continue;
    const slot = index.get(dayKey(parsed));
    if (slot === undefined) continue;
    const bin = bins[slot];
    bin.events += 1;
    if (event.direction === "inbound") bin.inbound += 1;
    else if (event.direction === "outbound") bin.outbound += 1;
    if (eventNeedsHuman(event)) bin.needReview += 1;
    bin.contacts.add(event.thread_ref || event.email || event.phone || event.full_name || "unknown");
    if (actualQualifiedEvent(event)) bin.qualifiedContacts.add(conversationKey(event, eventChannel(event)) || actualAppointmentKey(event));
    if (actualAppointmentEvent(event)) bin.appointments.add(actualAppointmentKey(event));
    if (actualTransferEvent(event)) bin.transfers.add(actualTransferKey(event));
  }
  return bins;
}

function addQualifiedLeadsToDayBins(bins: DayBin[], leads: SheetRow[]) {
  const index = new Map(bins.map((bin, slot) => [bin.key, slot]));
  leads.forEach((lead, leadIndex) => {
    if (!actualQualifiedLead(lead)) return;
    const parsed = new Date(leadTimestamp(lead));
    if (Number.isNaN(parsed.getTime())) return;
    const slot = index.get(dayKey(parsed));
    if (slot === undefined) return;
    bins[slot].qualifiedContacts.add(leadIdentity(lead, `lead:${leadIndex}`));
  });
}

function addVoiceOperationsToDayBins(bins: DayBin[], voiceCalls: SheetRow[]) {
  const index = new Map(bins.map((bin, slot) => [bin.key, slot]));
  voiceCalls.forEach((call) => {
    const parsed = new Date(operationalRowTime(call));
    if (Number.isNaN(parsed.getTime())) return;
    const slot = index.get(dayKey(parsed));
    if (slot === undefined) return;
    if (actualQualifiedEvent(call)) bins[slot].qualifiedContacts.add(conversationKey(call, eventChannel(call)) || actualAppointmentKey(call));
    if (actualAppointmentEvent(call)) bins[slot].appointments.add(actualAppointmentKey(call));
    if (actualTransferEvent(call)) bins[slot].transfers.add(actualTransferKey(call));
  });
}

function buildSparkline(bins: ReturnType<typeof buildDayBins>): { sparkline: number[]; peakDay: string; peakCount: number } {
  const sparkline = bins.map((b) => b.events);
  let peakIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].events > bins[peakIdx].events) peakIdx = i;
  return { sparkline, peakDay: bins[peakIdx]?.label || "", peakCount: bins[peakIdx]?.events || 0 };
}

function responseSamplesByDay(events: SheetRow[]): Map<string, number[]> {
  const byThread = new Map<string, SheetRow[]>();
  for (const event of events) {
    const key = conversationKey(event, eventChannel(event));
    const time = eventTimeValue(event);
    if (!key || !time) continue;
    const list = byThread.get(key) || [];
    list.push(event);
    byThread.set(key, list);
  }

  const byDay = new Map<string, number[]>();
  for (const list of byThread.values()) {
    const sorted = [...list].sort((a, b) => eventTimeValue(a) - eventTimeValue(b));
    for (let i = 0; i < sorted.length; i += 1) {
      const inbound = sorted[i];
      if (inbound.direction !== "inbound") continue;
      const inboundMs = eventTimeValue(inbound);
      if (!inboundMs) continue;
      const reply = sorted.slice(i + 1).find((event) => event.direction !== "inbound" && eventTimeValue(event) >= inboundMs);
      if (!reply) continue;
      const replyMs = eventTimeValue(reply);
      if (!replyMs) continue;
      const seconds = Math.round((replyMs - inboundMs) / 1000);
      if (seconds < 0 || seconds > 7 * 24 * 60 * 60) continue;
      const day = dayKey(new Date(inboundMs));
      const samples = byDay.get(day) || [];
      samples.push(seconds);
      byDay.set(day, samples);
    }
  }
  return byDay;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildEmailMessages(events: SheetRow[], data: AgentInboxData): EmailMessage[] {
  return events.map((event, i) => {
    const isInbound = event.direction === "inbound";
    const isOwner = isInbound && (event.source || "").toLowerCase().includes("owner");
    const direction: EmailMessage["direction"] = !isInbound ? "iris" : isOwner ? "owner" : "inbound";
    const body = eventText(event);
    const subject = isInbound ? emailSubject(event) : undefined;
    // Iris's outbound replies are stored as full HTML (with embedded property
    // cards/images). Detect that and route it to `html` so the UI renders the
    // real email — including the neat embedded property previews — instead of
    // showing raw markup as plain text.
    const rawMessage = event.message_text || "";
    const html = looksLikeHtml(rawMessage) ? rewriteEmailHtmlForInbox(rawMessage, data.properties) : undefined;
    const media = eventMedia(event);
    return {
      id: messageEventId(event, `${event.thread_ref || event.email || i}-${i}`),
      eventId: messageEventId(event, `${event.thread_ref || event.email || i}-${i}`),
      sender: direction === "iris" ? "Iris" : direction === "owner" ? "Owner" : (event.full_name || event.email || "Contact"),
      direction,
      time: formatEventTimeShort(event.event_at),
      subject,
      body: html ? undefined : (body || undefined),
      html,
      media,
      showSchedule: !isInbound && !html && i === events.length - 1,
      flag: event.handoff_reason || undefined,
    };
  });
}

function buildEmailThreads(data: AgentInboxData): EmailThread[] {
  const entries = buildChannelThreads(data.events.filter(isRealEstateEmailEvent), "email");
  return entries.map(([key, events]) => {
    const latest = latestEvent(events);
    const category = leadCategoryFor(data.threadCategories[key] || data.threadCategories[latest.thread_ref || ""], data.inboxCategories);
    const needsReview = threadNeedsHuman(events);
    const reason = [...events].reverse().find((e) => e.handoff_reason)?.handoff_reason;
    const latestMedia = eventMedia(latest);
    return {
      id: key,
      contact: latest.email || key,
      name: latest.full_name || latest.email || key,
      time: formatEventTimeShort(latest.event_at),
      preview: (emailBodyPreview(latest) || mediaPreviewText(latestMedia)).slice(0, 160),
      messageCount: events.length,
      needsReview,
      reviewReason: reason,
      category,
      messages: buildEmailMessages(events, data),
    };
  });
}

function threadReadState(data: AgentInboxData, channel: string, threadRef: string) {
  return data.threadReadStates?.[`${channel}:${threadRef}`] || data.threadReadStates?.[threadRef];
}

function unreadStateForEvents(data: AgentInboxData, channel: string, threadRef: string, events: SheetRow[]) {
  const state = threadReadState(data, channel, threadRef);
  const seenAt = Date.parse(state?.seenAt || state?.seenEventAt || "");
  const lastSeenMs = Number.isFinite(seenAt) ? seenAt : 0;
  const inboundEvents = events.filter((event) => event.direction === "inbound");
  const unreadCount = inboundEvents.filter((event) => eventTimeValue(event) > lastSeenMs).length;
  const lastInbound = inboundEvents.reduce<SheetRow | null>((latest, event) => {
    if (!latest) return event;
    return eventTimeValue(event) >= eventTimeValue(latest) ? event : latest;
  }, null);
  return {
    unreadCount,
    seen: unreadCount === 0,
    lastSeenAt: state?.seenAt || "",
    lastInboundAt: lastInbound?.event_at || "",
  };
}

function buildSmsThreads(data: AgentInboxData): SmsThread[] {
  const entries = buildChannelThreads(data.events, "sms");
  return entries.map(([key, events]) => {
    const latest = latestEvent(events);
    const category = leadCategoryFor(data.threadCategories[key] || data.threadCategories[latest.thread_ref || ""], data.inboxCategories);
    const unread = unreadStateForEvents(data, "sms", key, events);
    const messages: SmsMessage[] = events.map((event, i) => {
      const parsed = smsTextAndMedia(eventText(event) || event.summary || "");
      const media = mergedThreadMedia(parsed.media, eventMedia(event));
      const id = messageEventId(event, `${key}-${i}`);
      return {
        id,
        eventId: id,
        direction: smsMessageDirection(event),
        time: formatEventTimeShort(event.event_at),
        body: parsed.body,
        html: parsed.html,
        media,
      };
    });
    const latestSms = smsTextAndMedia(eventText(latest) || latest.summary || "");
    const latestMedia = mergedThreadMedia(latestSms.media, eventMedia(latest));
    return {
      id: key,
      contact: latest.phone || latest.full_name || key,
      time: formatEventTimeShort(latest.event_at),
      preview: latestSms.body || mediaPreviewText(latestMedia) || (latest.summary || "").slice(0, 80),
      messageCount: events.length,
      unreadCount: unread.unreadCount,
      seen: unread.seen,
      lastSeenAt: unread.lastSeenAt,
      lastInboundAt: unread.lastInboundAt,
      category,
      messages,
    };
  });
}

function buildTextThreadsForView(data: AgentInboxData, view: "instagram" | "messenger" | "whatsapp" | "website"): SmsThread[] {
  const viewEvents = data.events.filter((event) => realChannelToView(event.channel || "") === view);
  const threadAliases = socialThreadAliases(viewEvents);
  const groups = viewEvents
    .reduce<Record<string, SheetRow[]>>((acc, event) => {
      const rawChannel = eventChannel(event);
      const rawThreadKey = socialRawThreadKey(event, rawChannel);
      const eventKey = conversationKey(event, rawChannel);
      const key = threadAliases[rawThreadKey] || threadAliases[eventKey] || eventKey;
      acc[key] ||= [];
      acc[key].push(event);
      return acc;
    }, {});

  return Object.entries(groups)
    .map(([key, events]) => {
      const sorted = [...events].sort((a, b) => eventTimeValue(a) - eventTimeValue(b));
      const visibleEvents = sorted.filter((event) => !isReactionEvent(event));
      const reactionMap = reactionsByTarget(sorted);
      const latest = latestEvent(visibleEvents.length ? visibleEvents : sorted);
      const category = leadCategoryFor(data.threadCategories[key] || data.threadCategories[latest.thread_ref || ""], data.inboxCategories);
      const messages: SmsMessage[] = visibleEvents.map((event, i) => {
        const parsed = smsTextAndMedia(eventText(event) || event.summary || "");
        const media = mergedThreadMedia(parsed.media, eventMedia(event));
        const id = messageEventId(event, `${key}-${i}`);
        const providerMessageId = eventProviderMessageId(event);
        return {
          id,
          eventId: id,
          providerMessageId,
          direction: smsMessageDirection(event),
          time: formatEventTimeShort(event.event_at),
          body: parsed.body,
          html: parsed.html,
          media,
          reactions: providerMessageId ? reactionMap.get(providerMessageId) : undefined,
        };
      });
      const latestText = smsTextAndMedia(eventText(latest) || latest.summary || "");
      const latestMedia = mergedThreadMedia(latestText.media, eventMedia(latest));
      const unread = unreadStateForEvents(data, view, key, sorted);
      const fallbackUsed = sorted.some(isComposioFallbackEvent);
      return {
        sortValue: eventTimeValue(latest),
        thread: {
        id: key,
        contact: threadIdentity(latest.thread_ref || key, sorted, eventChannel(latest)),
        replyTo: ["instagram", "messenger"].includes(eventChannel(latest))
          ? socialReplyTarget(key, sorted, eventChannel(latest))
          : latest.phone || key,
        time: formatEventTimeShort(latest.event_at),
        preview: latestText.body || mediaPreviewText(latestMedia) || (latest.summary || "").slice(0, 80),
        messageCount: visibleEvents.length,
        unreadCount: unread.unreadCount,
        seen: unread.seen,
        lastSeenAt: unread.lastSeenAt,
        lastInboundAt: unread.lastInboundAt,
        fallbackUsed,
        category,
        messages,
        },
      };
    })
    .sort((a, b) => b.sortValue - a.sortValue)
    .map((entry) => entry.thread);
}

function isComposioFallbackEvent(event: SheetRow): boolean {
  const source = String(event.source || "").toLowerCase();
  const aiAction = String(event.ai_action || "").toLowerCase();
  const metadata = String((event as SheetRow & { provider_metadata?: unknown }).provider_metadata || "").toLowerCase();
  return source === "composio_fallback"
    || source.includes("composio_fallback")
    || aiAction.startsWith("fallback_")
    || metadata.includes('"fallback":true');
}

function socialRawThreadKey(event: SheetRow, channel: string): string {
  const threadRef = String(event.thread_ref || "").trim();
  const prefix = `${channel}:`;
  if (threadRef.startsWith(prefix)) return threadRef.slice(prefix.length).trim();
  return threadRef || String(event.phone || event.email || event.full_name || "").trim() || "unknown";
}

function socialThreadAliases(events: SheetRow[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const event of events) {
    const channel = eventChannel(event);
    if (!["instagram", "messenger"].includes(channel)) continue;
    const rawThreadKey = socialRawThreadKey(event, channel);
    const identityKey = conversationKey(event, channel);
    if (!rawThreadKey || !identityKey || rawThreadKey === identityKey || identityKey === "unknown") continue;
    aliases[rawThreadKey] = identityKey;
  }
  return aliases;
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

function socialSendTargetKeys(channel: string): string[] {
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
  const metadata = jsonObject(event.provider_metadata);
  const source = String(metadata.source || event.source || "").toLowerCase();
  return status.includes("browser_backfill_verified_recipient") || source.includes("authenticated_browser");
}

function socialReplyTarget(threadKey: string, events: SheetRow[], channel: string): string {
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
    const threadRef = String(event.thread_ref || "").trim();
    if (threadRef.startsWith(`${channel}:`)) {
      const stripped = threadRef.slice(channel.length + 1).trim();
      if (stripped) return stripped;
    }
  }
  if (verifiedBrowserTarget) return verifiedBrowserTarget;
  if (browserThreadTarget) return browserThreadTarget;
  if (sawBrowserImport && !sawNonBrowserImport) return "";
  if (threadKey.startsWith(`${channel}:`)) return threadKey.slice(channel.length + 1).trim();
  return "";
}

function smsMessageDirection(event: SheetRow): SmsMessage["direction"] {
  if (event.direction === "inbound") return "inbound";
  const source = String(event.source || "").toLowerCase();
  const agentName = String(event.agent_name || "").toLowerCase();
  if (source.includes("human") || source.includes("owner") || agentName === "owner") return "owner";
  return "iris";
}

function buildVoiceContacts(data: AgentInboxData): VoiceContact[] {
  const entries = buildVoiceCallThreads(data.voiceCalls);
  return entries.map(([key, calls]) => {
    const latest = calls[0] || {};
    const contact = voiceThreadIdentity(key, calls);
    const allTurns: CallTurn[] = [];
    const callsOut: Call[] = calls.map((call, i) => {
      const transcript = voiceCallTranscriptSource(call);
      const parsed = parseVoiceTranscript(transcript);
      const turns: CallTurn[] = (parsed || []).map((t) => ({
        speaker: t.direction === "outbound" ? "Iris" : "Lead",
        text: t.text,
      }));
      const firstLeadTurn = turns.find((turn) => turn.speaker === "Lead");
      allTurns.push(...turns);
      return {
        id: call.call_id || `${key}-${i}`,
        time: formatEventTimeShort(call.ended_at || call.started_at || call.event_at || call.created_at),
        duration: formatCallDuration(callDurationSeconds(call)),
        outcome: callOutcome(call),
        turns,
        report: usableActivityText(call.summary || "", firstLeadTurn?.text || "Voice call recorded.", 320),
        recordingUrl: call.recording_url || undefined,
      };
    });
    return {
      id: key,
      contact,
      phone: latest.phone || calls.find((c) => c.phone)?.phone || undefined,
      time: formatEventTimeShort(latest.ended_at || latest.started_at || latest.event_at || latest.created_at),
      summary: usableActivityText(latest.summary || "", allTurns.find((turn) => turn.speaker === "Lead")?.text || allTurns[0]?.text || "Voice call recorded."),
      callCount: calls.length,
      tag: callOutcome(latest),
      calls: callsOut,
    };
  });
}

function buildProperties(data: AgentInboxData): Property[] {
  return data.properties.map((p, i) => ({
    id: p.address || `p${i}`,
    address: p.address || "",
    city: p.city || "",
    price: formatPrice(p.price),
    priceNum: p.price || "",
    beds: p.beds || "",
    baths: p.baths || "",
    sqft: p.sqft || "",
    year: p.year_built || "",
    type: p.property_type || "",
    status: p.status || undefined,
    neighborhood: p.neighborhood || "",
    zip: p.zip || "",
    photo: p.photo_url || undefined,
    broker: p.agent_name || "",
  }));
}

function buildChannels(data: AgentInboxData): InboxModel["channels"] {
  const counts: Record<string, number> = {};
  for (const event of data.events) {
    const view = realChannelToView(event.channel || "");
    counts[view] = (counts[view] || 0) + 1;
  }
  // Voice events are stripped from data.events into data.voiceCalls — count them here
  // so the Voice channel shows its real volume instead of 0.
  counts.voice = (counts.voice || 0) + (data.voiceCalls?.length || 0);
  counts.all = data.events.length + (data.voiceCalls?.length || 0);
  const order: ChannelId[] = ["all", "email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
  // Show every channel in the rail (user wants the full nav present), not only ones with traffic.
  return order
    .map((id) => ({
      id,
      label: id === "all" ? "All channels" : channelMeta[id as MessageChannelId].label,
      icon: id === "all" ? channelMeta.website.icon : channelMeta[id as MessageChannelId].icon,
      count: counts[id] || 0,
      accent: id === "all" ? "#818cf8" : channelMeta[id as MessageChannelId].accent,
    }));
}

function buildActivityEvents(data: AgentInboxData): ActivityEvent[] {
  const messageEvents = [...data.events]
    .filter((event) => eventChannel(event) !== "email" || isRealEstateEmailEvent(event))
    .map((event, i) => {
      const view = realChannelToView(event.channel || "");
      const rawChannel = eventChannel(event);
      const isAi = event.direction !== "inbound";
      const kind: ActivityEvent["kind"] = view === "voice" ? "voice" : isAi ? "ai_reply" : "inbound";
      const status: ActivityEvent["status"] = eventNeedsHuman(event) ? "Review" : isAi ? "Sent" : "New";
      const body = eventText(event) || event.summary || "";
      const fallback = view === "voice" ? "Voice call recorded." : "";
      const threadId = conversationKey(event, rawChannel);
      const eventId = messageEventId(event, `event-${i}`);
      const actor = ["instagram", "messenger"].includes(rawChannel)
        ? socialContactIdentity(event, rawChannel)
        : event.email || event.phone || event.full_name || "unknown";
      return {
        sortValue: eventTimeValue(event),
        event: {
          id: eventId,
          channel: view,
          threadId,
          threadRef: event.thread_ref || threadId,
          eventId,
          kind,
          actor,
          intent: event.event_type || undefined,
          body: usableActivityText(body, fallback),
          time: formatEventTimeShort(event.event_at),
          status,
          isHuman: !isAi,
        } satisfies ActivityEvent,
      };
    });
  const voiceEvents = [...data.voiceCalls].map((call, i) => {
    const identity = voiceThreadIdentity(call.thread_ref || call.call_id || `voice-${i}`, [call]);
    const duration = formatCallDuration(callDurationSeconds(call));
    const outcome = callOutcome(call);
    const transcript = parseVoiceTranscript(voiceCallTranscriptSource(call));
    const firstLeadTurn = transcript.find((turn) => turn.direction === "inbound");
    const body = usableActivityText(call.summary || "", firstLeadTurn?.text || "Voice call recorded.");
    const time = call.ended_at || call.started_at || call.event_at || call.created_at;
    return {
      sortValue: voiceCallTimeValue(call),
      event: {
        id: call.call_id || call.thread_ref || `voice-${i}`,
        channel: "voice",
        threadId: voiceCallKey(call),
        threadRef: call.thread_ref || call.call_id || voiceCallKey(call),
        eventId: call.call_id || undefined,
        kind: "voice",
        actor: call.phone || call.full_name || identity,
        intent: `${outcome} · ${duration}`,
        body,
        time: formatEventTimeShort(time),
        status: outcome === "assistant-forwarded-call" ? "Review" : "New",
        isHuman: true,
      } satisfies ActivityEvent,
    };
  });

  return [...messageEvents, ...voiceEvents]
    .sort((a, b) => b.sortValue - a.sortValue)
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((entry) => entry.event);
}

function eventMediaItems(event: SheetRow): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(event.media_json || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function eventHasMedia(event: SheetRow): boolean {
  return eventMediaItems(event).length > 0 || /(?:MMS|SMS|WhatsApp|Social DM)?\s*(?:image|photo|media|attachment|audio|voice note|video):/i.test(event.message_text || "");
}

function eventHasTranscript(event: SheetRow): boolean {
  if (/voice note transcript:/i.test(event.message_text || "")) return true;
  return eventMediaItems(event).some((item) => {
    const meta = item.providerMetadata && typeof item.providerMetadata === "object" ? item.providerMetadata as Record<string, unknown> : {};
    const mediaContext = meta.mediaContext && typeof meta.mediaContext === "object" ? meta.mediaContext as Record<string, unknown> : {};
    return Boolean(item.transcript || mediaContext.extractedText || mediaContext.extracted_text || mediaContext.summary);
  });
}

function buildPipelineStages(data: AgentInboxData, operationalMetrics = buildOperationalMetrics(data)) {
  const events = data.events;
  const activeThreads = Object.keys(data.threads).length;
  const qualified = operationalMetrics.qualified;
  const appointments = operationalMetrics.appointments;
  const transfers = operationalMetrics.transfers;
  const media = events.filter(eventHasMedia).length;
  return [
    { key: "new", label: "New lead", value: data.leads.length, color: "#c4b5fd" },
    { key: "contacted", label: "Contacted", value: Math.max(activeThreads, events.filter((event) => event.direction === "inbound").length), color: "#a78bfa" },
    { key: "qualified", label: "Qualified", value: qualified, color: "#8b5cf6" },
    { key: "appointment", label: "Appointment", value: appointments, color: "#7c3aed" },
    { key: "transfer", label: "Transfer", value: transfers, color: "#6d28d9" },
    { key: "media", label: "Media handled", value: media, color: "#5b21b6" },
  ];
}

function buildChannelStats(data: AgentInboxData): Record<"all" | MessageChannelId, ChannelStats> {
  const views: Array<"all" | MessageChannelId> = ["all", "email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
  const result = {} as Record<"all" | MessageChannelId, ChannelStats>;
  for (const view of views) {
    const events = view === "all" ? data.events : data.events.filter((event) => realChannelToView(event.channel || "") === view);
    const threadKeys = new Set(events.map((event) => conversationKey(event, view === "all" ? eventChannel(event) : realChannelToViewRaw(view))));
    const inbound = events.filter((event) => event.direction === "inbound").length;
    const aiReplies = events.filter((event) => event.direction !== "inbound").length;
    const latest = events[events.length - 1];
    const grouped = events.reduce<Record<string, SheetRow[]>>((acc, event) => {
      const channel = eventChannel(event);
      const key = conversationKey(event, channel);
      acc[key] ||= [];
      acc[key].push(event);
      return acc;
    }, {});
    const reviewCount = Object.values(grouped).filter(threadNeedsHuman).length;
    const mediaCount = events.filter(eventHasMedia).length;
    const replyCoverage = inbound ? Math.min(100, Math.round((aiReplies / inbound) * 100)) : 100;
    const qualityScore = Math.max(0, Math.min(100, Math.round(replyCoverage - reviewCount * 8 + (mediaCount ? 4 : 0))));
    const latestChannel = latest ? eventChannel(latest) : "";
    const latestThreadId = latest ? conversationKey(latest, latestChannel) : "";
    const latestThreadEvents = latest
      ? events.filter((event) => {
        const channel = eventChannel(event);
        return conversationKey(event, channel) === latestThreadId || (latest.thread_ref && event.thread_ref === latest.thread_ref);
      })
      : [];
    result[view] = {
      events: events.length,
      threads: threadKeys.size,
      inbound,
      aiReplies,
      reviewCount,
      mediaCount,
      replyCoverage,
      qualityScore,
      lastActivity: latest
        ? {
          contact: threadIdentity(latest.thread_ref || latestThreadId, latestThreadEvents, latestChannel),
          message: usableActivityText(eventText(latest) || latest.summary || "", latest.summary || ""),
          status: eventNeedsHuman(latest) ? "Review" : latest.direction === "inbound" ? "New" : "Sent",
          when: formatEventTimeShort(latest.event_at),
        }
        : null,
      humanReview: reviewCount ? "flagged" : "clear",
    };
  }
  return result;
}

function buildChannelQuality(stats: Record<"all" | MessageChannelId, ChannelStats>) {
  const views: MessageChannelId[] = ["email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
  return views.map((channel) => ({
    channel,
    label: channelMeta[channel].label,
    inbound: stats[channel].inbound,
    replies: stats[channel].aiReplies,
    media: stats[channel].mediaCount,
    review: stats[channel].reviewCount,
    quality: stats[channel].qualityScore,
  }));
}

function buildReviewQueue(data: AgentInboxData): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const [key, draft] of Object.entries(data.drafts)) {
    const parsed = parseDraftKey(key);
    if (!parsed || !draft.body.trim()) continue;
    if (!["email", "sms", "whatsapp"].includes(parsed.channel)) continue;
    const events = data.events.filter(
      (event) =>
        eventChannel(event) === parsed.channel &&
        (conversationKey(event, parsed.channel) === parsed.threadRef || event.thread_ref === parsed.threadRef),
    );
    const latest = latestEvent(events);
    const inbound = [...events].reverse().find((event) => event.direction === "inbound") || latest;
    const view = realChannelToView(parsed.channel);
    items.push({
      id: key,
      key,
      channel: view,
      contact: threadIdentity(parsed.threadRef, events, parsed.channel),
      reason: draft.reason || draft.needs_human ? "Flagged for human approval" : "AI draft ready for review",
      receivedAt: formatEventTimeShort(inbound.event_at || draft.updated_at),
      intent: draft.category_slug || draft.next_action || "review",
      inbound: eventText(inbound) || "No inbound text captured.",
      draft: draft.body,
      confidence: draft.confidence,
      threadRef: parsed.threadRef,
    });
  }
  return items.sort((a, b) => new Date(b.receivedAt || "").getTime() - new Date(a.receivedAt || "").getTime());
}

export function adaptInboxData(data: AgentInboxData): InboxModel {
  const bins = buildDayBins(data.events);
  addQualifiedLeadsToDayBins(bins, data.leads);
  addVoiceOperationsToDayBins(bins, data.voiceCalls);
  const { sparkline, peakDay, peakCount } = buildSparkline(bins);
  const responsesByDay = responseSamplesByDay(data.events);
  const todayResponses = responsesByDay.get(dayKey(new Date())) || [];
  const avgResponseSeconds = average(todayResponses);
  const needReview = data.metrics.needs_human;
  const handled = data.metrics.inbound_messages + data.metrics.outbound_replies;
  const aiRate = handled ? Math.round((data.metrics.outbound_replies / handled) * 100) : 0;
  const channelStats = buildChannelStats(data);
  const operationalMetrics = buildOperationalMetrics(data);
  const pipelineStages = buildPipelineStages(data, operationalMetrics);
  const mediaItems = data.events.filter(eventHasMedia).length;
  const mediaTranscripts = data.events.filter(eventHasTranscript).length;

  return {
    channels: buildChannels(data),
    channelMeta,
    channelAccounts: { ...channelAccounts, ...data.channelAccounts },
    leadCategories: data.inboxCategories.length
      ? data.inboxCategories.map((c) => ({
        id: categorySlugToId(c.slug),
        label: c.name,
        color: c.color || "#8b5cf6",
        slug: c.slug,
        enabled: c.enabled,
        gmailLabelName: c.gmail_label_name,
      }))
      : leadCategories,
    activityEvents: buildActivityEvents(data),
    reviewQueue: buildReviewQueue(data),
    channelStats,
    emailThreads: buildEmailThreads(data),
    smsThreads: buildSmsThreads(data),
    textThreads: {
      instagram: buildTextThreadsForView(data, "instagram"),
      messenger: buildTextThreadsForView(data, "messenger"),
      whatsapp: buildTextThreadsForView(data, "whatsapp"),
      website: buildTextThreadsForView(data, "website"),
    },
    voiceContacts: buildVoiceContacts(data),
    properties: buildProperties(data),
    propertyHealth: {
      score: data.propertyHealth.total
        ? Math.round(((data.propertyHealth.total - data.propertyHealth.missing_core) / data.propertyHealth.total) * 100)
        : 0,
      total: data.propertyHealth.total,
      clean: data.propertyHealth.total
        ? `${Math.round(((data.propertyHealth.total - data.propertyHealth.missing_core) / data.propertyHealth.total) * 100)}% clean`
        : "0% clean",
      missingCore: data.propertyHealth.missing_core,
      duplicateGroups: data.propertyHealth.duplicate_groups,
      rows: data.propertyHealth.total,
    },
    metrics: {
      needReview,
      leadsTotal: data.metrics.lead_count,
      events: data.metrics.event_count,
      threads: Object.keys(data.threads).length,
      inbound: data.metrics.inbound_messages,
      aiReplies: data.metrics.outbound_replies,
      flaggedThreads: data.metrics.needs_human,
      propertyHealth: data.propertyHealth.total
        ? Math.round(((data.propertyHealth.total - data.propertyHealth.missing_core) / data.propertyHealth.total) * 100)
        : 0,
      activityDays: DAYS,
      peakDay,
      peakCount,
      avgResponseSeconds,
      avgResponseLabel: formatResponseDuration(avgResponseSeconds),
      avgResponseSamples: todayResponses.length,
      qualifiedLeads: operationalMetrics.qualified,
      appointments: operationalMetrics.appointments,
      liveTransfers: operationalMetrics.transfers,
      mediaItems,
      mediaTranscripts,
    },
    pipelineStages,
    channelQuality: buildChannelQuality(channelStats),
    sparkline,
    statTrends: {
      needReview: bins.map((b) => ({ value: b.needReview })),
      leadsTotal: bins.map((b) => ({ value: b.contacts.size })),
      events: bins.map((b) => ({ value: b.events })),
      aiRate: bins.map((b) => {
        const h = b.inbound + b.outbound;
        return { value: h ? Math.round((b.outbound / h) * 100) : 0 };
      }),
      avgResponse: bins.map((b) => ({ value: average(responsesByDay.get(b.key) || []) })),
      qualified: bins.map((b) => ({ value: b.qualifiedContacts.size })),
      appointments: bins.map((b) => ({ value: b.appointments.size })),
      transfers: bins.map((b) => ({ value: b.transfers.size })),
    },
    drafts: data.drafts as Record<string, unknown>,
    inboxSettings: data.inboxSettings,
  };
}

// Re-export for the ReviewPanel action wiring.
export type { AiDraft };
