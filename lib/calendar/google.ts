// Google Calendar adapter — implements CalendarProvider via Google Calendar API.
// Auth: service account JSON (GOOGLE_SERVICE_ACCOUNT_JSON env, base64 or raw JSON string)
//       OR OAuth credentials (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN).
// Calendar: GOOGLE_CALENDAR_ID (defaults to "primary").
//
// queryAvailability uses freebusy API to find busy ranges, then generates open slots.
// bookAppointment creates a Calendar event and returns the event ID + HTML link.

import { google, type calendar_v3 } from "googleapis";
import type { GoogleAuthOptions } from "google-auth-library";
import type {
  AvailabilityInput,
  AvailabilitySlot,
  BookingInput,
  BookingResult,
  CalendarProvider,
  CancelResult,
  RescheduleResult,
} from "@/lib/calendar/types";

function parseServiceAccountJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    // Try raw JSON first
    return JSON.parse(trimmed);
  } catch {
    try {
      // Try base64-encoded JSON
      return JSON.parse(Buffer.from(trimmed, "base64").toString("utf-8"));
    } catch {
      return null;
    }
  }
}

function buildAuth() {
  const serviceAccountRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (serviceAccountRaw) {
    const creds = parseServiceAccountJson(serviceAccountRaw);
    if (creds) {
      return new google.auth.GoogleAuth({
        credentials: creds as GoogleAuthOptions["credentials"],
        scopes: ["https://www.googleapis.com/auth/calendar"],
      });
    }
  }

  // OAuth fallback
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || "";
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  return null;
}

function durationMs(minutes: number): number {
  return minutes * 60 * 1000;
}

function generateSlots(
  from: string,
  to: string,
  busyRanges: Array<{ start: string; end: string }>,
  durationMinutes: number,
  stepMinutes: number,
  minimumNoticeMs: number,
  limit: number,
): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  const minStart = Date.now() + minimumNoticeMs;
  const fromMs = Math.max(Date.parse(from), minStart);
  const toMs = Date.parse(to);
  const durMs = durationMs(durationMinutes);
  const stepMs = durationMs(stepMinutes);

  for (let cursor = fromMs; cursor + durMs <= toMs; cursor += stepMs) {
    const slotEnd = cursor + durMs;
    const overlaps = busyRanges.some((b) => {
      const bStart = Date.parse(b.start);
      const bEnd = Date.parse(b.end);
      return cursor < bEnd && slotEnd > bStart;
    });
    if (!overlaps) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(slotEnd).toISOString(),
        durationMinutes,
      });
      if (slots.length >= limit) break;
    }
  }

  return slots;
}

export function createGoogleCalendarAdapter(): CalendarProvider {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const durationMinutes = Number(process.env.GOOGLE_CALENDAR_SLOT_DURATION || "30");
  const stepMinutes = Number(process.env.GOOGLE_CALENDAR_SLOT_STEP || "30");
  // Require 60 min notice before a slot can be booked
  const minimumNoticeMs = durationMs(Number(process.env.GOOGLE_CALENDAR_MINIMUM_NOTICE_MINUTES || "60"));

  function getCalendar(): calendar_v3.Calendar | null {
    const auth = buildAuth();
    if (!auth) return null;
    return google.calendar({ version: "v3", auth });
  }

  return {
    async queryAvailability(input: AvailabilityInput): Promise<AvailabilitySlot[]> {
      const cal = getCalendar();
      if (!cal) return [];

      const targetCalendar = input.calendarId || calendarId;
      const dur = input.durationMinutes || durationMinutes;
      const lim = input.limit || 10;

      const freeBusy = await cal.freebusy.query({
        requestBody: {
          timeMin: input.from,
          timeMax: input.to,
          items: [{ id: targetCalendar }],
        },
      });

      const busy = (freeBusy.data.calendars?.[targetCalendar]?.busy || []).map((b) => ({
        start: b.start || "",
        end: b.end || "",
      }));

      return generateSlots(input.from, input.to, busy, dur, stepMinutes, minimumNoticeMs, lim);
    },

    async bookAppointment(input: BookingInput): Promise<BookingResult> {
      const cal = getCalendar();
      if (!cal) return { success: false, error: "Google Calendar not configured" };

      const targetCalendar = input.calendarId || calendarId;
      const attendees: calendar_v3.Schema$EventAttendee[] = [];
      if (input.attendeeEmail) {
        attendees.push({ email: input.attendeeEmail, displayName: input.attendeeName });
      }

      const descriptionParts = [
        input.description || "",
        input.propertyAddress ? `Property: ${input.propertyAddress}` : "",
        input.attendeePhone ? `Phone: ${input.attendeePhone}` : "",
        "Booked via Lumenosis Iris voice agent",
      ].filter(Boolean);

      const event = await cal.events.insert({
        calendarId: targetCalendar,
        sendUpdates: input.attendeeEmail ? "all" : "none",
        requestBody: {
          summary: input.title,
          description: descriptionParts.join("\n"),
          start: { dateTime: input.start, timeZone: input.timezone },
          end: { dateTime: input.end, timeZone: input.timezone },
          attendees,
          status: "confirmed",
        },
      });

      return {
        success: true,
        eventId: event.data.id || "",
        htmlLink: event.data.htmlLink || "",
        confirmedStart: event.data.start?.dateTime || input.start,
        confirmedEnd: event.data.end?.dateTime || input.end,
      };
    },

    async cancelEvent(eventId: string, overrideCalendarId?: string): Promise<CancelResult> {
      const cal = getCalendar();
      if (!cal) return { success: false, error: "Google Calendar not configured" };
      await cal.events.delete({ calendarId: overrideCalendarId || calendarId, eventId, sendUpdates: "all" });
      return { success: true };
    },

    async rescheduleEvent(eventId: string, newStart: string, newEnd: string, overrideCalendarId?: string): Promise<RescheduleResult> {
      const cal = getCalendar();
      if (!cal) return { success: false, error: "Google Calendar not configured" };

      const targetCalendar = overrideCalendarId || calendarId;
      const existing = await cal.events.get({ calendarId: targetCalendar, eventId });
      const timezone = existing.data.start?.timeZone || "America/Chicago";

      const updated = await cal.events.patch({
        calendarId: targetCalendar,
        eventId,
        sendUpdates: "all",
        requestBody: {
          start: { dateTime: newStart, timeZone: timezone },
          end: { dateTime: newEnd, timeZone: timezone },
        },
      });

      return {
        success: true,
        confirmedStart: updated.data.start?.dateTime || newStart,
        confirmedEnd: updated.data.end?.dateTime || newEnd,
      };
    },
  };
}

/** True if Google Calendar is configured in env. */
export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN),
  );
}
