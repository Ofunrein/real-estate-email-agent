import type { SheetRow } from "@/lib/sheetSchema";
import { IRIS_AGENT_NAME, normalizeLegacyAgentName, normalizeLegacyAgentText } from "@/lib/agentIdentity";
import {
  DEFAULT_INBOX_CATEGORIES,
  DEFAULT_INBOX_SETTINGS,
  inferCategorySlug,
  type AiDraft,
  type EmailCapability,
  type InboxCategory,
  type InboxSettings,
} from "@/lib/inboxSettings";

export type Channel = "email" | "sms" | "whatsapp" | "messenger" | "instagram" | "voice" | "website_chat" | "unknown";

export type AgentInboxData = {
  leads: SheetRow[];
  events: SheetRow[];
  voiceCalls: SheetRow[];
  properties: SheetRow[];
  metrics: ReturnType<typeof buildMetrics>;
  threads: Record<string, SheetRow[]>;
  threadCategories: Record<string, string>;
  inboxCategories: InboxCategory[];
  inboxSettings: InboxSettings;
  drafts: Record<string, AiDraft>;
  emailCapabilities: EmailCapability[];
  propertyHealth: ReturnType<typeof buildPropertyHealth>;
};

export function channelFor(event: SheetRow): Channel {
  const channel = (event.channel || "unknown").toLowerCase();
  if (["email", "sms", "whatsapp", "messenger", "instagram", "voice", "website_chat"].includes(channel)) {
    return channel as Channel;
  }
  return "unknown";
}

export function groupEventsByThread(events: SheetRow[]): Record<string, SheetRow[]> {
  return events.reduce<Record<string, SheetRow[]>>((groups, event) => {
    const key = event.thread_ref || event.email || event.phone || "unknown";
    groups[key] ||= [];
    groups[key].push(event);
    return groups;
  }, {});
}

export function buildMetrics(leads: SheetRow[], events: SheetRow[]) {
  const channels = events.reduce<Record<string, number>>((counts, event) => {
    const channel = channelFor(event);
    counts[channel] = (counts[channel] || 0) + 1;
    return counts;
  }, {});
  const needsHumanLeads = leads.filter((lead) => lead.handoff_status === "needs_human").length;
  const needsHumanEvents = events.filter((event) => event.status === "needs_human").length;
  const outboundReplies = events.filter((event) => event.direction === "outbound").length;
  const inboundMessages = events.filter((event) => event.direction === "inbound").length;
  return {
    lead_count: leads.length,
    event_count: events.length,
    property_count: 0,
    needs_human: needsHumanLeads + needsHumanEvents,
    inbound_messages: inboundMessages,
    outbound_replies: outboundReplies,
    channels,
  };
}

export function buildPropertyHealth(properties: SheetRow[]) {
  const missingCore = properties.filter(
    (property) => !property.sqft || !property.year_built || !property.zip || !property.photo_url,
  );
  const duplicateCounts = properties.reduce<Record<string, number>>((counts, property) => {
    const key = (property.address || "").split(",", 1)[0].trim().toLowerCase();
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, {});
  const duplicateGroups = Object.values(duplicateCounts).filter((count) => count > 1).length;
  return {
    total: properties.length,
    missing_core: missingCore.length,
    duplicate_groups: duplicateGroups,
  };
}

function isReservedTestPhone(value?: string) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.startsWith("1555123") || digits === "15555550123";
}

function isReservedTestRow(row: SheetRow) {
  return isReservedTestPhone(row.phone) || isReservedTestPhone(row.thread_ref);
}

function isInternalVoiceEvent(row: SheetRow) {
  return channelFor(row) === "voice";
}

function normalizeInboxRow(row: SheetRow): SheetRow {
  return {
    ...row,
    agent_name: normalizeLegacyAgentName(row.agent_name) || row.agent_name,
    ai_action: normalizeLegacyAgentText(row.ai_action),
    handoff_reason: normalizeLegacyAgentText(row.handoff_reason),
    message_text: row.direction === "inbound" ? row.message_text : normalizeLegacyAgentText(row.message_text),
    summary: normalizeLegacyAgentText(row.summary),
    transcript: normalizeLegacyAgentText(row.transcript),
  };
}

export type VoiceTranscriptTurn = {
  speaker: string;
  direction: "inbound" | "outbound";
  text: string;
};

