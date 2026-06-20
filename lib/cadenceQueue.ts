import { nextTouch, type TouchDecision } from "@/lib/cadence";
import type { CadenceConfig } from "@/lib/clientConfig";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";
import type { SheetRow } from "@/lib/sheetSchema";
import { isUnsafeSmsRecipient } from "@/lib/twilioSms";

export type CadenceQueueChannel =
  | "sms"
  | "email"
  | "voice"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "manual_human";

export type LeadWithEvents = {
  lead: Partial<SheetRow>;
  events: SheetRow[];
};

export type CadenceQueueTask = {
  id: string;
  leadIdentity: string;
  channel: CadenceQueueChannel;
  reason: string;
  dueAt: string;
  touchCount: number;
  lead: Pick<SheetRow, "email" | "phone" | "full_name">;
};

export type CadenceQueueSkip = {
  leadIdentity: string;
  channel?: CadenceQueueChannel;
  reason: string;
  touchCount: number;
  nextEligibleAt?: string;
};

export type CadenceQueuePlan = {
  generatedAt: string;
  tasks: CadenceQueueTask[];
  skipped: CadenceQueueSkip[];
};

const AUTOMATED_CHANNELS: CadenceQueueChannel[] = ["sms", "email", "voice", "whatsapp", "messenger", "instagram"];

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function leadIdentity(lead: Partial<SheetRow>): string {
  const phone = normalizePhone(lead.phone);
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(lead.email);
  if (email) return `email:${email}`;
  const name = normalizeName(lead.full_name);
  if (name) return `name:${name}`;
  return "";
}

function eventTime(event: SheetRow): number {
  return Date.parse(event.event_at || event.created_at || "");
}

function localDay(ms: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function localHour(ms: number, timezone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date(ms)));
  } catch {
    return new Date(ms).getUTCHours();
  }
}

function nextWindowStart(nowMs: number, timezone: string, startHour: number): string {
  let candidate = new Date(nowMs);
  candidate.setUTCMinutes(0, 0, 0);
  if (candidate.getTime() <= nowMs) candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
  for (let i = 0; i < 48; i += 1) {
    if (localHour(candidate.getTime(), timezone) === startHour) return candidate.toISOString();
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
  }
  return new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
}

function insideContactWindow(nowMs: number, timezone: string, config: CadenceConfig): boolean {
  const hour = localHour(nowMs, timezone);
  return hour >= config.callWindowStartHour && hour < config.callWindowEndHour;
}

function cleanChannel(value?: string): CadenceQueueChannel | "" {
  const normalized = (value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "text" || normalized === "sms") return "sms";
  if (normalized === "call" || normalized === "phone" || normalized === "voice") return "voice";
  if (normalized === "email") return "email";
  if (normalized === "wa" || normalized === "whatsapp") return "whatsapp";
  if (normalized === "fb" || normalized === "facebook" || normalized === "messenger") return "messenger";
  if (normalized === "ig" || normalized === "instagram" || normalized === "instagram_dm") return "instagram";
  if (normalized === "manual" || normalized === "human" || normalized === "manual_human") return "manual_human";
  return "";
}

function latestInboundChannel(events: SheetRow[]): CadenceQueueChannel | "" {
  return events
    .filter((event) => (event.direction || "").toLowerCase() === "inbound")
    .sort((a, b) => eventTime(b) - eventTime(a))
    .map((event) => cleanChannel(event.channel))
    .find((channel): channel is CadenceQueueChannel => Boolean(channel) && channel !== "manual_human") || "";
}

