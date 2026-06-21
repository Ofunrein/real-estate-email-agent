import { normalizeLegacyAgentText } from "@/lib/agentIdentity";
import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

// Shared inbox thread/conversation helpers. Extracted from the legacy
// AgentInboxClient.tsx so the new MUI adapter (lib/inboxDataAdapter.ts) and
// any other consumer can reuse them without the old UI component.

export function eventChannel(event: SheetRow): string {
  return (event.channel || "unknown").toLowerCase();
}

export function latestEvent(events: SheetRow[]): SheetRow {
  return events[events.length - 1] || {};
}

export function eventTimeValue(event: SheetRow): number {
  const parsed = new Date(event.event_at || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function eventNeedsHuman(event: SheetRow): boolean {
  return (
    event.status === "needs_human" ||
    event.event_type === "sms_handoff_reply" ||
    event.ai_action === "handoff_reply_ready" ||
    Boolean(event.handoff_reason)
  );
}

export function threadNeedsHuman(events: SheetRow[]): boolean {
  return events.some(eventNeedsHuman);
}

export function parseDraftKey(key: string): { channel: Channel; threadRef: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const channel = key.slice(0, separator) as Channel;
  const threadRef = key.slice(separator + 1);
  if (!threadRef || !["email", "sms", "whatsapp", "messenger", "instagram", "website_chat"].includes(channel)) return null;
  return { channel, threadRef };
}

export function conversationKey(event: SheetRow, channel?: Channel | string): string {
  const normalizedChannel = channel || eventChannel(event);
  if (["sms", "whatsapp", "messenger", "instagram", "voice"].includes(normalizedChannel)) {
    return event.phone || event.thread_ref || event.email || "unknown";
  }
  if (normalizedChannel === "email") {
    return event.email || event.thread_ref || event.phone || "unknown";
  }
  return event.email || event.phone || event.thread_ref || event.full_name || "unknown";
}

function sortThreadEntries(entries: [string, SheetRow[]][]): [string, SheetRow[]][] {
  return [...entries].sort((a, b) => eventTimeValue(latestEvent(b[1])) - eventTimeValue(latestEvent(a[1])));
}

export function buildChannelThreads(events: SheetRow[], channel: Channel): [string, SheetRow[]][] {
  const groups = events
    .filter((event) => eventChannel(event) === channel)
    .reduce<Record<string, SheetRow[]>>((acc, event) => {
      const key = conversationKey(event, channel);
      acc[key] ||= [];
      acc[key].push(event);
      return acc;
    }, {});
  const sortedGroups = Object.entries(groups).map(([key, threadEvents]) => [
    key,
    [...threadEvents].sort((a, b) => eventTimeValue(a) - eventTimeValue(b)),
  ] as [string, SheetRow[]]);
  return sortThreadEntries(sortedGroups);
}

export function threadIdentity(threadRef: string, events: SheetRow[], channel?: Channel | string): string {
  const latest = latestEvent(events);
  if (channel === "email") return latest.email || threadRef;
  if (["sms", "whatsapp", "messenger", "instagram", "voice"].includes(channel || "")) {
    return latest.phone || latest.full_name || threadRef;
  }
  return latest.email || latest.phone || latest.full_name || threadRef;
}

export function voiceCallKey(call: SheetRow): string {
  return call.phone || call.thread_ref || call.call_id || "voice:unknown";
}

function latestVoiceCall(calls: SheetRow[]): SheetRow {
  return calls.reduce<SheetRow>((latest, call) => {
    return voiceCallTimeValue(call) >= voiceCallTimeValue(latest) ? call : latest;
  }, calls[0] || {});
}

export function voiceCallTimeValue(call: SheetRow): number {
  const parsed = new Date(call.ended_at || call.started_at || call.event_at || call.created_at || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function buildVoiceCallThreads(calls: SheetRow[]): [string, SheetRow[]][] {
  const groups = calls.reduce<Record<string, SheetRow[]>>((acc, call) => {
    const key = voiceCallKey(call);
    acc[key] ||= [];
    acc[key].push(call);
    return acc;
  }, {});
  const sortedGroups = Object.entries(groups).map(([key, threadCalls]) => [
    key,
    [...threadCalls].sort((a, b) => voiceCallTimeValue(b) - voiceCallTimeValue(a)),
  ] as [string, SheetRow[]]);
  return sortedGroups.sort((a, b) => {
    return voiceCallTimeValue(latestVoiceCall(b[1])) - voiceCallTimeValue(latestVoiceCall(a[1]));
  });
}

export function voiceThreadIdentity(threadRef: string, calls: SheetRow[]): string {
  const latest = latestVoiceCall(calls);
  return latest.full_name || "Unknown caller";
}

// Strip AI extraction metadata lines from inbound email bodies.
function stripEmailMetadata(text: string): string {
  const lines = text.split("\n").filter((line) => {
    const t = line.trim().toLowerCase();
    if (!t) return false;
    if (/^intent:\s/.test(t)) return false;
    if (/^role:\s/.test(t)) return false;
    if (/\btimeline=|budget=|beds=|area=|preferred_channel=|current_property_status=/.test(t)) return false;
    if (/^tags:\s/.test(t)) return false;
    return true;
  });
  return lines.join("\n").trim();
}

export function eventText(event: SheetRow): string {
  const isInboundEmail = event.direction === "inbound" && (event.channel || "").toLowerCase() === "email";
  const isVoice = (event.channel || "").toLowerCase() === "voice";
  const text = isInboundEmail
    ? (event.message_text || "")
    : (event.message_text || event.summary || event.ai_action || "");
  const raw = event.direction === "inbound" ? text : normalizeLegacyAgentText(text);
  if (isInboundEmail) return stripEmailMetadata(raw);
  if (isVoice && /\b(you are\s+(?:iris|arya|a real estate)|brand voice|system prompt|developer instruction|never reveal|do not reveal|call script)\b/i.test(raw)) {
    return event.summary && !/\b(you are\s+(?:iris|arya|a real estate)|brand voice|system prompt|developer instruction)\b/i.test(event.summary)
      ? event.summary
      : "Voice call recorded.";
  }
  return raw;
}

export function eventSummaryText(event: SheetRow, fallback = ""): string {
  return normalizeLegacyAgentText(event.summary || fallback || eventText(event));
}

export function formatEventTime(value?: string): string {
  if (!value) return "No timestamp";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Map a raw real-app channel value to the source frontend's ChannelId taxonomy.
// rcs -> sms; web/website/website_chat -> website; otherwise passthrough.
export function adaptChannelId(rawChannel: string): string {
  const c = (rawChannel || "").toLowerCase();
  if (c === "rcs") return "sms";
  if (c === "web" || c === "website" || c === "website_chat") return "website";
  return c;
}

// Real draft channel (email|sms|whatsapp) -> source ChannelId.
export function draftChannelToViewId(channel: Channel): string {
  return channel;
}
