// Showing scheduling over a CrmAdapter (GHL Calendars today). Aria's
// scheduleShowing tool calls these; the adapter is injected so the logic is
// unit-testable without HTTP. GHL natively two-way-syncs to the agent's
// Google/Outlook, so booking here surfaces on their calendar; buildIcsInvite()
// covers Apple/iCloud and any client via a standard .ics attachment.

import type { CrmAdapter, CrmAppointment, CrmContactInput } from "@/lib/crm/types";

export type ShowingContact = CrmContactInput & { phone?: string; email?: string; fullName?: string };

export type ScheduleShowingInput = {
  calendarId: string;
  contact: ShowingContact;
  startTime: string; // ISO 8601
  endTime?: string;
  timezone?: string;
  address?: string;
  notes?: string;
};

export type ShowingResult = {
  appointment: CrmAppointment;
  contactId: string;
  ics: string;
  spoken: string;
};

const HOUR_MS = 60 * 60 * 1000;

function addHour(iso: string): string {
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return iso;
  return new Date(start + HOUR_MS).toISOString();
}

// Human-friendly spoken time. Falls back to the raw value if unparseable.
export function formatWhen(iso: string, timezone?: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "America/Chicago",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toUTCString();
  }
}

function icsStamp(iso: string): string {
  const ms = Date.parse(iso);
  const date = Number.isFinite(ms) ? new Date(ms) : new Date(0);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildIcsInvite(input: { title: string; startTime: string; endTime?: string; address?: string; description?: string; uid?: string }): string {
  const end = input.endTime || addHour(input.startTime);
  const uid = input.uid || `${icsStamp(input.startTime)}-aria@lumenosis`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lumenosis//Aria//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(input.startTime)}`,
    `DTSTART:${icsStamp(input.startTime)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${input.title}`,
    input.address ? `LOCATION:${input.address}` : "",
    input.description ? `DESCRIPTION:${input.description}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export async function scheduleShowing(adapter: CrmAdapter, input: ScheduleShowingInput): Promise<ShowingResult> {
  const contact = await adapter.upsertContact({
    phone: input.contact.phone,
    email: input.contact.email,
    fullName: input.contact.fullName,
  });
  const title = input.address ? `Showing — ${input.address}` : "Property showing";
  const appointment = await adapter.createAppointment({
    calendarId: input.calendarId,
    contactId: contact.id,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone: input.timezone,
    title,
    address: input.address,
    notes: input.notes,
  });
  return {
    appointment,
    contactId: contact.id,
    ics: buildIcsInvite({ title, startTime: input.startTime, endTime: input.endTime, address: input.address }),
    spoken: `You're booked for ${formatWhen(input.startTime, input.timezone)}${input.address ? ` at ${input.address}` : ""}. You'll get a calendar invite shortly.`,
  };
}

// Upcoming appointments for a contact, soonest first.
export function upcomingShowings(appointments: CrmAppointment[], nowMs = Date.now()): CrmAppointment[] {
  return appointments
    .filter((appt) => {
      const start = Date.parse(appt.startTime);
      const cancelled = (appt.status || "").toLowerCase() === "cancelled";
      return Number.isFinite(start) && start >= nowMs && !cancelled;
    })
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

async function resolveContactId(adapter: CrmAdapter, contact: ShowingContact): Promise<string | null> {
  if (contact.phone) {
    const byPhone = await adapter.findContactByPhone(contact.phone);
    if (byPhone) return byPhone.id;
  }
  if (contact.email) {
    const byEmail = await adapter.findContactByEmail(contact.email);
    if (byEmail) return byEmail.id;
  }
  return null;
}

export type ChangeShowingResult = {
  ok: boolean;
  appointment?: CrmAppointment;
  spoken: string;
};

// Cancel the caller's next upcoming showing (or a specific appointmentId).
export async function cancelShowing(
  adapter: CrmAdapter,
  input: { contact: ShowingContact; appointmentId?: string; nowMs?: number },
): Promise<ChangeShowingResult> {
  const contactId = await resolveContactId(adapter, input.contact);
  if (!contactId) {
    return { ok: false, spoken: "I couldn't find your record to pull up that appointment. Can you confirm the email or phone on the booking?" };
  }
  const appts = await adapter.listAppointments(contactId);
  const target = input.appointmentId
    ? appts.find((appt) => appt.id === input.appointmentId)
    : upcomingShowings(appts, input.nowMs)[0];
  if (!target) {
    return { ok: false, spoken: "I don't see an upcoming showing on your record to cancel." };
  }
  await adapter.cancelAppointment(target.id);
  return { ok: true, appointment: target, spoken: `Done — I've cancelled your showing on ${formatWhen(target.startTime)}.` };
}

// Move the caller's next upcoming showing to a new time.
export async function rescheduleShowing(
  adapter: CrmAdapter,
  input: { contact: ShowingContact; newStartTime: string; newEndTime?: string; timezone?: string; appointmentId?: string; nowMs?: number },
): Promise<ChangeShowingResult> {
  const contactId = await resolveContactId(adapter, input.contact);
  if (!contactId) {
    return { ok: false, spoken: "I couldn't find your record to reschedule. Can you confirm the email or phone on the booking?" };
  }
  const appts = await adapter.listAppointments(contactId);
  const target = input.appointmentId
    ? appts.find((appt) => appt.id === input.appointmentId)
    : upcomingShowings(appts, input.nowMs)[0];
  if (!target) {
    return { ok: false, spoken: "I don't see an upcoming showing on your record to move." };
  }
  const appointment = await adapter.updateAppointment(target.id, {
    startTime: input.newStartTime,
    endTime: input.newEndTime,
    timezone: input.timezone,
  });
  return { ok: true, appointment, spoken: `Got it — your showing is now ${formatWhen(input.newStartTime, input.timezone)}.` };
}