function needsHuman(lead: Partial<SheetRow>, events: SheetRow[]): boolean {
  const text = [
    lead.handoff_status,
    lead.next_action,
    lead.handoff_reason,
    events.find((event) => (event.status || "").toLowerCase() === "needs_human")?.status,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(needs_human|human|handoff|manual|escalat)/.test(text);
}

function consentOk(channel: CadenceQueueChannel, lead: Partial<SheetRow>): boolean {
  if (channel === "manual_human") return true;
  if (channel === "voice") return (lead.call_consent || "").toLowerCase() === "yes";
  if (channel === "sms") return (lead.sms_consent || "").toLowerCase() !== "no";
  if (channel === "whatsapp") return (lead.whatsapp_consent || lead.sms_consent || "").toLowerCase() !== "no";
  return true;
}

function addressable(channel: CadenceQueueChannel, lead: Partial<SheetRow>, events: SheetRow[]): boolean {
  if (channel === "manual_human") return true;
  if (channel === "email") return Boolean(normalizeEmail(lead.email));
  if (channel === "sms" || channel === "voice" || channel === "whatsapp") {
    const phone = normalizePhone(lead.phone);
    return Boolean(phone) && !isUnsafeSmsRecipient(phone);
  }
  return events.some((event) => cleanChannel(event.channel) === channel && Boolean(event.thread_ref || event.source));
}

function preferredAutomatedChannel(lead: Partial<SheetRow>, events: SheetRow[], decision: TouchDecision): CadenceQueueChannel | "" {
  const preferred = cleanChannel(lead.preferred_channel);
  if (preferred === "voice") return decision.channel === "voice" ? "voice" : decision.channel || "";
  if (preferred && preferred !== "manual_human") return preferred;
  const inbound = latestInboundChannel(events);
  if (inbound) return inbound;
  return decision.channel || "";
}

function taskId(identity: string, channel: CadenceQueueChannel, dueAt: string, timezone: string): string {
  return `iris-cadence:${hashKey(identity)}:${channel}:${localDay(Date.parse(dueAt), timezone)}`;
}

function leadSnapshot(lead: Partial<SheetRow>): CadenceQueueTask["lead"] {
  return {
    email: lead.email || "",
    phone: lead.phone || "",
    full_name: lead.full_name || "",
  };
}

export function planCadenceQueue(input: {
  leads: LeadWithEvents[];
  config: CadenceConfig;
  nowMs: number;
  timezone?: string;
}): CadenceQueuePlan {
  const timezone = input.timezone || "America/Chicago";
  const generatedAt = new Date(input.nowMs).toISOString();
  const tasks: CadenceQueueTask[] = [];
  const skipped: CadenceQueueSkip[] = [];

  for (const { lead, events } of input.leads) {
    const identity = leadIdentity(lead);
    if (!identity) {
      skipped.push({ leadIdentity: "", reason: "missing_lead_identity", touchCount: 0 });
      continue;
    }

    const decision = nextTouch({ lead, events, config: input.config, nowMs: input.nowMs, timezone });

    if (needsHuman(lead, events)) {
      const dueAt = generatedAt;
      tasks.push({
        id: taskId(identity, "manual_human", dueAt, timezone),
        leadIdentity: identity,
        channel: "manual_human",
        reason: "manual_followup_required",
        dueAt,
        touchCount: decision.touchCount,
        lead: leadSnapshot(lead),
      });
      continue;
    }

    if (decision.action !== "send") {
      skipped.push({
        leadIdentity: identity,
        reason: decision.reason,
        touchCount: decision.touchCount,
        nextEligibleAt: decision.nextEligibleAt,
      });
      continue;
    }

    const channel = preferredAutomatedChannel(lead, events, decision);
    if (!channel || !AUTOMATED_CHANNELS.includes(channel)) {
      skipped.push({ leadIdentity: identity, reason: "no_eligible_channel_now", touchCount: decision.touchCount });
      continue;
    }

    if (!insideContactWindow(input.nowMs, timezone, input.config)) {
      skipped.push({
        leadIdentity: identity,
        channel,
        reason: "contact_window_closed",
        touchCount: decision.touchCount,
        nextEligibleAt: nextWindowStart(input.nowMs, timezone, input.config.callWindowStartHour),
      });
      continue;
    }

    if (!consentOk(channel, lead)) {
      skipped.push({ leadIdentity: identity, channel, reason: "channel_consent_blocked", touchCount: decision.touchCount });
      continue;
    }

    if (!addressable(channel, lead, events)) {
      skipped.push({ leadIdentity: identity, channel, reason: "missing_or_unsafe_channel_address", touchCount: decision.touchCount });
      continue;
    }

    const dueAt = generatedAt;
    tasks.push({
      id: taskId(identity, channel, dueAt, timezone),
      leadIdentity: identity,
      channel,
      reason: decision.reason,
      dueAt,
      touchCount: decision.touchCount,
      lead: leadSnapshot(lead),
    });
  }

  return { generatedAt, tasks, skipped };
}
