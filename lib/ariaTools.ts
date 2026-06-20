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

import type { ChannelIngestInput } from "@/lib/channelIngest";
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
import { sendTheoSms } from "@/lib/twilioSms";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

export type AriaToolName =
  | "getCallerContext"
  | "lookupProperty"
  | "searchProperties"
  | "sendPropertyDetailsSms"
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
  bookAppointment: (input: AppointmentInput) => Promise<{ success: boolean; appointment_id?: string; neon_id?: string; confirmed_time?: string; error?: string }>;
  findUpcomingAppointmentByPhone: (phone: string) => Promise<AppointmentRecord | null>;
  findAppointmentById: (id: string) => Promise<AppointmentRecord | null>;
  cancelAppointmentById: (id: string) => Promise<boolean>;
  rescheduleAppointmentById: (id: string, newScheduledAt: string, newScheduledAtLocal: string, newGhlEventId?: string) => Promise<AppointmentRecord | null>;
  cancelGHLEvent: (ghlEventId: string) => Promise<boolean>;
  rescheduleGHLEvent: (ghlEventId: string, newDate: string, newTime: string, timezone?: string) => Promise<{ success: boolean; confirmed_time?: string; error?: string }>;
  sendSms: (to: string, body: string, mediaUrls?: string[]) => Promise<unknown>;
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
  bookAppointment: bookSharedAppointment,
  findUpcomingAppointmentByPhone,
  findAppointmentById,
  cancelAppointmentById,
  rescheduleAppointmentById,
  cancelGHLEvent,
  rescheduleGHLEvent,
  sendSms: sendTheoSms,
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
  await deps.sendSms(phone, body, mediaUrls);
  const firstAddress = str(properties[0]?.address);
  const result = mediaUrls.length
    ? "Sent - I texted the listing details and photos now."
    : "Sent - I texted the listing details now. I did not have a sendable photo for that one.";

  return {
    result,
    ingest: {
      ...ingestBase,
      messageText: query,
      propertyInterest: firstAddress || str(hydrated.lead?.property_interest),
      aiAction: mediaUrls.length ? "property_details_sms_sent_with_photos" : "property_details_sms_sent",
      nextAction: "sms_listing_details_sent",
      status: "sent",
      summary: `${IRIS_AGENT_NAME} texted ${properties.length} listing detail${properties.length === 1 ? "" : "s"}${mediaUrls.length ? ` with ${mediaUrls.length} photo${mediaUrls.length === 1 ? "" : "s"}` : ""}${firstAddress ? ` for ${firstAddress}` : ""}.`,
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
  const date = str(args.date);
  const time = str(args.time);
  const callerPhone = str(args.caller_phone || args.phone) || ctx.phone;
  const callerName = str(args.caller_name || args.name) || str(ctx.lead?.full_name);
  const callerEmail = str(args.caller_email || args.email) || str(ctx.lead?.email);
  const propertyAddress = str(args.property_address || args.address || args.property) || str(ctx.lead?.property_interest);
  const appointmentKind = appointmentType(args.appointment_type);
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
    duration_minutes: num(args.duration_minutes) || 30,
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
