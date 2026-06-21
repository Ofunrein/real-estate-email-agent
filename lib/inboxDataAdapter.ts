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
const MEDIA_LABEL_RE = /^\s*(?:MMS|SMS)?\s*(?:image|photo|media|attachment|Social DM image)\s*:\s*(.+?)\s*$/i;
const SYSTEM_PROMPT_RE = /\b(you are\s+(?:iris|arya|a real estate)|brand voice|assistant\s+(?:for|to)\s+(?:austin|the)|tool(?:s|ing)?|system prompt|developer instruction|never reveal|do not reveal|call script)\b/i;
const NON_REAL_ESTATE_EMAIL_RE = /\b(security alert|verification code|password reset|new sign-in|login attempt|oauth application|deployment failed|workflow run|unsubscribe|manage preferences|view in browser|privacy policy|trial discount|end of trial|webinar|newsletter|limited time|book a demo|schedule a demo|product update|sales automation|marketing automation)\b/i;
const REAL_ESTATE_EMAIL_RE = /\b(home|house|condo|property|listing|showing|tour|buy|buyer|sell|seller|rent|lease|realtor|real estate|bedroom|bath|mortgage|valuation|pre.?approved|appointment|zillow|mls)\b/i;
const STREET_ADDRESS_RE = /\b\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,7}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|pkwy|parkway|pl|place|path|trl|trail|ter|terrace)\b/i;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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
  return parsed.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
  const text = `${event.source_detail || ""}\n${event.event_type || ""}\n${event.summary || ""}\n${event.message_text || ""}`;
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

function smsTextAndMedia(raw: string): { body: string; html?: string; media: Array<{ url: string; alt: string }> } {
  const media: Array<{ url: string; alt: string }> = [];
  const seen = new Set<string>();
  const textLines: string[] = [];

  const addMedia = (url: string) => {
    const displayUrl = inboxImagePreviewUrl(url.trim().replace(/[.,;]+$/, ""));
    if (!displayUrl || !isDisplayableImageUrl(displayUrl) || seen.has(displayUrl)) return false;
    seen.add(displayUrl);
    media.push({ url: displayUrl, alt: "MMS image" });
    return true;
  };

  for (const line of raw.split("\n")) {
    const labelMatch = line.match(MEDIA_LABEL_RE);
    if (labelMatch) {
      const urls = [...labelMatch[1].matchAll(MEDIA_URL_RE)].map((match) => match[1]);
      if (urls.length && urls.every(addMedia)) continue;
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

  const body = textLines.join("\n").replace(/\n{3,}$/g, "\n\n").trim();
  return {
    body,
    html: looksLikeHtml(body) ? rewriteEmailHtmlForInbox(body) : undefined,
    media,
  };
}

type MessageChannelId = Exclude<ChannelId, "all" | "properties" | "imports">;

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

// Build 14-day day bins from events, returning per-day aggregates.
function buildDayBins(events: SheetRow[]) {
  const now = new Date();
  const bins: {
    key: string;
    label: string;
    events: number;
    inbound: number;
    outbound: number;
    needReview: number;
    contacts: Set<string>;
  }[] = [];
  const index = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    index.set(key, bins.length);
    bins.push({ key, label: d.toLocaleDateString([], { month: "short", day: "numeric" }), events: 0, inbound: 0, outbound: 0, needReview: 0, contacts: new Set() });
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
  }
  return bins;
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
    return {
      id: `${event.thread_ref || event.email || i}-${i}`,
      sender: direction === "iris" ? "Iris" : direction === "owner" ? "Owner" : (event.full_name || event.email || "Contact"),
      direction,
      time: formatEventTimeShort(event.event_at),
      subject,
      body: html ? undefined : (body || undefined),
      html,
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
    const needsReview = events.some(eventNeedsHuman);
    const reason = [...events].reverse().find((e) => e.handoff_reason)?.handoff_reason;
    return {
      id: key,
      contact: latest.email || key,
      name: latest.full_name || latest.email || key,
      time: formatEventTimeShort(latest.event_at),
      preview: emailBodyPreview(latest).slice(0, 160),
      messageCount: events.length,
      needsReview,
      reviewReason: reason,
      category,
      messages: buildEmailMessages(events, data),
    };
  });
}

