import { clientConfig } from "@/lib/clientConfig";
import { createAppointment, type AppointmentType } from "@/lib/appointmentStore";
import { resolveCrmAdapter } from "@/lib/crm";
import { sendTheoSms } from "@/lib/twilioSms";

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
  error?: string;
};

export function parseLocalDateTime(date: string, time: string, _timezone = "America/Chicago"): string {
  const match = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return `${date}T10:00:00`;
  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2] || "00", 10);
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
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
  const provider = (process.env.CALENDAR_PROVIDER || "ghl").toLowerCase();
  const result = provider === "ghl"
    ? await bookGHL(input)
    : { success: false, provider_used: provider, error: `Calendar provider ${provider} not supported for direct booking` };

  if (!result.success) return result;

  const timezone = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const scheduledAt = parseLocalDateTime(input.date, input.time, timezone);
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
  await adapter.updateAppointment(ghlEventId, { startTime, endTime, timezone });
  return { success: true, confirmed_time: `${newDate} at ${newTime}` };
}
