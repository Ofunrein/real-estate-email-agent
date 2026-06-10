// Shared cross-channel cadence. Every agent (voice/SMS/email) writes to
// conversation_events; nextTouch() reads that one timeline for a lead and
// decides whether to reach out again, on which channel, and when — so the
// agents don't independently pile on. 2026-style pacing: many touchpoints, but
// spread out, channel-rotated, consent- and quiet-hour-aware, and it backs off
// the moment the lead engages.
//
// Pure function (clock + timezone passed in) → fully unit-testable.

import type { CadenceConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";

export type TouchChannel = "voice" | "sms" | "email";

export type TouchDecision = {
  action: "send" | "wait" | "hold" | "stop";
  channel?: TouchChannel;
  reason: string;
  touchCount: number;
  nextEligibleAt?: string; // ISO, when action === "wait"
};

const DAY_MS = 24 * 60 * 60 * 1000;

function eventTime(event: SheetRow): number {
  return Date.parse(event.event_at || event.created_at || "");
}

function outboundTouches(events: SheetRow[]): SheetRow[] {
  return events
    .filter((event) => (event.direction || "").toLowerCase() === "outbound" && Number.isFinite(eventTime(event)))
    .sort((a, b) => eventTime(a) - eventTime(b));
}

function lastInboundTime(events: SheetRow[]): number {
  let latest = -Infinity;
  for (const event of events) {
    if ((event.direction || "").toLowerCase() === "inbound") {
      const t = eventTime(event);
      if (Number.isFinite(t) && t > latest) latest = t;
    }
  }
  return latest;
}

function dayKey(ms: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
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

function consentOk(channel: TouchChannel, lead: Partial<SheetRow>): boolean {
  if (channel === "voice") return (lead.call_consent || "").toLowerCase() === "yes";
  if (channel === "sms") return (lead.sms_consent || "").toLowerCase() !== "no";
  return true; // email
}

function optedOut(lead: Partial<SheetRow>): boolean {
  return (lead.next_action || "").toLowerCase() === "do_not_contact"
    || (lead.handoff_status || "").toLowerCase() === "do_not_contact"
    || (lead.sms_consent || "").toLowerCase() === "no" && (lead.call_consent || "").toLowerCase() === "no";
}

// Order channels to try. Speed-to-lead (no prior touch) reaches out fast on the
// preferred/soft channel; otherwise rotate, and only use voice after a softer
// (email/sms) touch has already happened.
function channelOrder(
  config: CadenceConfig,
  lead: Partial<SheetRow>,
  touches: SheetRow[],
  preferred: TouchChannel,
): TouchChannel[] {
  const usedChannels = new Set(touches.map((t) => (t.channel || "").toLowerCase()));
  const hasSoftTouch = usedChannels.has("email") || usedChannels.has("sms");
  const base: TouchChannel[] = touches.length === 0
    ? [preferred === "voice" ? "sms" : preferred, "sms", "email", "voice"]
    : ["sms", "email", "voice"];
  const ordered = [...new Set(base)];
  return ordered.filter((channel) => (channel === "voice" ? hasSoftTouch || touches.length === 0 : true));
}

export function nextTouch(input: {
  lead: Partial<SheetRow>;
  events: SheetRow[];
  config: CadenceConfig;
  nowMs: number;
  timezone?: string;
}): TouchDecision {
  const { lead, events, config } = input;
  const timezone = input.timezone || "America/Chicago";
  const touches = outboundTouches(events);
  const touchCount = touches.length;

  if (optedOut(lead)) {
    return { action: "stop", reason: "opted_out", touchCount };
  }

  // Lead engaged after our last outbound → hold automated cadence, let the live
  // conversation play out (stop-on-reply).
  if (config.stopOnReply) {
    const lastOut = touches.length ? eventTime(touches[touches.length - 1]) : -Infinity;
    if (lastInboundTime(events) > lastOut) {
      return { action: "hold", reason: "lead_engaged", touchCount };
    }
  }

  if (touchCount >= config.maxTouches) {
    return { action: "stop", reason: "max_touches_reached", touchCount };
  }

  // Minimum gap between any two touches.
  if (touchCount > 0) {
    const lastTouchMs = eventTime(touches[touches.length - 1]);
    const eligibleMs = lastTouchMs + config.minGapHours * 60 * 60 * 1000;
    if (input.nowMs < eligibleMs) {
      return { action: "wait", reason: "min_gap_not_elapsed", touchCount, nextEligibleAt: new Date(eligibleMs).toISOString() };
    }
  }

  // No two channels in the same day.
  if (config.oneChannelPerDay) {
    const today = dayKey(input.nowMs, timezone);
    const touchedToday = touches.some((t) => dayKey(eventTime(t), timezone) === today);
    if (touchedToday) {
      const tomorrow = new Date(input.nowMs + DAY_MS);
      return { action: "wait", reason: "already_touched_today", touchCount, nextEligibleAt: tomorrow.toISOString() };
    }
  }

  const preferred = ((lead.preferred_channel || "").toLowerCase() as TouchChannel) || "sms";
  const order = channelOrder(config, lead, touches, ["voice", "sms", "email"].includes(preferred) ? preferred : "sms");

  for (const channel of order) {
    if (!consentOk(channel, lead)) continue;
    if (channel === "voice") {
      const hour = localHour(input.nowMs, timezone);
      if (hour < config.callWindowStartHour || hour >= config.callWindowEndHour) {
        continue; // outside legal call window — try another channel
      }
    }
    return { action: "send", channel, reason: touchCount === 0 ? "speed_to_lead" : "scheduled_touch", touchCount };
  }

  return { action: "wait", reason: "no_eligible_channel_now", touchCount };
}
