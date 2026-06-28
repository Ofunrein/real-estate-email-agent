// Outlook Calendar adapter — implements CalendarProvider via Microsoft Graph API.
// Auth: OUTLOOK_CLIENT_ID + OUTLOOK_CLIENT_SECRET + OUTLOOK_TENANT_ID + OUTLOOK_REFRESH_TOKEN.
// Calendar: OUTLOOK_CALENDAR_ID (defaults to primary calendar).
//
// Status: interface-complete. OAuth refresh flow requires initial token exchange.
// Run: node scripts/setup-outlook-auth.mjs to get the refresh token.

import type {
  AvailabilityInput,
  AvailabilitySlot,
  BookingInput,
  BookingResult,
  CalendarProvider,
  CancelResult,
  RescheduleResult,
} from "@/lib/calendar/types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getAccessToken(): Promise<string> {
  const tenantId = process.env.OUTLOOK_TENANT_ID || "";
  const clientId = process.env.OUTLOOK_CLIENT_ID || "";
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || "";
  const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN || "";

  if (!tenantId || !clientId || !clientSecret || !refreshToken) {
    throw new Error("Outlook not configured: set OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN");
  }

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "Calendars.ReadWrite offline_access",
    }),
  });

  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new Error(`Outlook token refresh failed: ${data.error_description || "unknown"}`);
  return data.access_token;
}

async function graphRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Graph ${options.method || "GET"} ${path} failed (${response.status}): ${err}`);
  }
  if (response.status === 204) return {};
  return response.json();
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
    const overlaps = busyRanges.some((b) => cursor < Date.parse(b.end) && slotEnd > Date.parse(b.start));
    if (!overlaps) {
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString(), durationMinutes });
      if (slots.length >= limit) break;
    }
  }
  return slots;
}

export function createOutlookCalendarAdapter(): CalendarProvider {
  const calendarId = process.env.OUTLOOK_CALENDAR_ID || "";  // empty = primary
  const durationMinutes = Number(process.env.OUTLOOK_CALENDAR_SLOT_DURATION || "30");
  const stepMinutes = Number(process.env.OUTLOOK_CALENDAR_SLOT_STEP || "30");
  const minimumNoticeMs = durationMs(Number(process.env.OUTLOOK_CALENDAR_MINIMUM_NOTICE_MINUTES || "60"));

  const calPath = calendarId ? `/me/calendars/${calendarId}` : "/me/calendar";

  return {
    async queryAvailability(input: AvailabilityInput): Promise<AvailabilitySlot[]> {
      const dur = input.durationMinutes || durationMinutes;
      const lim = input.limit || 10;

      const data = await graphRequest("/me/calendarView?" + new URLSearchParams({
        startDateTime: input.from,
        endDateTime: input.to,
        $select: "start,end,showAs",
      })) as { value?: Array<{ start: { dateTime: string }; end: { dateTime: string }; showAs: string }> };

      const busy = (data.value || [])
        .filter((e) => e.showAs !== "free" && e.showAs !== "workingElsewhere")
        .map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }));

      return generateSlots(input.from, input.to, busy, dur, stepMinutes, minimumNoticeMs, lim);
    },

    async bookAppointment(input: BookingInput): Promise<BookingResult> {
      const body: Record<string, unknown> = {
        subject: input.title,
        body: { contentType: "Text", content: [input.description, input.propertyAddress ? `Property: ${input.propertyAddress}` : "", "Booked via Lumenosis Iris"].filter(Boolean).join("\n") },
        start: { dateTime: input.start, timeZone: input.timezone },
        end: { dateTime: input.end, timeZone: input.timezone },
        isOnlineMeeting: false,
      };
      if (input.attendeeEmail) {
        body.attendees = [{ emailAddress: { address: input.attendeeEmail, name: input.attendeeName || "" }, type: "required" }];
      }

      const event = await graphRequest(`${calPath}/events`, { method: "POST", body: JSON.stringify(body) }) as { id?: string; webLink?: string; start?: { dateTime?: string }; end?: { dateTime?: string } };
      return { success: true, eventId: event.id || "", htmlLink: event.webLink || "", confirmedStart: event.start?.dateTime || input.start, confirmedEnd: event.end?.dateTime || input.end };
    },

    async cancelEvent(eventId: string): Promise<CancelResult> {
      await graphRequest(`${calPath}/events/${eventId}`, { method: "DELETE" });
      return { success: true };
    },

    async rescheduleEvent(eventId: string, newStart: string, newEnd: string): Promise<RescheduleResult> {
      const timezone = process.env.CALENDAR_TIMEZONE || "America/Chicago";
      const updated = await graphRequest(`${calPath}/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ start: { dateTime: newStart, timeZone: timezone }, end: { dateTime: newEnd, timeZone: timezone } }),
      }) as { start?: { dateTime?: string }; end?: { dateTime?: string } };
      return { success: true, confirmedStart: updated.start?.dateTime || newStart, confirmedEnd: updated.end?.dateTime || newEnd };
    },
  };
}

export function isOutlookConfigured(): boolean {
  return Boolean(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET && process.env.OUTLOOK_TENANT_ID && process.env.OUTLOOK_REFRESH_TOKEN);
}
