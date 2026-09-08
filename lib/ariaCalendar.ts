import { clientConfig } from "@/lib/clientConfig";
import { createAppointment, type AppointmentType } from "@/lib/appointmentStore";
import { resolveCrmAdapter } from "@/lib/crm";
import { sendTheoSms } from "@/lib/twilioSms";
import { activeCalendarProviderName } from "@/lib/calendar/resolver";
import { bookTenantCalendarEvent, requestedSlotIsAvailable, tenantCalendarConnectionStatus } from "@/lib/tenantCalendar";
import {
  advanceSchedulingRequest,
  beginSchedulingRequest,
  markSchedulingPending,
  type ProviderReceipt,
} from "@/lib/schedulingState";

export type AppointmentInput = {
  date: string;
  time: string;
  duration_minutes?: number;
  property_address?: string;
  caller_name: string;
  caller_phone: string;
  caller_email?: string;
  notes?: string;
  appointment_type: AppointmentType;
  booked_via_channel?: string;
  timezone?: string;
  call_id?: string;
};

export type AppointmentResult = {
  success: boolean;
  appointment_id?: string;
  neon_id?: string;
  confirmed_time?: string;
  calendar_url?: string;
  provider_used?: string;
  pending?: boolean;
  receipt_verified?: boolean;
  provider_receipt?: ProviderReceipt;
  scheduling_request_id?: string;
  availability_status?: "available" | "empty" | "provider_unavailable";
  error?: string;
};

export function parseLocalDateTime(date: string, time: string, timezone = "America/Chicago"): string {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!dateMatch || !timeMatch) throw new Error("Invalid local appointment date or time");
  let hours = Number.parseInt(timeMatch[1], 10);
  const minutes = Number.parseInt(timeMatch[2] || "00", 10);
  const ampm = timeMatch[3].toLowerCase();
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) throw new Error("Invalid local appointment time");
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  const desiredLocalMs = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    minutes,
    0,
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = desiredLocalMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const representedLocalMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const correction = desiredLocalMs - representedLocalMs;
    instant += correction;
    if (correction === 0) break;
  }
  const roundTrip = formatter.formatToParts(new Date(instant));
  const values = Object.fromEntries(roundTrip.map((part) => [part.type, part.value]));
  if (
    Number(values.year) !== Number(dateMatch[1])
    || Number(values.month) !== Number(dateMatch[2])
    || Number(values.day) !== Number(dateMatch[3])
    || Number(values.hour) !== hours
    || Number(values.minute) !== minutes
  ) throw new Error("The requested local time does not exist in this timezone");
  return new Date(instant).toISOString();
}

function addMinutes(isoString: string, minutes: number): string {
  const date = new Date(isoString);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString().replace(".000Z", "");
}

