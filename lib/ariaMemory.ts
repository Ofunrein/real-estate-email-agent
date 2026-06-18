import {
  findAppointmentsByPhone,
  formatAppointmentForAgent,
  type AppointmentRecord,
} from "@/lib/appointmentStore";
import type { SheetRow } from "@/lib/sheetSchema";

export type ChannelExcerpt = {
  channel: string;
  direction: string;
  event_type: string;
  summary: string;
  message_text: string;
  event_at: string;
};

export type CallerContext = {
  full_name: string;
  phone: string;
  email: string;
  lead_id: string;
  lead_role: string;
  budget: string;
  area: string;
  timeline: string;
  bedrooms: string;
  bathrooms: string;
  property_interest: string;
  preferred_channel: string;
  sell_before_buy: string;
  sms_consent: string;
  call_consent: string;
  channels_seen: string[];
  last_touch_channel: string;
  last_touch_at: string;
  touch_count: number;
  upcoming_appointments: AppointmentRecord[];
  past_appointment_count: number;
  context_summary: string;
  channel_excerpts: ChannelExcerpt[];
};

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

function extractEmail(text: string): string {
  return text.match(EMAIL_RE)?.[0] || "";
}

function extractBudget(text: string): string {
  const match = text.match(/(?:budget|up to|under|around|max(?:imum)?|looking to spend)\s*(?:is|of|about|roughly)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?/i);
  if (!match) return "";
  let amount = Number.parseFloat(match[1].replace(/,/g, ""));
  const suffix = (match[2] || "").toLowerCase();
  if (suffix.startsWith("k") || suffix === "thousand") amount *= 1000;
  if (suffix.startsWith("m") || suffix === "million") amount *= 1_000_000;
  return amount >= 50_000 ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "";
}

function extractTimeline(text: string): string {
  const match = text.match(/\b(\d+[\+\-]?\s*(?:month|week|day|year)s?|asap|immediately|soon|end of (?:year|month|quarter)|by (?:summer|fall|spring|winter)|this (?:year|month|quarter|spring|summer|fall|winter))\b/i);
  return match?.[0]?.trim() || "";
}

function extractRole(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(want|looking|trying|plan(?:ning)?)\s+(to\s+)?(buy|purchase|find a home)\b/.test(lower)) return "buyer";
  if (/\b(sell(?:ing)?|list(?:ing)?|put(?:ting)? (?:my|the) (?:house|home|property))\b/.test(lower)) return "seller";
  if (/\b(rent(?:ing)?|renter|looking to rent)\b/.test(lower)) return "renter";
  if (/\b(invest(?:or|ment|ing)?|flip(?:ping)?|rental property|cash flow)\b/.test(lower)) return "investor";
  return "";
}

function extractArea(text: string): string {
  const match = text.match(/\b(Austin|Round Rock|Cedar Park|Georgetown|Leander|Pflugerville|Buda|Kyle|Manor|Hutto|Liberty Hill|Bastrop|Bee Cave|Lakeway|Steiner Ranch|Mueller|East Austin|South Austin|North Austin|West Austin|78\d{3})\b/i);
  return match?.[1] || "";
}

function extractBedrooms(text: string): string {
  const match = text.match(/\b(\d)\s*(?:bed(?:room)?s?|br)\b/i);
  return match?.[1] || "";
}

function fill(current: string, candidate = ""): string {
  return current.trim() ? current : candidate.trim();
}

