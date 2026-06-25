// Aria's server-side tool dispatcher. Vapi runs the conversation; when the
// assistant invokes a server tool, the webhook route calls runAriaTool() and
// gets back a spoken `result` string (read to the caller) plus an `ingest`
// record the route persists via recordChannelInteraction (one conversation
// event per tool, and lead upsert for qualifyLead).
//
// transferToHuman and endCall are Vapi-native tools configured on the assistant
// (lib/ariaAssistant.ts) and never reach this dispatcher.
//
// Pure except for the two injected async deps, so it is unit-testable.

import { recordChannelInteraction, type ChannelIngestInput } from "@/lib/channelIngest";
import { resolveCaller as resolveCallerDefault, type CallerIdentity } from "@/lib/identity";
import {
  lookupPropertyForVoice,
  propertySmsBody,
  searchPropertiesForVoice,
  type VoiceLookupResult,
  type VoiceSearchResult,
} from "@/lib/ariaData";
import { usableInboxPhotoUrl } from "@/lib/mediaProxy";
import {
  cancelShowing,
  rescheduleShowing,
  scheduleShowing,
  type ShowingContact,
} from "@/lib/calendar";
import { resolveCrmAdapter } from "@/lib/crm";
import type { CrmAdapter } from "@/lib/crm/types";
import { clientConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";
import {
  bookAppointment as bookSharedAppointment,
  cancelGHLEvent,
  parseLocalDateTime,
  rescheduleGHLEvent,
  type AppointmentInput,
} from "@/lib/ariaCalendar";
import {
  cancelAppointmentById,
  findAppointmentById,
  findUpcomingAppointmentByPhone,
  rescheduleAppointmentById,
  type AppointmentRecord,
} from "@/lib/appointmentStore";
import { buildCallerContextResponse, compileCallerContext } from "@/lib/ariaMemory";
import { notifySlackOnBooking, notifySlackOnTransfer } from "@/lib/ariaSlack";
import { sendTheoSms, smsMessageWithMediaLog } from "@/lib/twilioSms";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { queryAvailability as queryCalendarAvailability, type AvailabilitySlot } from "@/lib/calendarOs";

export type AriaToolName =
  | "getCallerContext"
  | "lookupProperty"
  | "searchProperties"
  | "sendPropertyDetailsSms"
  | "checkAvailability"
  | "bookConsultation"
  | "scheduleShowing"
  | "bookAppointment"
  | "cancelAppointment"
  | "rescheduleAppointment"
  | "syncToCrm"
  | "qualifyLead";

export type AriaToolContext = {
  phone: string;
  callId: string;
  threadRef: string;
  lead?: Partial<SheetRow> | null;
};

export type AriaToolDeps = {
  resolveCaller: (phone: string) => Promise<CallerIdentity>;
  lookupProperty: (input: { address: string; phone?: string; message?: string; lead?: Partial<SheetRow> }) => Promise<VoiceLookupResult>;
  searchProperties: (input: { query?: string; area?: string; beds?: number; baths?: number; minPrice?: number; maxPrice?: number; phone?: string; lead?: Partial<SheetRow> }) => Promise<VoiceSearchResult>;
  getCrm: () => CrmAdapter | null;
  calendarId: string;
  timezone: string;
  queryAvailability: (input: { calendarId?: string; from: string; to: string; durationMinutes?: number; timezone?: string; limit?: number }) => Promise<AvailabilitySlot[]>;
  bookAppointment: (input: AppointmentInput) => Promise<{ success: boolean; appointment_id?: string; neon_id?: string; confirmed_time?: string; error?: string }>;
  findUpcomingAppointmentByPhone: (phone: string) => Promise<AppointmentRecord | null>;
  findAppointmentById: (id: string) => Promise<AppointmentRecord | null>;
  cancelAppointmentById: (id: string) => Promise<boolean>;
  rescheduleAppointmentById: (id: string, newScheduledAt: string, newScheduledAtLocal: string, newGhlEventId?: string) => Promise<AppointmentRecord | null>;
  cancelGHLEvent: (ghlEventId: string) => Promise<boolean>;
  rescheduleGHLEvent: (ghlEventId: string, newDate: string, newTime: string, timezone?: string) => Promise<{ success: boolean; confirmed_time?: string; error?: string }>;
  sendSms: (to: string, body: string, mediaUrls?: string[]) => Promise<unknown>;
  recordSms?: (input: ChannelIngestInput) => Promise<unknown>;
  notifyBooking: typeof notifySlackOnBooking;
  notifyTransfer: typeof notifySlackOnTransfer;
};

const defaultDeps: AriaToolDeps = {
  resolveCaller: resolveCallerDefault,
  lookupProperty: lookupPropertyForVoice,
  searchProperties: searchPropertiesForVoice,
  getCrm: () => resolveCrmAdapter(),
  calendarId: process.env.GHL_CALENDAR_ID || "",
  timezone: process.env.CALENDAR_TIMEZONE || "America/Chicago",
  queryAvailability: queryCalendarAvailability,
  bookAppointment: bookSharedAppointment,
  findUpcomingAppointmentByPhone,
  findAppointmentById,
  cancelAppointmentById,
  rescheduleAppointmentById,
  cancelGHLEvent,
  rescheduleGHLEvent,
  sendSms: sendTheoSms,
  recordSms: recordChannelInteraction,
  notifyBooking: notifySlackOnBooking,
  notifyTransfer: notifySlackOnTransfer,
};

export type AriaToolOutcome = {
  result: string; // spoken back to the caller
  ingest: ChannelIngestInput; // persisted by the route
};

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function consent(value: unknown): string {
  const text = str(value).toLowerCase();
  if (!text) return "";
  return ["1", "true", "yes", "y", "on", "sure", "ok", "okay", "consent"].includes(text) ? "yes" : "no";
}

function baseIngest(ctx: AriaToolContext): ChannelIngestInput {
  return {
    channel: "voice",
    direction: "inbound",
    agentName: IRIS_AGENT_NAME,
    phone: ctx.phone,
    source: "vapi",
    threadRef: ctx.threadRef,
    preferredChannel: "voice",
    status: "received",
  };
}

async function hydrateContext(ctx: AriaToolContext, deps: AriaToolDeps): Promise<AriaToolContext> {
  if (ctx.lead || !ctx.phone) return ctx;
  try {
    const identity = await deps.resolveCaller(ctx.phone);
    return identity.lead ? { ...ctx, lead: identity.lead } : ctx;
  } catch {
    return ctx;
  }
}

async function getCallerContext(ctx: AriaToolContext, identity: CallerIdentity): Promise<AriaToolOutcome> {
  const ingest: ChannelIngestInput = {
    ...baseIngest(ctx),
    eventType: "voice_caller_context",
    aiAction: identity.matched ? "caller_matched" : "caller_unknown",
  };

  if (!identity.matched || !identity.lead) {
    return {
      result: "New caller. No prior record. Greet naturally and offer to help.",
      ingest: { ...ingest, summary: "Inbound call from an unrecognized number." },
    };
  }

  const callerContext = await compileCallerContext(
    identity.lead,
    identity.events,
    identity.channelsSeen,
    identity.lastTouchAt,
  );

  return {
    result: buildCallerContextResponse(callerContext),
    ingest: {
      ...ingest,
      fullName: callerContext.full_name,
      email: callerContext.email,
      propertyInterest: callerContext.property_interest,
      summary: `Context loaded for${callerContext.full_name ? ` ${callerContext.full_name}` : " caller"}.`,
    },
  };
}

async function lookupProperty(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const address = str(args.address || args.property || args.query);
  const lookup = await deps.lookupProperty({
    address,
    phone: ctx.phone,
    message: str(args.message) || address,
    lead: ctx.lead || undefined,
  });
  const confirmedInterest = str(lookup.properties[0]?.address) || str(ctx.lead?.property_interest);
  return {
    result: lookup.spoken,
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_property_lookup",
      messageText: address,
      propertyInterest: confirmedInterest,
      aiAction: lookup.timedOut ? "property_lookup_async_sms" : "property_lookup",
      summary: lookup.spoken,
    },
  };
}

