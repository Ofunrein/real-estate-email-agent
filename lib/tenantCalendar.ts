import { createHash } from "node:crypto";

import { Pool } from "pg";

import { createComposioGoogleCalendarProvider, createComposioOutlookCalendarProvider } from "@/integrations/composio/calendar-provider";
import type { CalendarEvent, CalendarProvider as ExternalCalendarProvider } from "@/integrations/calendar-provider.interface";
import { activeCalendarProviderName, resolveCalendarProvider } from "@/lib/calendar/resolver";
import type { AvailabilitySlot, BookingInput, BookingResult } from "@/lib/calendar/types";
import { generateAvailabilitySlots, listBusyRanges, type TimeRange } from "@/lib/calendarOs";
import { clientId } from "@/lib/database";
import { listProviderConnections, type ProviderConnectionRecord } from "@/lib/providerConnections";

export type TenantCalendarConnectionStatus = {
  connected: boolean;
  provider: "google" | "outlook" | "legacy_env" | "none";
  accountEmail: string;
  connectionId: string;
  lastSyncAt: string | null;
  lastError: string;
};

export type TenantAvailabilityResult = {
  ok: boolean;
  slots: AvailabilitySlot[];
  provider: string;
  reason?: "not_connected" | "provider_unavailable" | "invalid_window";
  error?: string;
};

type TenantConnection = {
  row: ProviderConnectionRecord;
  provider: ExternalCalendarProvider;
};

type AvailabilityInput = {
  calendarId?: string;
  from: string;
  to: string;
  durationMinutes?: number;
  timezone?: string;
  limit?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
let poolInstance: Pool | null = null;

function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
    });
  }
  return poolInstance;
}

function externalProvider(row: ProviderConnectionRecord): ExternalCalendarProvider | null {
  const input = {
    userEmail: row.email || row.user_id,
    connectedAccountId: row.composio_connected_account_id,
  };
  if (row.provider === "composio_google_calendar") return createComposioGoogleCalendarProvider(input);
  if (row.provider === "composio_outlook_calendar") return createComposioOutlookCalendarProvider(input);
  return null;
}

async function connectedCalendar(): Promise<TenantConnection | null> {
  if (!process.env.DATABASE_URL || !process.env.COMPOSIO_API_KEY) return null;
  const rows = await listProviderConnections({ domain: "calendar", onlyConnected: true });
  for (const row of rows) {
    if (!row.composio_connected_account_id) continue;
    const provider = externalProvider(row);
    if (provider) return { row, provider };
  }
  return null;
}

function legacyCalendarConfigured(): boolean {
  return activeCalendarProviderName() !== "neon";
}

export async function tenantCalendarConnectionStatus(): Promise<TenantCalendarConnectionStatus> {
  const connection = await connectedCalendar().catch(() => null);
  if (connection) {
    return {
      connected: true,
      provider: connection.row.provider.includes("outlook") ? "outlook" : "google",
      accountEmail: connection.row.email,
      connectionId: connection.row.id,
      lastSyncAt: connection.row.last_sync_at,
      lastError: connection.row.last_error,
    };
  }
  if (legacyCalendarConfigured()) {
    return { connected: true, provider: "legacy_env", accountEmail: "", connectionId: "", lastSyncAt: null, lastError: "" };
  }
  return { connected: false, provider: "none", accountEmail: "", connectionId: "", lastSyncAt: null, lastError: "" };
}

function eventRange(event: CalendarEvent): TimeRange | null {
  const start = Date.parse(event.startTime);
  const end = Date.parse(event.endTime || "");
  if (!Number.isFinite(start)) return null;
  return {
    start: new Date(start).toISOString(),
    end: new Date(Number.isFinite(end) && end > start ? end : start + 30 * 60_000).toISOString(),
  };
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function timeZoneOffsetMs(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - date.getTime();
}

function zonedHourToIso(date: string, hour: number, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  let instant = guess - timeZoneOffsetMs(new Date(guess), timezone);
  instant = guess - timeZoneOffsetMs(new Date(instant), timezone);
  return new Date(instant).toISOString();
}

function localDateAt(instant: Date, timezone: string): { date: string; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: weekdays[parts.weekday] };
}

