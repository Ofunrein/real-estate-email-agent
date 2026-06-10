// Channel-aware agent notifications. When an agent needs to alert the human
// (not the lead) — a live transfer, a hot lead, a booked showing — notify.ts
// picks ONE channel by urgency, dedupes, and respects the agent's quiet hours.
// Same philosophy as the lead cadence: right message, right channel, not noisy.
//
// Decision logic is pure (clock/quiet-hours/dedup keys passed in); delivery is
// injected so it is unit-testable.

import type { NotifyConfig } from "@/lib/clientConfig";
import { sendTheoHandoffAlert, type TwilioSendResult } from "@/lib/twilioSms";

export type NotifyEvent = {
  type: string; // e.g. transfer_to_human, hot_lead, showing_booked, lead_qualified
  leadName?: string;
  leadPhone?: string;
  summary?: string;
  reason?: string;
  threadRef?: string;
};

export type NotifyTier = "interrupt" | "digest" | "none";
export type NotifyChannel = "sms" | "dashboard" | "none";

// Events that warrant an immediate SMS interrupt to the agent.
const INTERRUPT_TYPES = new Set([
  "transfer_to_human",
  "transfer_failed",
  "transfer_missed",
  "handoff",
  "needs_human",
  "hot_lead",
]);

// Logged to the dashboard digest, not an instant ping.
const DIGEST_TYPES = new Set([
  "showing_booked",
  "showing_cancelled",
  "showing_rescheduled",
  "lead_qualified",
  "seller_lead",
  "crm_synced",
]);

export function classifyUrgency(type: string): NotifyTier {
  const key = (type || "").toLowerCase();
  if (INTERRUPT_TYPES.has(key)) return "interrupt";
  if (DIGEST_TYPES.has(key)) return "digest";
  return "none";
}

// Quiet hours wrap midnight when start > end (e.g. 21 → 8).
export function inQuietHours(localHour: number, config: NotifyConfig): boolean {
  const { quietStartHour: start, quietEndHour: end } = config;
  if (start === end) return false;
  return start < end ? localHour >= start && localHour < end : localHour >= start || localHour < end;
}

export function dedupeKey(event: NotifyEvent, dayKey: string): string {
  return [dayKey, (event.type || "").toLowerCase(), event.leadPhone || event.threadRef || ""].join("|");
}

export type NotifyDecision = {
  deliver: boolean;
  tier: NotifyTier;
  channel: NotifyChannel;
  dedupeKey: string;
  reason: string;
};

// Decide whether/how to notify. An interrupt during quiet hours is downgraded
// to the dashboard digest instead of waking the agent.
export function decideNotification(
  event: NotifyEvent,
  config: NotifyConfig,
  ctx: { localHour: number; dayKey: string; recentKeys?: Set<string> },
): NotifyDecision {
  const tier = classifyUrgency(event.type);
  const key = dedupeKey(event, ctx.dayKey);

  if (tier === "none") {
    return { deliver: false, tier, channel: "none", dedupeKey: key, reason: "not_notifiable" };
  }
  if (ctx.recentKeys?.has(key)) {
    return { deliver: false, tier, channel: "none", dedupeKey: key, reason: "deduped" };
  }
  if (tier === "interrupt") {
    if (inQuietHours(ctx.localHour, config)) {
      return { deliver: true, tier, channel: "dashboard", dedupeKey: key, reason: "interrupt_quiet_hours_to_digest" };
    }
    if (config.preferredChannel === "sms") {
      return { deliver: true, tier, channel: "sms", dedupeKey: key, reason: "interrupt" };
    }
    return { deliver: true, tier, channel: "dashboard", dedupeKey: key, reason: "interrupt_non_sms_pref" };
  }
  // digest
  return { deliver: true, tier, channel: "dashboard", dedupeKey: key, reason: "digest" };
}

export type NotifyDeps = {
  sendInterrupt: (event: NotifyEvent) => Promise<TwilioSendResult>;
  recordDigest: (event: NotifyEvent, decision: NotifyDecision) => Promise<void>;
};

const defaultDeps: NotifyDeps = {
  sendInterrupt: (event) =>
    sendTheoHandoffAlert({
      leadPhone: event.leadPhone || "",
      leadName: event.leadName,
      reason: event.reason || event.type,
      summary: event.summary || "",
      threadRef: event.threadRef || "",
    }),
  recordDigest: async () => undefined,
};

export async function notifyAgent(
  event: NotifyEvent,
  config: NotifyConfig,
  ctx: { localHour: number; dayKey: string; recentKeys?: Set<string> },
  deps: NotifyDeps = defaultDeps,
): Promise<NotifyDecision> {
  const decision = decideNotification(event, config, ctx);
  if (!decision.deliver) return decision;
  if (decision.channel === "sms") {
    await deps.sendInterrupt(event).catch(() => undefined);
  } else if (decision.channel === "dashboard") {
    await deps.recordDigest(event, decision).catch(() => undefined);
  }
  return decision;
}