function num(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function zonedDateParts(date: Date, timezone: string): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: map.year || "1970",
    month: map.month || "01",
    day: map.day || "01",
    hour: map.hour === "24" ? "00" : map.hour || "00",
    minute: map.minute || "00",
    second: map.second || "00",
  };
}

function isoDateInZone(date: Date, timezone: string): string {
  const parts = zonedDateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = zonedDateParts(date, timezone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function zonedLocalToIso(date: string, time: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "";
  const timeMatch = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(time.trim());
  if (!timeMatch) return "";
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || "0");
  const meridiem = (timeMatch[3] || "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";

  const utcGuess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0);
  let instant = utcGuess - timeZoneOffsetMs(new Date(utcGuess), timezone);
  instant = utcGuess - timeZoneOffsetMs(new Date(instant), timezone);
  return new Date(instant).toISOString();
}

function resolveRequestedDate(value: unknown, timezone: string): string {
  const text = str(value).toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const now = new Date();
  const base = new Date(zonedLocalToIso(isoDateInZone(now, timezone), "12:00", timezone) || now.toISOString());
  if (/\btomorrow\b/.test(text)) {
    base.setUTCDate(base.getUTCDate() + 1);
    return isoDateInZone(base, timezone);
  }
  if (/\btoday\b/.test(text)) return isoDateInZone(base, timezone);
  const parsed = Date.parse(str(value));
  if (Number.isFinite(parsed)) return isoDateInZone(new Date(parsed), timezone);
  return "";
}

function availabilityWindow(args: Record<string, unknown>, timezone: string): { from: string; to: string; date: string; label: string } {
  const explicitFrom = str(args.from || args.start || args.startTime || args.start_time);
  const explicitTo = str(args.to || args.end || args.endTime || args.end_time);
  if (explicitFrom && explicitTo && Number.isFinite(Date.parse(explicitFrom)) && Number.isFinite(Date.parse(explicitTo))) {
    return {
      from: new Date(Date.parse(explicitFrom)).toISOString(),
      to: new Date(Date.parse(explicitTo)).toISOString(),
      date: isoDateInZone(new Date(Date.parse(explicitFrom)), timezone),
      label: "requested window",
    };
  }

  const date = resolveRequestedDate(args.date || args.day || args.requestedDate, timezone);
  if (!date) return { from: "", to: "", date: "", label: "" };
  const daypart = str(args.timeOfDay || args.time_of_day || args.period).toLowerCase();
  const [start, end, label] = daypart.includes("morning")
    ? ["09:00", "12:00", "morning"]
    : daypart.includes("afternoon")
      ? ["12:00", "17:00", "afternoon"]
      : daypart.includes("evening")
        ? ["17:00", "20:00", "evening"]
        : ["09:00", "17:00", "business hours"];
  return {
    from: zonedLocalToIso(date, start, timezone),
    to: zonedLocalToIso(date, end, timezone),
    date,
    label,
  };
}

function formatSlot(slot: AvailabilitySlot, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(slot.start));
}

