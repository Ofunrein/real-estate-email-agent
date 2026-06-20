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
  voiceCallTimeValue,
  voiceThreadIdentity,
} from "@/lib/inboxThreadUtils";
import type { SheetRow } from "@/lib/sheetSchema";
import { formatPrice } from "@/lib/format";
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

function realChannelToView(rawChannel: string): Exclude<ChannelId, "all" | "properties"> {
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

function buildEmailMessages(events: SheetRow[], categories: InboxCategory[]): EmailMessage[] {
  return events.map((event, i) => {
    const isInbound = event.direction === "inbound";
    const isOwner = isInbound && (event.source || "").toLowerCase().includes("owner");
    const direction: EmailMessage["direction"] = !isInbound ? "iris" : isOwner ? "owner" : "inbound";
    const body = eventText(event);
    const subject = isInbound ? (event.summary || "").split("\n")[0] : undefined;
    return {
      id: `${event.thread_ref || event.email || i}-${i}`,
      sender: direction === "iris" ? "Iris" : direction === "owner" ? "Owner" : (event.full_name || event.email || "Contact"),
      direction,
      time: formatEventTimeShort(event.event_at),
      subject: subject && subject.trim() ? subject.trim().slice(0, 160) : undefined,
      body: body || undefined,
      showSchedule: !isInbound && i === events.length - 1,
      flag: event.handoff_reason || undefined,
    };
  });
}

function buildEmailThreads(data: AgentInboxData): EmailThread[] {
  const entries = buildChannelThreads(data.events, "email");
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
      preview: eventText(latest) || (latest.summary || "").slice(0, 80),
      messageCount: events.length,
      needsReview,
      reviewReason: reason,
      category,
      messages: buildEmailMessages(events, data.inboxCategories),
    };
  });
}

function buildSmsThreads(data: AgentInboxData): SmsThread[] {
  const entries = buildChannelThreads(data.events, "sms");
  return entries.map(([key, events]) => {
    const latest = latestEvent(events);
    const category = leadCategoryFor(data.threadCategories[key] || data.threadCategories[latest.thread_ref || ""], data.inboxCategories);
    const messages: SmsMessage[] = events.map((event, i) => ({
      id: `${key}-${i}`,
      direction: event.direction === "inbound" ? "inbound" : "iris",
      time: formatEventTimeShort(event.event_at),
      body: eventText(event) || event.summary || "",
    }));
    return {
      id: key,
      contact: latest.phone || latest.full_name || key,
      time: formatEventTimeShort(latest.event_at),
      preview: eventText(latest) || (latest.summary || "").slice(0, 80),
      messageCount: events.length,
      category,
      messages,
    };
  });
}

function buildVoiceContacts(data: AgentInboxData): VoiceContact[] {
  const entries = buildVoiceCallThreads(data.voiceCalls);
  return entries.map(([key, calls]) => {
    const latest = calls[calls.length - 1] || {};
    const contact = voiceThreadIdentity(key, calls);
    const allTurns: CallTurn[] = [];
    const callsOut: Call[] = calls.map((call, i) => {
      const transcript = voiceCallTranscriptSource(call);
      const parsed = parseVoiceTranscript(transcript);
      const turns: CallTurn[] = (parsed || []).map((t) => ({
        speaker: t.direction === "outbound" ? "Iris" : "Lead",
        text: t.text,
      }));
      allTurns.push(...turns);
      return {
        id: call.call_id || `${key}-${i}`,
        time: formatEventTimeShort(call.ended_at || call.started_at || call.event_at),
        duration: formatCallDuration(callDurationSeconds(call)),
        outcome: callOutcome(call),
        turns,
        report: call.summary || "",
        recordingUrl: call.recording_url || undefined,
      };
    });
    return {
      id: key,
      contact,
      time: formatEventTimeShort(latest.ended_at || latest.started_at || latest.event_at),
      summary: latest.summary || (allTurns[0]?.text ?? ""),
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
  counts.all = data.events.length;
  const order: ChannelId[] = ["all", "email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
  return order
    .filter((id) => id === "all" || counts[id])
    .map((id) => ({
      id,
      label: id === "all" ? "All channels" : channelMeta[id as Exclude<ChannelId, "all" | "properties">].label,
      icon: id === "all" ? channelMeta.website.icon : channelMeta[id as Exclude<ChannelId, "all" | "properties">].icon,
      count: counts[id] || 0,
      accent: id === "all" ? "#818cf8" : channelMeta[id as Exclude<ChannelId, "all" | "properties">].accent,
    }));
}

function buildActivityEvents(data: AgentInboxData): ActivityEvent[] {
  return [...data.events]
    .sort((a, b) => eventTimeValue(b) - eventTimeValue(a))
    .slice(0, 12)
    .map((event, i) => {
      const view = realChannelToView(event.channel || "");
      const isAi = event.direction !== "inbound";
      const kind: ActivityEvent["kind"] = view === "voice" ? "voice" : isAi ? "ai_reply" : "inbound";
      return {
        id: event.thread_ref || `${i}`,
        channel: view,
        kind,
        actor: event.email || event.phone || event.full_name || "unknown",
        intent: event.event_type || undefined,
        body: eventText(event) || event.summary || "",
        time: formatEventTimeShort(event.event_at),
        isHuman: !isAi,
      };
    });
}

function buildChannelStats(data: AgentInboxData): Record<Exclude<ChannelId, "properties">, ChannelStats> {
  const views: Exclude<ChannelId, "properties">[] = ["all", "email", "sms", "voice", "instagram", "messenger", "whatsapp", "website"];
  const result = {} as Record<Exclude<ChannelId, "properties">, ChannelStats>;
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

  const needReview = data.metrics.needs_human;
  const handled = data.metrics.inbound_messages + data.metrics.outbound_replies;
  const aiRate = handled ? Math.round((data.metrics.outbound_replies / handled) * 100) : 0;

  return {
    channels: buildChannels(data),
    channelMeta,
    channelAccounts,
    leadCategories: data.inboxCategories.length
      ? data.inboxCategories.map((c) => ({ id: categorySlugToId(c.slug), label: c.name, color: c.color || "#8b5cf6" }))
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
    },
    drafts: data.drafts as Record<string, unknown>,
  };
}

// Re-export for the ReviewPanel action wiring.
export type { AiDraft };