export async function compileCallerContext(
  lead: SheetRow | null,
  events: SheetRow[],
  channelsSeen: string[],
  lastTouchAt: string,
): Promise<CallerContext> {
  let full_name = lead?.full_name || "";
  let email = lead?.email || "";
  const phone = lead?.phone || "";
  let lead_role = lead?.lead_role || "";
  let budget = lead?.budget || "";
  let area = lead?.area || "";
  let timeline = lead?.timeline || "";
  let bedrooms = lead?.bedrooms || "";
  let bathrooms = lead?.bathrooms || "";
  let property_interest = lead?.property_interest || "";
  let preferred_channel = lead?.preferred_channel || "";
  let sell_before_buy = lead?.sell_before_buy || "";
  let sms_consent = lead?.sms_consent || "";
  const call_consent = lead?.call_consent || "";
  const last_channel = lead?.last_channel || "";
  const last_touch = lastTouchAt || lead?.last_ai_touch_at || "";
  const excerpts: ChannelExcerpt[] = [];
  const seenKeys = new Set<string>();

  for (const event of [...events].reverse()) {
    const text = [event.message_text || "", event.summary || ""].join(" ").trim();
    if (!text) continue;

    const channelKey = `${event.channel}:${event.event_type}`;
    if (!seenKeys.has(channelKey) && excerpts.length < 5) {
      seenKeys.add(channelKey);
      excerpts.push({
        channel: event.channel || "",
        direction: event.direction || "",
        event_type: event.event_type || "",
        summary: (event.summary || "").slice(0, 120),
        message_text: (event.message_text || "").slice(0, 80),
        event_at: event.event_at || "",
      });
    }

    full_name = fill(full_name, event.full_name);
    email = fill(email, extractEmail(text) || event.email || "");
    budget = fill(budget, extractBudget(text));
    area = fill(area, extractArea(text));
    timeline = fill(timeline, extractTimeline(text));
    lead_role = fill(lead_role, extractRole(text));
    bedrooms = fill(bedrooms, extractBedrooms(text));
    preferred_channel = fill(preferred_channel, event.channel || "");
    if (!property_interest && event.property_interest) property_interest = event.property_interest;
    if (sms_consent !== "yes" && /sms consent/i.test(event.summary || "")) sms_consent = "yes";
  }

  const allAppointments = phone ? await findAppointmentsByPhone(phone).catch(() => []) : [];
  const now = Date.now();
  const upcoming = allAppointments.filter((appt) => appt.status === "confirmed" && Date.parse(appt.scheduled_at) > now);
  const pastCount = allAppointments.filter((appt) => appt.status === "completed" || Date.parse(appt.scheduled_at) <= now).length;

  const lines: string[] = [];
  if (full_name) lines.push(`Name: ${full_name}`);
  if (email) lines.push(`Email: ${email}`);
  if (phone) lines.push(`Phone: ${phone}`);
  const intentParts = [
    lead_role && `${lead_role.charAt(0).toUpperCase()}${lead_role.slice(1)}`,
    budget && `budget ${budget}`,
    area && `interested in ${area}`,
    bedrooms && `${bedrooms} bed`,
    timeline && `timeline ${timeline}`,
    sell_before_buy === "yes" && "needs to sell first",
  ].filter(Boolean);
  if (intentParts.length) lines.push(`Intent: ${intentParts.join(", ")}`);
  if (property_interest) lines.push(`Property interest: ${property_interest}`);
  if (preferred_channel) lines.push(`Prefers: ${preferred_channel}`);
  if (channelsSeen.length) lines.push(`Prior channels: ${channelsSeen.join(", ")} (${events.length} interaction${events.length === 1 ? "" : "s"})`);
  if (last_channel && last_touch) lines.push(`Last touch: ${last_channel} on ${last_touch.slice(0, 10)}`);
  if (upcoming.length) {
    lines.push("Upcoming appointments:");
    for (const appt of upcoming.slice(0, 2)) lines.push(`  - ${formatAppointmentForAgent(appt)} [id:${appt.id.slice(0, 8)}]`);
  }
  if (excerpts.length) {
    lines.push("Recent activity:");
    for (const excerpt of excerpts.slice(0, 3)) {
      const when = excerpt.event_at?.slice(0, 10) || "";
      const what = excerpt.summary || excerpt.message_text || excerpt.event_type;
      if (what) lines.push(`  [${excerpt.channel}${when ? ` ${when}` : ""}] ${what}`);
    }
  }

  return {
    full_name,
    phone,
    email,
    lead_id: lead?.id || "",
    lead_role,
    budget,
    area,
    timeline,
    bedrooms,
    bathrooms,
    property_interest,
    preferred_channel,
    sell_before_buy,
    sms_consent,
    call_consent,
    channels_seen: channelsSeen,
    last_touch_channel: last_channel,
    last_touch_at: last_touch,
    touch_count: events.length,
    upcoming_appointments: upcoming,
    past_appointment_count: pastCount,
    context_summary: lines.join("\n"),
    channel_excerpts: excerpts,
  };
}

export function buildCallerContextResponse(ctx: CallerContext): string {
  if (!ctx.full_name && !ctx.email && ctx.touch_count === 0) {
    return "New caller - no prior record. Greet naturally and ask for their name early.";
  }

  const parts: string[] = [];
  parts.push(ctx.full_name ? `Caller name: ${ctx.full_name}. Returning ${ctx.lead_role || "contact"}.` : "Returning caller - name not yet confirmed.");
  const known = [
    ctx.budget && `budget (${ctx.budget})`,
    ctx.area && `area (${ctx.area})`,
    ctx.timeline && `timeline (${ctx.timeline})`,
    ctx.bedrooms && `${ctx.bedrooms} bed`,
    ctx.property_interest && `property (${ctx.property_interest})`,
  ].filter(Boolean);
  if (known.length) parts.push(`Already know: ${known.join(", ")}. Do not re-ask; reference naturally.`);
  if (ctx.preferred_channel) parts.push(`Prefers follow-up via ${ctx.preferred_channel}.`);
  if (ctx.upcoming_appointments.length) {
    const appt = ctx.upcoming_appointments[0];
    parts.push(`Has upcoming: ${formatAppointmentForAgent(appt)}. Use appointment_id=${appt.id} for reschedule/cancel tools.`);
  }
  if (ctx.channels_seen.length > 1) parts.push(`Prior channels: ${ctx.channels_seen.join(", ")}.`);
  if (ctx.context_summary) parts.push(`Full context:\n${ctx.context_summary}`);
  return parts.join(" ");
}