function localDateAndTimeFromIso(value: string, timezone: string): { date: string; time: string } | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const parts = zonedDateParts(new Date(parsed), timezone);
  const hour = Number(parts.hour);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${twelveHour}:${parts.minute} ${suffix}`,
  };
}

async function checkAvailabilityTool(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const window = availabilityWindow(args, deps.timezone);
  const durationMinutes = num(args.durationMinutes ?? args.duration_minutes) || 30;
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_availability_checked" };

  if (!window.from || !window.to) {
    return {
      result: "What day should I check?",
      ingest: { ...ingestBase, aiAction: "availability_needs_date", status: "awaiting_response", summary: "Availability requested without a usable date or time window." },
    };
  }

  try {
    const slots = await deps.queryAvailability({
      calendarId: deps.calendarId || undefined,
      from: window.from,
      to: window.to,
      durationMinutes,
      timezone: deps.timezone,
      limit: 5,
    });
    if (!slots.length) {
      return {
        result: `I do not see an open ${durationMinutes}-minute slot for ${window.label} on ${window.date}. Want me to check another time that day?`,
        ingest: { ...ingestBase, aiAction: "availability_empty", status: "not_found", summary: `No availability from ${window.from} to ${window.to}.` },
      };
    }
    const choices = slots.slice(0, 3).map((slot) => formatSlot(slot, deps.timezone));
    return {
      result: `I have ${choices.join(", ")}. Which one works best?`,
      ingest: {
        ...ingestBase,
        aiAction: "availability_found",
        status: "available",
        summary: `Found ${slots.length} available slot${slots.length === 1 ? "" : "s"} from ${window.from} to ${window.to}.`,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      result: "I cannot read live calendar availability right now, so I will flag it for the team to confirm directly.",
      ingest: { ...ingestBase, aiAction: "availability_failed", status: "error", summary: `Availability check failed: ${message}` },
    };
  }
}

async function searchProperties(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const query = str(args.query || args.text);
  const area = str(args.area || args.location);
  const search = await deps.searchProperties({
    query,
    area,
    beds: num(args.beds),
    baths: num(args.baths),
    minPrice: num(args.minPrice ?? args.min_price),
    maxPrice: num(args.maxPrice ?? args.max_price),
    phone: ctx.phone,
    lead: ctx.lead || undefined,
  });
  const criteria = [area || query, args.beds ? `${args.beds}bd` : "", args.maxPrice ? `<=${args.maxPrice}` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    result: search.spoken,
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_property_search",
      messageText: criteria,
      aiAction: search.timedOut ? "property_search_async_sms" : search.properties.length ? "property_search_results" : "property_search_empty",
      summary: `Voice property search (${criteria || "general"}) → ${search.properties.length} matches.`,
    },
  };
}

function requestedDetailsBody(properties: SheetRow[]): string {
  const usable = properties.filter((property) => str(property.address)).slice(0, 3);
  if (!usable.length) return "";
  return usable.map(propertySmsBody).join("\n\n");
}

function listingMediaUrls(properties: SheetRow[], includePhotos: boolean): string[] {
  if (!includePhotos) return [];
  return properties
    .map((property) => usableInboxPhotoUrl(property.photo_url))
    .filter(Boolean)
    .slice(0, Math.max(0, Number(process.env.SMS_MAX_IMAGES || "3")));
}

async function sendPropertyDetailsSms(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const hydrated = await hydrateContext(ctx, deps);
  const phone = str(args.phone || args.callerPhone) || hydrated.phone;
  const address = str(args.address || args.property || args.propertyAddress);
  const query = str(args.query || args.message || args.text) || address || str(hydrated.lead?.property_interest);
  const includePhotos = str(args.includePhotos ?? args.photos ?? "true").toLowerCase() !== "false";
  const ingestBase = { ...baseIngest(hydrated), eventType: "voice_property_details_sms" };

  if (!phone) {
    return {
      result: "What's the best number to text the listing details to?",
      ingest: { ...ingestBase, aiAction: "property_details_sms_needs_phone", status: "awaiting_response", summary: "Caller asked for listing details/photos, but no SMS number was available." },
    };
  }

  let properties: SheetRow[] = [];
  if (address) {
    const lookup = await deps.lookupProperty({
      address,
      phone,
      message: query,
      lead: hydrated.lead || undefined,
    });
    properties = lookup.properties;
  }

  if (!properties.length) {
    const search = await deps.searchProperties({
      query,
      area: str(args.area || args.location),
      beds: num(args.beds),
      baths: num(args.baths),
      minPrice: num(args.minPrice ?? args.min_price),
      maxPrice: num(args.maxPrice ?? args.max_price),
      phone,
      lead: hydrated.lead || undefined,
    });
    properties = search.properties;
  }

  const body = requestedDetailsBody(properties);
  if (!body) {
    return {
      result: "I don't have a clean listing match to text yet. Can you confirm the address or area?",
      ingest: { ...ingestBase, messageText: query, aiAction: "property_details_sms_no_match", status: "not_found", summary: `No listing match to text for ${query || "caller request"}.` },
    };
  }

  const mediaUrls = listingMediaUrls(properties, includePhotos);
  const sendResult = await deps.sendSms(phone, body, mediaUrls);
  const firstAddress = str(properties[0]?.address);
  const sent =
    typeof sendResult === "object" && sendResult !== null && "sent" in sendResult
      ? Boolean((sendResult as { sent?: unknown }).sent)
      : true;
  const skipped =
    typeof sendResult === "object" && sendResult !== null && "skipped" in sendResult
      ? Boolean((sendResult as { skipped?: unknown }).skipped)
      : false;
  const sendError =
    typeof sendResult === "object" && sendResult !== null && "error" in sendResult
      ? String((sendResult as { error?: unknown }).error || "")
      : "";
  await deps.recordSms?.({
    channel: "sms",
    direction: "outbound",
    agentName: IRIS_AGENT_NAME,
    phone,
    source: "vapi",
    sourceDetail: ctx.callId ? `voice call ${ctx.callId}` : "voice tool",
    threadRef: `sms:${phone}`,
    eventType: "sms_ai_reply",
    messageText: smsMessageWithMediaLog(body, mediaUrls),
    summary: `${IRIS_AGENT_NAME} texted ${properties.length} listing detail${properties.length === 1 ? "" : "s"} from a voice call${mediaUrls.length ? ` with ${mediaUrls.length} photo${mediaUrls.length === 1 ? "" : "s"}` : ""}${firstAddress ? ` for ${firstAddress}` : ""}.`,
    aiAction: mediaUrls.length ? "property_details_sms_sent_with_photos" : "property_details_sms_sent",
    handoffReason: sendError,
    status: sent ? "sent" : skipped ? "skipped" : "send_failed",
    propertyInterest: firstAddress || str(hydrated.lead?.property_interest),
    preferredChannel: "sms",
    smsConsent: "voice_requested_sms",
    nextAction: sent ? "await_response" : "human_follow_up",
  }).catch(() => null);
  const result = sent
    ? mediaUrls.length
      ? "Sent - I texted the listing details and photos now."
      : "Sent - I texted the listing details now. I did not have a sendable photo for that one."
    : "I tried to text the listing details, but the SMS did not send. I logged it for the team to review.";

  return {
    result,
    ingest: {
      ...ingestBase,
      messageText: query,
      propertyInterest: firstAddress || str(hydrated.lead?.property_interest),
      aiAction: mediaUrls.length ? "property_details_sms_sent_with_photos" : "property_details_sms_sent",
      nextAction: sent ? "sms_listing_details_sent" : "human_follow_up",
      status: sent ? "sent" : skipped ? "skipped" : "send_failed",
      summary: `${IRIS_AGENT_NAME} texted ${properties.length} listing detail${properties.length === 1 ? "" : "s"}${mediaUrls.length ? ` with ${mediaUrls.length} photo${mediaUrls.length === 1 ? "" : "s"}` : ""}${firstAddress ? ` for ${firstAddress}` : ""}.`,
      handoffReason: sendError,
    },
  };
}

function contactFromCtx(ctx: AriaToolContext, args: Record<string, unknown>): ShowingContact {
  return {
    phone: ctx.phone,
    email: str(args.email).toLowerCase() || str(ctx.lead?.email).toLowerCase(),
    fullName: str(args.name || args.full_name) || str(ctx.lead?.full_name),
  };
}

async function scheduleShowingTool(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const action = (str(args.action) || "book").toLowerCase();
  const adapter = deps.getCrm();
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_schedule_showing" };

  if (!adapter || !deps.calendarId) {
    return {
      result: "Scheduling isn't connected yet, but I'll have a team member set that up and follow up with you.",
      ingest: { ...ingestBase, aiAction: "scheduling_unavailable", summary: "Scheduling requested but CRM/calendar not configured." },
    };
  }

  const contact = contactFromCtx(ctx, args);
  if (!contact.phone && !contact.email) {
    return {
      result: "Before I book that, can I get the best phone or email for the appointment?",
      ingest: { ...ingestBase, aiAction: "scheduling_needs_identity", summary: "Scheduling blocked: no caller identity to attach." },
    };
  }

  if (action === "cancel") {
    const result = await cancelShowing(adapter, { contact });
    return {
      result: result.spoken,
      ingest: { ...ingestBase, aiAction: result.ok ? "showing_cancelled" : "showing_cancel_failed", summary: result.spoken },
    };
  }

  if (action === "reschedule") {
    const newStart = str(args.newStartTime || args.new_start_time || args.startTime || args.start_time);
    if (!newStart) {
      return { result: "What new day and time works for the showing?", ingest: { ...ingestBase, aiAction: "showing_reschedule_needs_time", summary: "Reschedule requested without a new time." } };
    }
    const result = await rescheduleShowing(adapter, { contact, newStartTime: newStart, timezone: deps.timezone });
    return {
      result: result.spoken,
      ingest: { ...ingestBase, aiAction: result.ok ? "showing_rescheduled" : "showing_reschedule_failed", summary: result.spoken },
    };
  }

  const startTime = str(args.startTime || args.start_time || args.time);
  if (!startTime) {
    return { result: "What day and time would you like to tour it?", ingest: { ...ingestBase, aiAction: "showing_needs_time", summary: "Booking requested without a time." } };
  }
  const address = str(args.address || args.property || ctx.lead?.property_interest);
  const result = await scheduleShowing(adapter, {
    calendarId: deps.calendarId,
    contact,
    startTime,
    endTime: str(args.endTime || args.end_time) || undefined,
    timezone: deps.timezone,
    address: address || undefined,
  });
  return {
    result: result.spoken,
    ingest: {
      ...ingestBase,
      fullName: contact.fullName || "",
      email: contact.email || "",
      propertyInterest: address,
      aiAction: "showing_booked",
      nextAction: "showing_scheduled",
      summary: result.spoken,
    },
  };
}

function appointmentType(value: unknown): AppointmentInput["appointment_type"] {
  const text = str(value);
  if (text === "consultation" || text === "listing_appt" || text === "follow_up") return text;
  return "showing";
}

async function bookAppointmentTool(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  let date = str(args.date);
  let time = str(args.time);
  const appointmentTime = str(args.appointmentTime || args.appointment_time || args.scheduledAt || args.scheduled_at || args.slotStart || args.slot_start);
  if ((!date || !time) && appointmentTime) {
    const parsed = localDateAndTimeFromIso(appointmentTime, deps.timezone);
    if (parsed) {
      date ||= parsed.date;
      time ||= parsed.time;
    }
  }
  const callerPhone = str(args.caller_phone || args.callerPhone || args.phone) || ctx.phone;
  const callerName = str(args.caller_name || args.callerName || args.name) || str(ctx.lead?.full_name);
  const callerEmail = str(args.caller_email || args.callerEmail || args.email) || str(ctx.lead?.email);
  const propertyAddress = str(args.property_address || args.propertyAddress || args.address || args.property) || str(ctx.lead?.property_interest);
  const appointmentKind = appointmentType(args.appointment_type || args.appointmentType || "consultation");
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_appointment_booked" };

  if (!date || !time || !callerPhone) {
    return {
      result: "I need the date, time, and best phone number before I can book that.",
      ingest: { ...ingestBase, aiAction: "appointment_needs_details", status: "awaiting_response", summary: "Booking requested with missing date, time, or phone." },
    };
  }

  const result = await deps.bookAppointment({
    date,
    time,
    duration_minutes: num(args.duration_minutes ?? args.durationMinutes) || 30,
    property_address: propertyAddress,
    caller_name: callerName,
    caller_phone: callerPhone,
    caller_email: callerEmail,
    notes: str(args.notes),
    appointment_type: appointmentKind,
    booked_via_channel: "voice",
    timezone: deps.timezone,
    call_id: ctx.callId,
  });

  if (!result.success) {
    return {
      result: "I couldn't lock that in right now. I'll flag it so the team can confirm with you directly.",
      ingest: { ...ingestBase, aiAction: "appointment_booking_failed", status: "error", summary: `Booking failed: ${result.error || "unknown error"}` },
    };
  }

  await deps.notifyBooking({
    outcome: "BOOKED",
    caller_name: callerName,
    caller_phone: callerPhone,
    appointment_time: result.confirmed_time,
    property_address: propertyAddress,
    notes: str(args.notes),
    channel: "voice",
    call_id: ctx.callId,
  }).catch(() => null);

  return {
    result: `Booked - ${result.confirmed_time || `${date} at ${time}`}. Confirmation text coming now.`,
    ingest: {
      ...ingestBase,
      fullName: callerName,
      email: callerEmail,
      propertyInterest: propertyAddress,
      aiAction: "appointment_booked",
      nextAction: "appointment_confirmed",
      status: "booked",
      appointmentId: result.neon_id || result.appointment_id || "",
      outcomeCode: "BOOKED",
      summary: `Booked ${appointmentKind} at ${result.confirmed_time || `${date} at ${time}`}${propertyAddress ? ` - ${propertyAddress}` : ""}.`,
    },
  };
}

async function resolveAppointmentForChange(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AppointmentRecord | null> {
  const appointmentId = str(args.appointment_id || args.appointmentId);
  if (appointmentId) {
    const byId = await deps.findAppointmentById(appointmentId).catch(() => null);
    if (byId) return byId;
  }
  const phone = str(args.caller_phone || args.phone) || ctx.phone;
  return phone ? deps.findUpcomingAppointmentByPhone(phone).catch(() => null) : null;
}

async function cancelAppointmentTool(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const appt = await resolveAppointmentForChange(ctx, args, deps);
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_appointment_cancelled" };
  if (!appt) {
    return {
      result: "I don't see an upcoming appointment on file. Want to book one?",
      ingest: { ...ingestBase, eventType: "voice_cancel_no_appt", aiAction: "appointment_cancel_not_found", status: "not_found" },
    };
  }

  await deps.cancelAppointmentById(appt.id);
  if (appt.ghl_event_id) await deps.cancelGHLEvent(appt.ghl_event_id).catch(() => false);

  return {
    result: "Done - your appointment has been cancelled. Anything else I can help with?",
    ingest: {
      ...ingestBase,
      aiAction: "appointment_cancelled",
      appointmentId: appt.id,
      status: "cancelled",
      summary: `Cancelled ${appt.scheduled_at_local || appt.scheduled_at}${str(args.reason) ? ` - ${str(args.reason)}` : ""}.`,
    },
  };
}

async function rescheduleAppointmentTool(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const appt = await resolveAppointmentForChange(ctx, args, deps);
  const newDate = str(args.new_date || args.date);
  const newTime = str(args.new_time || args.time);
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_appointment_rescheduled" };
  if (!appt) {
    return {
      result: "I don't see an upcoming appointment on file. Want to book a new one?",
      ingest: { ...ingestBase, eventType: "voice_reschedule_no_appt", aiAction: "appointment_reschedule_not_found", status: "not_found" },
    };
  }
  if (!newDate || !newTime) {
    return {
      result: "What new day and time works?",
      ingest: { ...ingestBase, aiAction: "appointment_reschedule_needs_time", status: "awaiting_response" },
    };
  }

  const ghlResult = appt.ghl_event_id
    ? await deps.rescheduleGHLEvent(appt.ghl_event_id, newDate, newTime, deps.timezone)
    : { success: true, confirmed_time: `${newDate} at ${newTime}` };
  if (ghlResult.success) {
    await deps.rescheduleAppointmentById(
      appt.id,
      parseLocalDateTime(newDate, newTime, deps.timezone),
      ghlResult.confirmed_time || `${newDate} at ${newTime}`,
      appt.ghl_event_id,
    );
    if (process.env.SEND_BOOKING_CONFIRMATION_SMS === "true") {
      await deps.sendSms(ctx.phone, `Rescheduled to ${ghlResult.confirmed_time || `${newDate} at ${newTime}`}. Questions? Reply here.`).catch(() => null);
    }
  }

  return {
    result: ghlResult.success
      ? `Done - rescheduled to ${ghlResult.confirmed_time || `${newDate} at ${newTime}`}. Another confirmation is coming now.`
      : "I had trouble updating that. I'll flag it for the team.",
    ingest: {
      ...ingestBase,
      aiAction: ghlResult.success ? "appointment_rescheduled" : "appointment_reschedule_failed",
      appointmentId: appt.id,
      status: ghlResult.success ? "rescheduled" : "error",
      summary: ghlResult.success ? `Rescheduled to ${ghlResult.confirmed_time || `${newDate} at ${newTime}`}.` : `Reschedule failed: ${ghlResult.error || "unknown error"}`,
    },
  };
}

async function syncToCrm(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const adapter = deps.getCrm();
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_crm_sync" };
  if (!adapter) {
    return { result: "Noted.", ingest: { ...ingestBase, aiAction: "crm_sync_skipped", summary: "CRM not configured; sync skipped." } };
  }
  const contact = contactFromCtx(ctx, args);
  if (!contact.phone && !contact.email) {
    return { result: "Noted.", ingest: { ...ingestBase, aiAction: "crm_sync_skipped", summary: "CRM sync skipped: no caller identity." } };
  }
  const upserted = await adapter.upsertContact({ phone: contact.phone, email: contact.email, fullName: contact.fullName });
  const note = str(args.note || args.summary) || `Voice call handled by ${IRIS_AGENT_NAME}.`;
  await adapter.logActivity({ contactId: upserted.id, body: note, channel: "voice", direction: "inbound", type: "note" });
  if (str(args.outcome).toUpperCase() === "TRANSFERRED") {
    await deps.notifyTransfer({
      outcome: "TRANSFERRED",
      caller_phone: ctx.phone,
      caller_name: contact.fullName || str(ctx.lead?.full_name),
      notes: note,
      tone: "neutral",
      call_id: ctx.callId,
      channel: "voice",
    }).catch(() => null);
  }
  return {
    result: "Done, I've saved that to your record.",
    ingest: { ...ingestBase, fullName: contact.fullName || "", email: contact.email || "", aiAction: "crm_synced", summary: `Synced to CRM: ${note}` },
  };
}

function qualifyLead(ctx: AriaToolContext, args: Record<string, unknown>): AriaToolOutcome {
  const fullName = str(args.name || args.full_name || args.fullName);
  const email = str(args.email).toLowerCase();
  const role = str(args.role || args.lead_role || args.leadRole);
  const budget = str(args.budget);
  const timeline = str(args.timeline);
  const area = str(args.area || args.location);
  const bedrooms = str(args.bedrooms || args.beds);
  const bathrooms = str(args.bathrooms || args.baths);
  const preferredChannel = str(args.preferred_channel || args.preferredChannel);
  const interest = str(args.property || args.property_interest || args.propertyInterest || args.address);
  const callConsent = consent(args.call_consent ?? args.callConsent);
  const smsConsent = consent(args.sms_consent ?? args.smsConsent);

  const confirmBits = [
    role ? `a ${role}` : "your details",
    budget ? `budget ${budget}` : "",
    area ? `in ${area}` : "",
    bedrooms ? bedrooms : "",
    bathrooms ? bathrooms : "",
    timeline ? `timeline ${timeline}` : "",
  ].filter(Boolean).join(", ");

  return {
    result: `Got it — I've noted ${confirmBits}. A team member will follow up.`,
    ingest: {
      ...baseIngest(ctx),
      fullName,
      email,
      eventType: "voice_qualify",
      leadRole: role,
      intent: role ? `${role}_lead` : "",
      propertyInterest: interest,
      preferredChannel,
      callConsent,
      smsConsent,
      aiAction: "lead_qualified",
      nextAction: "review_or_followup",
      summary: [
        "Voice lead qualified.",
        role ? `role=${role}` : "",
        budget ? `budget=${budget}` : "",
        area ? `area=${area}` : "",
        bedrooms ? `beds=${bedrooms}` : "",
        bathrooms ? `baths=${bathrooms}` : "",
        timeline ? `timeline=${timeline}` : "",
        preferredChannel ? `preferred_channel=${preferredChannel}` : "",
        interest ? `interest=${interest}` : "",
      ].filter(Boolean).join(" "),
    },
  };
}