export function tenantBusinessWindows(from: string, to: string, timezone: string): TimeRange[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  const startHour = integerEnv("CALENDAR_BUSINESS_START_HOUR", 9, 0, 23);
  const endHour = integerEnv("CALENDAR_BUSINESS_END_HOUR", 18, 1, 24);
  const allowedDays = new Set((process.env.CALENDAR_BUSINESS_DAYS || "1,2,3,4,5,6")
    .split(",").map((value) => Number(value.trim())).filter((value) => value >= 0 && value <= 6));
  const windows: TimeRange[] = [];
  const seen = new Set<string>();
  for (let cursor = fromMs - DAY_MS; cursor <= toMs + DAY_MS && windows.length < 370; cursor += DAY_MS) {
    const local = localDateAt(new Date(cursor), timezone);
    if (seen.has(local.date) || !allowedDays.has(local.weekday)) continue;
    seen.add(local.date);
    const start = Math.max(fromMs, Date.parse(zonedHourToIso(local.date, startHour, timezone)));
    const end = Math.min(toMs, Date.parse(zonedHourToIso(local.date, endHour, timezone)));
    if (end > start) windows.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  }
  return windows.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

export function availabilitySlotsFromEvents(
  input: AvailabilityInput,
  events: CalendarEvent[],
  internalBusy: TimeRange[] = [],
): AvailabilitySlot[] {
  const bufferBeforeMs = integerEnv("CALENDAR_BUFFER_BEFORE_MINUTES", 15, 0, 240) * 60_000;
  const bufferAfterMs = integerEnv("CALENDAR_BUFFER_AFTER_MINUTES", 15, 0, 240) * 60_000;
  const busy = [
    ...events
    .filter((event) => !["cancelled", "free"].includes(String(event.status || "").toLowerCase()))
    .map(eventRange)
    .filter((range): range is TimeRange => Boolean(range)),
    ...internalBusy,
  ]
    .map((range) => ({
      start: new Date(Date.parse(range.start) - bufferBeforeMs).toISOString(),
      end: new Date(Date.parse(range.end) + bufferAfterMs).toISOString(),
    }));
  return generateAvailabilitySlots({
    windows: tenantBusinessWindows(input.from, input.to, input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago"),
    busy,
    durationMinutes: input.durationMinutes || integerEnv("CALENDAR_SLOT_DURATION_MINUTES", 30, 5, 480),
    stepMinutes: integerEnv("CALENDAR_SLOT_STEP_MINUTES", 30, 5, 480),
    bufferMinutes: 0,
    minimumNoticeMinutes: integerEnv("CALENDAR_MINIMUM_NOTICE_MINUTES", 60, 0, 43_200),
    maximumRangeDays: integerEnv("CALENDAR_MAXIMUM_RANGE_DAYS", 30, 1, 365),
    limit: input.limit || 20,
  });
}

async function listAllEvents(provider: ExternalCalendarProvider, input: AvailabilityInput): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const result = await provider.listEvents({
      calendarId: input.calendarId,
      timeMin: input.from,
      timeMax: input.to,
      pageToken: pageToken || undefined,
      limit: 100,
    });
    events.push(...result.events);
    pageToken = result.nextPageToken || "";
    if (!pageToken) break;
  }
  return events;
}

export async function queryTenantAvailability(input: AvailabilityInput): Promise<TenantAvailabilityResult> {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return { ok: false, slots: [], provider: "none", reason: "invalid_window" };
  }
  if (toMs - fromMs > integerEnv("CALENDAR_MAX_QUERY_DAYS", 31, 1, 120) * DAY_MS) {
    return { ok: false, slots: [], provider: "none", reason: "invalid_window" };
  }

  const connection = await connectedCalendar().catch(() => null);
  if (connection) {
    try {
      const events = await listAllEvents(connection.provider, input);
      const internalBusy = await listBusyRanges({ start: input.from, end: input.to });
      const slots = availabilitySlotsFromEvents(input, events, internalBusy);
      return { ok: true, slots, provider: connection.row.provider };
    } catch (error) {
      return { ok: false, slots: [], provider: connection.row.provider, reason: "provider_unavailable", error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (legacyCalendarConfigured()) {
    try {
      const slots = await resolveCalendarProvider().queryAvailability(input);
      return { ok: true, slots, provider: activeCalendarProviderName() };
    } catch (error) {
      return { ok: false, slots: [], provider: activeCalendarProviderName(), reason: "provider_unavailable", error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, slots: [], provider: "none", reason: "not_connected" };
}

export async function requestedSlotIsAvailable(input: { start: string; end: string; timezone?: string }): Promise<TenantAvailabilityResult & { available: boolean }> {
  const result = await queryTenantAvailability({
    from: input.start,
    to: input.end,
    durationMinutes: Math.max(1, Math.round((Date.parse(input.end) - Date.parse(input.start)) / 60_000)),
    timezone: input.timezone,
    limit: 1,
  });
  const requestedStart = Date.parse(input.start);
  const available = result.ok && result.slots.some((slot) => Date.parse(slot.start) === requestedStart && Date.parse(slot.end) >= Date.parse(input.end));
  return { ...result, available };
}

async function createTenantCalendarEvent(input: BookingInput): Promise<BookingResult> {
  const availability = await requestedSlotIsAvailable({ start: input.start, end: input.end, timezone: input.timezone });
  if (!availability.ok) return { success: false, error: availability.reason === "not_connected" ? "Calendar is not connected" : "Calendar availability could not be verified" };
  if (!availability.available) return { success: false, error: "Requested time is no longer available" };

  const connection = await connectedCalendar().catch(() => null);
  if (connection) {
    try {
      const event = await connection.provider.createEvent({
        calendarId: input.calendarId,
        title: input.title,
        description: input.description,
        location: input.propertyAddress,
        startTime: input.start,
        endTime: input.end,
        timezone: input.timezone,
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail, name: input.attendeeName }] : [],
        idempotencyKey: createHash("sha256")
          .update(`${clientId()}:${input.start}:${input.end}:${input.attendeeEmail || input.attendeePhone || input.title}`)
          .digest("hex"),
      });
      return { success: true, eventId: event.id, htmlLink: event.htmlLink, confirmedStart: event.startTime, confirmedEnd: event.endTime || input.end };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return resolveCalendarProvider().bookAppointment(input);
}

export async function bookTenantCalendarEvent(input: BookingInput): Promise<BookingResult> {
  if (!process.env.DATABASE_URL) return createTenantCalendarEvent(input);
  const connection = await pool().connect();
  try {
    await connection.query("begin");
    await connection.query("select pg_advisory_xact_lock(hashtext($1))", [`calendar:${clientId()}`]);
    const result = await createTenantCalendarEvent(input);
    await connection.query(result.success ? "commit" : "rollback");
    return result;
  } catch (error) {
    await connection.query("rollback").catch(() => undefined);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection.release();
  }
}