function buildSmsThreads(data: AgentInboxData): SmsThread[] {
  const entries = buildChannelThreads(data.events, "sms");
  return entries.map(([key, events]) => {
    const latest = latestEvent(events);
    const category = leadCategoryFor(data.threadCategories[key] || data.threadCategories[latest.thread_ref || ""], data.inboxCategories);
    const messages: SmsMessage[] = events.map((event, i) => {
      const parsed = smsTextAndMedia(eventText(event) || event.summary || "");
      return {
        id: `${key}-${i}`,
        direction: event.direction === "inbound" ? "inbound" : "iris",
        time: formatEventTimeShort(event.event_at),
        body: parsed.body,
        html: parsed.html,
        media: parsed.media,
      };
    });
    const latestSms = smsTextAndMedia(eventText(latest) || latest.summary || "");
    return {
      id: key,
      contact: latest.phone || latest.full_name || key,
      time: formatEventTimeShort(latest.event_at),
      preview: latestSms.body || (latestSms.media.length ? `${latestSms.media.length} MMS image${latestSms.media.length === 1 ? "" : "s"}` : (latest.summary || "").slice(0, 80)),
      messageCount: events.length,
      category,
      messages,
    };
  });
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
      label: id === "all" ? "All channels" : channelMeta[id as Exclude<ChannelId, "all" | "properties" | "imports">].label,
      icon: id === "all" ? channelMeta.website.icon : channelMeta[id as Exclude<ChannelId, "all" | "properties" | "imports">].icon,
      count: counts[id] || 0,
      accent: id === "all" ? "#818cf8" : channelMeta[id as Exclude<ChannelId, "all" | "properties" | "imports">].accent,
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
      return {
        sortValue: eventTimeValue(event),
        event: {
          id: event.gmail_message_id || event.thread_ref || `event-${i}`,
          channel: view,
          threadId,
          threadRef: event.thread_ref || threadId,
          eventId: event.gmail_message_id || event.appointment_id || undefined,
          kind,
          actor: event.email || event.phone || event.full_name || "unknown",
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

function buildChannelStats(data: AgentInboxData): Record<Exclude<ChannelId, "properties" | "imports">, ChannelStats> {
  const views: Exclude<ChannelId, "properties" | "imports">[] = ["all", "email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
  const result = {} as Record<Exclude<ChannelId, "properties" | "imports">, ChannelStats>;
  for (const view of views) {
    const events = view === "all" ? data.events : data.events.filter((e) => realChannelToView(e.channel || "") === view);
    const threadKeys = new Set(events.map((e) => conversationKey(e, view === "all" ? "" : realChannelToViewRaw(view))));
    const inbound = events.filter((e) => e.direction === "inbound").length;
    const aiReplies = events.filter((e) => e.direction !== "inbound").length;
    const latest = events[events.length - 1];
    const flagged = events.some(eventNeedsHuman);
    result[view] = {
      events: events.length,
      threads: threadKeys.size,
      inbound,
      aiReplies,
      lastActivity: latest
        ? {
            contact: latest.email || latest.phone || latest.full_name || "unknown",
            message: eventText(latest) || latest.summary || "",
            status: latest.direction === "inbound" ? "received" : "sent",
            when: formatEventTimeShort(latest.event_at),
          }
        : null,
      humanReview: flagged ? "flagged" : "clear",
    };
  }
  return result;
}

function realChannelToViewRaw(view: string): string {
  // inverse for conversationKey channel arg
  if (view === "website") return "website_chat";
  return view;
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
  const { sparkline, peakDay, peakCount } = buildSparkline(bins);
  const responsesByDay = responseSamplesByDay(data.events);
  const todayResponses = responsesByDay.get(dayKey(new Date())) || [];
  const avgResponseSeconds = average(todayResponses);

  const needReview = data.metrics.needs_human;
  const handled = data.metrics.inbound_messages + data.metrics.outbound_replies;
  const aiRate = handled ? Math.round((data.metrics.outbound_replies / handled) * 100) : 0;

  return {
    channels: buildChannels(data),
    channelMeta,
    channelAccounts,
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
    channelStats: buildChannelStats(data),
    emailThreads: buildEmailThreads(data),
    smsThreads: buildSmsThreads(data),
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
    },
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
    },
    drafts: data.drafts as Record<string, unknown>,
    inboxSettings: data.inboxSettings,
  };
}

// Re-export for the ReviewPanel action wiring.
export type { AiDraft };