export async function runAriaTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AriaToolContext,
  deps: AriaToolDeps = defaultDeps,
): Promise<AriaToolOutcome> {
  switch (name) {
    case "getCallerContext": {
      const identity = await deps.resolveCaller(ctx.phone);
      return getCallerContext(ctx, identity);
    }
    case "lookupProperty":
      return lookupProperty(await hydrateContext(ctx, deps), args, deps);
    case "searchProperties":
      return searchProperties(await hydrateContext(ctx, deps), args, deps);
    case "sendPropertyDetailsSms":
      return sendPropertyDetailsSms(ctx, args, deps);
    case "checkAvailability":
      return checkAvailabilityTool(await hydrateContext(ctx, deps), args, deps);
    case "bookConsultation":
      return bookAppointmentTool(await hydrateContext(ctx, deps), args, deps);
    case "scheduleShowing":
      return scheduleShowingTool(await hydrateContext(ctx, deps), args, deps);
    case "bookAppointment":
      return bookAppointmentTool(await hydrateContext(ctx, deps), args, deps);
    case "cancelAppointment":
      return cancelAppointmentTool(await hydrateContext(ctx, deps), args, deps);
    case "rescheduleAppointment":
      return rescheduleAppointmentTool(await hydrateContext(ctx, deps), args, deps);
    case "syncToCrm":
      return syncToCrm(await hydrateContext(ctx, deps), args, deps);
    case "qualifyLead":
      return qualifyLead(ctx, args);
    default:
      return {
        result: `Unknown tool: ${name}.`,
        ingest: {
          ...baseIngest(ctx),
          eventType: "voice_tool_unknown",
          aiAction: "tool_unknown",
          summary: `Unknown ${IRIS_AGENT_NAME} tool requested: ${name}.`,
          status: "error",
        },
      };
  }
}