async function bookGHL(input: AppointmentInput): Promise<AppointmentResult> {
  const config = clientConfig();
  const calendarId = config.calendarId || process.env.GHL_CALENDAR_ID || "";
  const adapter = resolveCrmAdapter(config);
  if (!adapter || !calendarId) {
    return { success: false, provider_used: "ghl", error: "GHL not configured" };
  }

  const timezone = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const startTime = parseLocalDateTime(input.date, input.time, timezone);
  const endTime = addMinutes(startTime, input.duration_minutes ?? 30);

  try {
    const contact = await adapter.upsertContact({
      phone: input.caller_phone,
      email: input.caller_email,
      fullName: input.caller_name,
      source: "lumenosis_agent_os",
      tags: [process.env.GHL_CONTACT_TAG_VOICE || "aria-voice"],
    });
    const appointment = await adapter.createAppointment({
      calendarId,
      contactId: contact.id,
      startTime,
      endTime,
      timezone,
      title: `${input.appointment_type === "showing" ? "Showing" : "Appointment"} - ${input.caller_name || input.caller_phone}`,
      address: input.property_address,
      notes: [
        input.property_address ? `Property: ${input.property_address}` : "",
        input.notes || "",
        `Booked via: ${input.booked_via_channel || "unknown"}`,
      ].filter(Boolean).join("\n"),
    });
    return {
      success: true,
      provider_used: "ghl",
      appointment_id: appointment.id,
      confirmed_time: `${input.date} at ${input.time}`,
    };
  } catch (error) {
    return { success: false, provider_used: "ghl", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function bookAppointment(input: AppointmentInput): Promise<AppointmentResult> {
  const timezone = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const scheduledAt = parseLocalDateTime(input.date, input.time, timezone);
  const endAt = addMinutes(scheduledAt, input.duration_minutes ?? 30);
  let requestResult;
  try {
    requestResult = await beginSchedulingRequest({
      channel: input.booked_via_channel || "unknown",
      threadRef: input.call_id ? `voice:${input.call_id}` : `${input.booked_via_channel || "unknown"}:${input.caller_phone}`,
      requestedStart: scheduledAt,
      requestedEnd: endAt,
      timezone,
      contact: input.caller_email || input.caller_phone,
      propertyAddress: input.property_address,
      appointmentType: input.appointment_type,
    });
  } catch (error) {
    return {
      success: false,
      pending: true,
      receipt_verified: false,
      error: `Scheduling state is unavailable; no provider mutation was attempted: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let schedulingRequest = requestResult.request;
  if (!requestResult.created) {
    if (schedulingRequest.status === "confirmed" && schedulingRequest.providerReceipt?.readBackVerified) {
      return {
        success: true,
        appointment_id: schedulingRequest.providerEventId,
        confirmed_time: new Date(schedulingRequest.requestedStart).toLocaleString("en-US", { timeZone: timezone }),
        provider_used: schedulingRequest.provider,
        receipt_verified: true,
        provider_receipt: schedulingRequest.providerReceipt,
        scheduling_request_id: schedulingRequest.id,
        availability_status: "available",
      };
    }
    return {
      success: false,
      pending: true,
      appointment_id: schedulingRequest.providerEventId || undefined,
      provider_used: schedulingRequest.provider,
      receipt_verified: false,
      scheduling_request_id: schedulingRequest.id,
      error: "An identical request is already pending provider confirmation",
    };
  }

  const availability = await requestedSlotIsAvailable({ start: scheduledAt, end: endAt, timezone });
  if (!availability.ok) {
    schedulingRequest = await advanceSchedulingRequest(schedulingRequest, "submitted");
    schedulingRequest = await markSchedulingPending(schedulingRequest, availability.provider, "availability_provider_unavailable");
    return {
      success: false,
      pending: true,
      receipt_verified: false,
      scheduling_request_id: schedulingRequest.id,
      availability_status: "provider_unavailable",
      error: "Calendar availability could not be verified",
    };
  }
  if (!availability.available) {
    schedulingRequest = await advanceSchedulingRequest(schedulingRequest, "provider_declined", { errorCode: "slot_unavailable" });
    return {
      success: false,
      pending: false,
      receipt_verified: false,
      scheduling_request_id: schedulingRequest.id,
      availability_status: "empty",
      error: "Requested time is no longer available",
    };
  }
  schedulingRequest = await advanceSchedulingRequest(schedulingRequest, "availability_found");
  schedulingRequest = await advanceSchedulingRequest(schedulingRequest, "slot_selected");
  schedulingRequest = await advanceSchedulingRequest(schedulingRequest, "submitted");
  const connection = await tenantCalendarConnectionStatus();
  const providerName = connection.connected && connection.provider !== "legacy_env"
    ? connection.provider
    : activeCalendarProviderName();

  let result: AppointmentResult;

  // Google / Outlook: use the tenant-scoped connection and always verify
  // free/busy immediately before creating the event.
  if (connection.connected || providerName === "google" || providerName === "outlook") {
    const title = `${input.appointment_type === "showing" ? "Showing" : "Appointment"} — ${input.caller_name || input.caller_phone}`;
    const booked = await bookTenantCalendarEvent({
      start: scheduledAt,
      end: endAt,
      timezone,
      title,
      description: input.notes,
      attendeeEmail: input.caller_email,
      attendeeName: input.caller_name,
      attendeePhone: input.caller_phone,
      propertyAddress: input.property_address,
    });
    result = {
      success: booked.success && booked.receiptVerified === true && Boolean(booked.eventId),
      pending: booked.pending || !booked.receiptVerified,
      appointment_id: booked.eventId,
      confirmed_time: booked.confirmedStart ? new Date(booked.confirmedStart).toLocaleString("en-US", { timeZone: timezone }) : `${input.date} at ${input.time}`,
      calendar_url: booked.htmlLink,
      provider_used: providerName,
      receipt_verified: booked.receiptVerified === true,
      error: booked.error,
    };
    if (booked.receiptVerified && booked.eventId) {
      const receipt: ProviderReceipt = {
        provider: providerName,
        eventId: booked.eventId,
        start: booked.confirmedStart || scheduledAt,
        end: booked.confirmedEnd || endAt,
        readBackVerified: true,
        readBackAt: new Date().toISOString(),
      };
      schedulingRequest = await advanceSchedulingRequest(schedulingRequest, "provider_verified", { provider: providerName, receipt });
      result.provider_receipt = receipt;
      result.scheduling_request_id = schedulingRequest.id;
    } else {
      schedulingRequest = await markSchedulingPending(schedulingRequest, providerName, booked.error || "provider_receipt_unverified");
      result.scheduling_request_id = schedulingRequest.id;
    }
  } else {
    // Fail closed: creating a GHL event without first reading the authoritative
    // calendar could double-book the tenant. Legacy behavior is an explicit,
    // temporary escape hatch only.
    result = process.env.ALLOW_UNVERIFIED_GHL_BOOKING === "true"
      ? await bookGHL(input)
      : { success: false, provider_used: "none", error: "A conflict-aware calendar connection is required" };
    result = {
      ...result,
      success: false,
      pending: true,
      receipt_verified: false,
      scheduling_request_id: schedulingRequest.id,
      error: result.error || "Provider receipt cannot be verified by read-back",
    };
    schedulingRequest = await markSchedulingPending(schedulingRequest, result.provider_used || "none", result.error);
  }

  if (!result.success) return result;

  const neonRecord = await createAppointment({
    caller_phone: input.caller_phone,
    caller_name: input.caller_name,
    caller_email: input.caller_email,
    appointment_type: input.appointment_type,
    property_address: input.property_address,
    scheduled_at: scheduledAt,
    scheduled_at_local: result.confirmed_time || `${input.date} at ${input.time}`,
    duration_minutes: input.duration_minutes || 30,
    ghl_event_id: result.appointment_id,
    booked_via_channel: input.booked_via_channel || "unknown",
    call_id: input.call_id,
    notes: input.notes,
  }).catch(() => null);
  if (neonRecord) result.neon_id = neonRecord.id;

  if (process.env.SEND_BOOKING_CONFIRMATION_SMS === "true" && input.caller_phone) {
    const message = [
      `${input.appointment_type === "showing" ? "Showing" : "Appointment"} confirmed.`,
      result.confirmed_time || `${input.date} at ${input.time}`,
      input.property_address || "",
      "Reply here with questions.",
    ].filter(Boolean).join("\n");
    await sendTheoSms(input.caller_phone, message).catch(() => null);
  }

  return result;
}

export async function cancelGHLEvent(ghlEventId: string): Promise<boolean> {
  const adapter = resolveCrmAdapter();
  if (!adapter || !ghlEventId) return false;
  await adapter.cancelAppointment(ghlEventId);
  return true;
}

export async function rescheduleGHLEvent(
  ghlEventId: string,
  newDate: string,
  newTime: string,
  timezone = "America/Chicago",
): Promise<{ success: boolean; confirmed_time?: string; error?: string }> {
  const adapter = resolveCrmAdapter();
  if (!adapter || !ghlEventId) return { success: false, error: "Missing GHL adapter or event id" };
  const startTime = parseLocalDateTime(newDate, newTime, timezone);
  const endTime = addMinutes(startTime, 30);
  const availability = await requestedSlotIsAvailable({ start: startTime, end: endTime, timezone });
  if (!availability.ok || !availability.available) {
    return { success: false, error: availability.reason === "not_connected" ? "Calendar is not connected" : "Requested time is unavailable" };
  }
  await adapter.updateAppointment(ghlEventId, { startTime, endTime, timezone });
  return { success: true, confirmed_time: `${newDate} at ${newTime}` };
}