const VOICE_SPEAKER_LINE = /^(AI|Assistant|Aria|Bot|User|Caller|Lead|Customer):\s*(.*)$/i;
const VOICE_SPEAKER_LABEL = /^(AI|Assistant|Aria|Bot|User|Caller|Lead|Customer)$/i;

function voiceSpeakerFromLabel(label: string): Pick<VoiceTranscriptTurn, "speaker" | "direction"> {
  const normalized = label.toLowerCase();
  const outbound = ["ai", "assistant", "aria", "bot"].includes(normalized);
  return {
    speaker: outbound ? IRIS_AGENT_NAME : "Lead",
    direction: outbound ? "outbound" : "inbound",
  };
}

function parseVoiceMessagesJson(raw: string): VoiceTranscriptTurn[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const turns: VoiceTranscriptTurn[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const role = String(item.role || item.speaker || "").toLowerCase();
      const text = String(item.message ?? item.content ?? item.text ?? "").trim();
      if (!text) continue;
      const label = ["assistant", "bot", "ai"].includes(role) ? "AI" : role === "user" ? "User" : role;
      turns.push({ ...voiceSpeakerFromLabel(label), text });
    }
    return turns.length ? turns : null;
  } catch {
    return null;
  }
}

export function voiceCallTranscriptSource(call: SheetRow): string {
  const raw = (call.transcript || call.message_text || "").trim();
  if (!raw || raw === "[object Object]") return "";
  return raw;
}

export function parseVoiceTranscript(transcript = ""): VoiceTranscriptTurn[] {
  const trimmed = transcript.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const jsonTurns = parseVoiceMessagesJson(trimmed);
    if (jsonTurns?.length) return jsonTurns;
  }

  const turns: VoiceTranscriptTurn[] = [];
  for (const rawLine of trimmed.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const colonMatch = VOICE_SPEAKER_LINE.exec(line);
    if (colonMatch) {
      turns.push({ ...voiceSpeakerFromLabel(colonMatch[1]), text: colonMatch[2].trim() });
      continue;
    }

    const labelMatch = VOICE_SPEAKER_LABEL.exec(line);
    if (labelMatch) {
      turns.push({ ...voiceSpeakerFromLabel(labelMatch[1]), text: "" });
      continue;
    }

    const last = turns[turns.length - 1];
    if (last) {
      last.text = `${last.text} ${line}`.trim();
    } else {
      turns.push({ speaker: "Call", direction: "inbound", text: line });
    }
  }
  return turns;
}

export function composeInboxData(
  leads: SheetRow[],
  events: SheetRow[],
  properties: SheetRow[],
  voiceCalls: SheetRow[] = [],
  extras: Partial<Pick<AgentInboxData, "inboxCategories" | "inboxSettings" | "drafts" | "emailCapabilities">> = {},
): AgentInboxData {
  const visibleLeads = leads.filter((lead) => !isReservedTestRow(lead)).map(normalizeInboxRow);
  const visibleEvents = events.filter((event) => !isReservedTestRow(event) && !isInternalVoiceEvent(event)).map(normalizeInboxRow);
  const visibleVoiceCalls = voiceCalls.filter((call) => !isReservedTestRow(call)).map(normalizeInboxRow);
  const metrics = buildMetrics(visibleLeads, visibleEvents);
  const threads = groupEventsByThread(visibleEvents);
  const categories = extras.inboxCategories?.length ? extras.inboxCategories : DEFAULT_INBOX_CATEGORIES;
  if (visibleVoiceCalls.length) {
    metrics.channels.voice = visibleVoiceCalls.length;
  }
  metrics.property_count = properties.length;
  return {
    leads: visibleLeads,
    events: visibleEvents,
    voiceCalls: visibleVoiceCalls,
    properties,
    metrics,
    threads,
    threadCategories: Object.fromEntries(
      Object.entries(threads).map(([threadRef, threadEvents]) => [threadRef, inferCategorySlug(threadEvents, categories)]),
    ),
    inboxCategories: categories,
    inboxSettings: extras.inboxSettings || DEFAULT_INBOX_SETTINGS,
    drafts: extras.drafts || {},
    emailCapabilities: extras.emailCapabilities || [],
    propertyHealth: buildPropertyHealth(properties),
  };
}
