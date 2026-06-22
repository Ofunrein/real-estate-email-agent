import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

import { clientId } from "@/lib/database";
import { addContactTimelineEvent, upsertContact, type ContactInput } from "@/lib/contactOs";

export type TimeRange = {
  start: string;
  end: string;
};

export type AvailabilitySlot = TimeRange & {
  durationMinutes: number;
};

export type CalendarConflict = {
  slot: TimeRange;
  busy: TimeRange;
};

export type CalendarRecord = {
  id: string;
  name: string;
  description: string;
  color: string;
  timezone: string;
  durationDefaultMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  maximumRangeDays: number;
  bookingLinkSlug: string;
  archived: boolean;
};

export type CalendarAppointmentInput = {
  id?: string;
  title?: string;
  description?: string;
  start: string;
  end?: string;
  timezone?: string;
  calendarId?: string;
  calendarGroupId?: string;
  assignedUserId?: string;
  contactId?: string;
  contact?: ContactInput;
  status?: string;
  source?: string;
  locationType?: string;
  locationValue?: string;
  propertyAddress?: string;
  notes?: string;
};

export type CalendarEventRecord = {
  id: string;
  title: string;
  description: string;
  contactId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  start: string;
  end: string;
  status: string;
  type: string;
  location: string;
  channel: string;
  source: string;
  provider: string;
  externalEventId: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  notes: string;
};

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
};

let poolInstance: Pool | null = null;

function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return poolInstance;
}

function durationMs(minutesValue: number): number {
  return minutesValue * 60 * 1000;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function startMs(range: TimeRange): number {
  return Date.parse(range.start);
}

function endMs(range: TimeRange): number {
  return Date.parse(range.end);
}

function isUsableRange(range: TimeRange): boolean {
  const start = startMs(range);
  const end = endMs(range);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function minutesBetween(start: string, end: string): number {
  if (!isUsableRange({ start, end })) return 30;
  return Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
}

function rowCalendar(row: QueryResultRow): CalendarRecord {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    description: String(row.description || ""),
    color: String(row.color || "#6366f1"),
    timezone: String(row.timezone || "America/Chicago"),
    durationDefaultMinutes: Number(row.duration_default_minutes || 30),
    slotIntervalMinutes: Number(row.slot_interval_minutes || 30),
    bufferBeforeMinutes: Number(row.buffer_before_minutes || 0),
    bufferAfterMinutes: Number(row.buffer_after_minutes || 0),
    minimumNoticeMinutes: Number(row.minimum_notice_minutes || 60),
    maximumRangeDays: Number(row.maximum_range_days || 30),
    bookingLinkSlug: String(row.booking_link_slug || ""),
    archived: Boolean(row.archived_at),
  };
}

function rowEvent(row: QueryResultRow): CalendarEventRecord {
  const start = new Date(String(row.scheduled_at)).toISOString();
  const duration = Number(row.duration_minutes || 30);
  const end = new Date(Date.parse(start) + durationMs(duration)).toISOString();
  return {
    id: String(row.id || ""),
    title: String(row.title || row.appointment_type || "Appointment"),
    description: String(row.description || row.notes || ""),
    contactId: String(row.contact_id || ""),
    contactName: String(row.contact_name || row.caller_name || ""),
    contactEmail: String(row.contact_email || row.caller_email || ""),
    contactPhone: String(row.contact_phone || row.caller_phone || ""),
    start,
    end,
    status: String(row.status || "scheduled"),
    type: String(row.appointment_type || "showing"),
    location: String(row.location_value || row.property_address || ""),
    channel: String(row.booked_via_channel || row.source || "manual"),
    source: String(row.source || row.booked_via_channel || "manual"),
    provider: String(row.provider || "mauro"),
    externalEventId: String(row.external_event_id || row.google_event_id || row.ghl_event_id || ""),
    calendarId: String(row.calendar_id || ""),
    calendarName: String(row.calendar_name || "Mauro"),
    calendarColor: String(row.calendar_color || "#6366f1"),
    notes: String(row.internal_notes || row.notes || ""),
  };
}

export function rangesOverlap(a: TimeRange, b: TimeRange, bufferMinutes = 0): boolean {
  if (!isUsableRange(a) || !isUsableRange(b)) return false;
  const buffer = durationMs(bufferMinutes);
  return startMs(a) < endMs(b) + buffer && endMs(a) > startMs(b) - buffer;
}

export function detectCalendarConflicts(
  slots: TimeRange[],
  busy: TimeRange[],
  bufferMinutes = 0,
): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];
  for (const slot of slots) {
    for (const block of busy) {
      if (rangesOverlap(slot, block, bufferMinutes)) conflicts.push({ slot, busy: block });
    }
  }
  return conflicts;
}

export function generateAvailabilitySlots(input: {
  windows: TimeRange[];
  busy?: TimeRange[];
  durationMinutes?: number;
  stepMinutes?: number;
  bufferMinutes?: number;
  minimumNoticeMinutes?: number;
  maximumRangeDays?: number;
  now?: string;
  limit?: number;
}): AvailabilitySlot[] {
  const durationMinutes = input.durationMinutes || 30;
  const stepMinutes = input.stepMinutes || durationMinutes;
  const bufferMinutes = input.bufferMinutes || 0;
  const limit = input.limit || 50;
  const busy = input.busy || [];
  const now = Date.parse(input.now || new Date().toISOString());
  const minStart = now + durationMs(input.minimumNoticeMinutes || 0);
  const maxStart = now + (input.maximumRangeDays || 365) * 24 * 60 * 60 * 1000;
  const slots: AvailabilitySlot[] = [];

  for (const window of input.windows) {
    if (!isUsableRange(window)) continue;
    for (
      let cursor = Math.max(startMs(window), minStart);
      cursor + durationMs(durationMinutes) <= endMs(window) && cursor <= maxStart;
      cursor += durationMs(stepMinutes)
    ) {
      const slot = { start: iso(cursor), end: iso(cursor + durationMs(durationMinutes)) };
      if (!detectCalendarConflicts([slot], busy, bufferMinutes).length) {
        slots.push({ ...slot, durationMinutes });
        if (slots.length >= limit) return slots;
      }
    }
  }

  return slots;
}

export async function ensureDefaultCalendar(db: Queryable = pool(), cid = clientId()): Promise<CalendarRecord> {
  const existing = await db.query(
    `select * from calendars where client_id = $1 and archived_at is null order by created_at asc limit 1`,
    [cid],
  );
  if (existing.rows[0]) return rowCalendar(existing.rows[0]);
  const created = await db.query(
    `insert into calendars (client_id, name, description, color, timezone, booking_link_slug)
     values ($1,'Iris Calendar','Default appointment calendar for Iris-led operations.','#6366f1','America/Chicago','iris')
     returning *`,
    [cid],
  );
  return rowCalendar(created.rows[0]);
}

export async function listCalendars(db: Queryable = pool(), cid = clientId()): Promise<CalendarRecord[]> {
  const result = await db.query(
    `select * from calendars where client_id = $1 order by archived_at nulls first, created_at asc`,
    [cid],
  );
  if (!result.rows.length) return [await ensureDefaultCalendar(db, cid)];
  return result.rows.map(rowCalendar);
}

export async function createCalendar(input: Partial<CalendarRecord>, db: Queryable = pool(), cid = clientId()): Promise<CalendarRecord> {
  const result = await db.query(
    `insert into calendars (
       client_id, name, description, color, timezone, duration_default_minutes,
       slot_interval_minutes, buffer_before_minutes, buffer_after_minutes,
       minimum_notice_minutes, maximum_range_days, booking_link_slug
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning *`,
    [
      cid,
      input.name || "New calendar",
      input.description || "",
      input.color || "#6366f1",
      input.timezone || "America/Chicago",
      input.durationDefaultMinutes || 30,
      input.slotIntervalMinutes || 30,
      input.bufferBeforeMinutes || 0,
      input.bufferAfterMinutes || 0,
      input.minimumNoticeMinutes || 60,
      input.maximumRangeDays || 30,
      input.bookingLinkSlug || "",
    ],
  );
  return rowCalendar(result.rows[0]);
}

export async function updateCalendar(
  calendarId: string,
  input: Partial<CalendarRecord>,
  db: Queryable = pool(),
  cid = clientId(),
): Promise<CalendarRecord | null> {
  const result = await db.query(
    `update calendars
        set name = coalesce($3, name),
            description = coalesce($4, description),
            color = coalesce($5, color),
            timezone = coalesce($6, timezone),
            duration_default_minutes = coalesce($7, duration_default_minutes),
            slot_interval_minutes = coalesce($8, slot_interval_minutes),
            buffer_before_minutes = coalesce($9, buffer_before_minutes),
            buffer_after_minutes = coalesce($10, buffer_after_minutes),
            minimum_notice_minutes = coalesce($11, minimum_notice_minutes),
            maximum_range_days = coalesce($12, maximum_range_days),
            booking_link_slug = coalesce($13, booking_link_slug),
            updated_at = now()
      where client_id = $1 and id = $2
      returning *`,
    [
      cid,
      calendarId,
      input.name ?? null,
      input.description ?? null,
      input.color ?? null,
      input.timezone ?? null,
      input.durationDefaultMinutes ?? null,
      input.slotIntervalMinutes ?? null,
      input.bufferBeforeMinutes ?? null,
      input.bufferAfterMinutes ?? null,
      input.minimumNoticeMinutes ?? null,
      input.maximumRangeDays ?? null,
      input.bookingLinkSlug ?? null,
    ],
  );
  return result.rows[0] ? rowCalendar(result.rows[0]) : null;
}

export async function archiveCalendar(calendarId: string, db: Queryable = pool(), cid = clientId()): Promise<boolean> {
  const result = await db.query(
    `update calendars set archived_at = now(), updated_at = now() where client_id = $1 and id = $2 and archived_at is null`,
    [cid, calendarId],
  );
  return (result.rowCount || 0) > 0;
}

export async function listCalendarEvents(input: {
  from?: string;
  to?: string;
  calendarId?: string;
  contactId?: string;
  limit?: number;
} = {}, db: Queryable = pool(), cid = clientId()): Promise<CalendarEventRecord[]> {
  const from = input.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = input.to || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.query(
    `select a.*,
            c.full_name as contact_name,
            ce.email as contact_email,
            cp.phone as contact_phone,
            cal.name as calendar_name,
            cal.color as calendar_color,
            ref.provider,
            ref.external_event_id
       from appointments a
       left join contacts c on c.client_id = a.client_id and c.id = a.contact_id
       left join lateral (
         select email from contact_emails where client_id = a.client_id and contact_id = a.contact_id order by is_primary desc limit 1
       ) ce on true
       left join lateral (
         select phone from contact_phones where client_id = a.client_id and contact_id = a.contact_id order by is_primary desc limit 1
       ) cp on true
       left join calendars cal on cal.client_id = a.client_id and cal.id = a.calendar_id
       left join lateral (
         select provider, external_event_id
           from appointment_external_refs
          where client_id = a.client_id and appointment_id = a.id
          order by last_synced_at desc nulls last
          limit 1
       ) ref on true
      where a.client_id = $1
        and a.scheduled_at < $3::timestamptz
        and (a.scheduled_at + (a.duration_minutes || ' minutes')::interval) > $2::timestamptz
        and ($4 = '' or a.calendar_id::text = $4)
        and ($5 = '' or a.contact_id::text = $5)
      order by a.scheduled_at asc
      limit $6`,
    [cid, from, to, input.calendarId || "", input.contactId || "", Math.min(Math.max(input.limit || 200, 1), 500)],
  );
  return result.rows.map(rowEvent);
}

export async function listBusyRanges(
  range: TimeRange,
  db: Queryable = pool(),
  cid = clientId(),
): Promise<TimeRange[]> {
  const result = await db.query<{ start: string; end: string }>(
    `select scheduled_at::text as start,
            (scheduled_at + (duration_minutes || ' minutes')::interval)::text as end
       from appointments
      where client_id = $1
        and status not in ('cancelled', 'canceled', 'deleted')
        and scheduled_at < $3::timestamptz
        and (scheduled_at + (duration_minutes || ' minutes')::interval) > $2::timestamptz
     union all
     select start_at::text as start, end_at::text as end
       from booking_holds
      where client_id = $1
        and status = 'held'
        and expires_at > now()
        and start_at < $3::timestamptz
        and end_at > $2::timestamptz
      order by start asc`,
    [cid, range.start, range.end],
  );
  return result.rows;
}

export async function findCalendarConflicts(
  slot: TimeRange,
  db: Queryable = pool(),
  cid = clientId(),
  bufferMinutes = 0,
): Promise<TimeRange[]> {
  const expanded = {
    start: iso(startMs(slot) - durationMs(bufferMinutes)),
    end: iso(endMs(slot) + durationMs(bufferMinutes)),
  };
  const busy = await listBusyRanges(expanded, db, cid);
  return busy.filter((block) => rangesOverlap(slot, block, bufferMinutes));
}

export async function createCalendarAppointment(
  input: CalendarAppointmentInput,
  db: Queryable = pool(),
  cid = clientId(),
): Promise<CalendarEventRecord> {
  if (!isUsableRange({ start: input.start, end: input.end || iso(Date.parse(input.start) + durationMs(30)) })) {
    throw new Error("Appointment requires a valid start and end");
  }
  const calendar = input.calendarId ? null : await ensureDefaultCalendar(db, cid);
  const calendarId = input.calendarId || calendar?.id || "";
  const end = input.end || iso(Date.parse(input.start) + durationMs(calendar?.durationDefaultMinutes || 30));
  const contact = input.contactId
    ? null
    : input.contact
      ? await upsertContact(input.contact)
      : null;
  const contactId = input.contactId || contact?.id || "";
  const conflicts = await findCalendarConflicts(
    { start: input.start, end },
    db,
    cid,
    calendar?.bufferBeforeMinutes || calendar?.bufferAfterMinutes || 0,
  );
  if (conflicts.length) throw new Error("Appointment conflicts with existing busy time");

  const result = await db.query(
    `insert into appointments (
       client_id, caller_phone, caller_name, caller_email, appointment_type, property_address,
       scheduled_at, scheduled_at_local, duration_minutes, status, booked_via_channel,
       notes, title, description, timezone, calendar_id, calendar_group_id, contact_id,
       assigned_user_id, source, location_type, location_value, internal_notes
     ) values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$16::uuid,$17::uuid,$18::uuid,$19,$20,$21,$22,$23)
     returning *`,
    [
      cid,
      input.contact?.phones?.[0] || "",
      input.contact?.fullName || "",
      input.contact?.emails?.[0] || "",
      input.title || input.description || "showing",
      input.propertyAddress || input.locationValue || "",
      input.start,
      input.start,
      minutesBetween(input.start, end),
      input.status || "confirmed",
      input.source || "manual",
      input.notes || "",
      input.title || "Appointment",
      input.description || "",
      input.timezone || calendar?.timezone || "America/Chicago",
      calendarId || null,
      input.calendarGroupId || null,
      contactId || null,
      input.assignedUserId || "",
      input.source || "manual",
      input.locationType || "phone",
      input.locationValue || input.propertyAddress || "",
      input.notes || "",
    ],
  );
  const appointmentId = String(result.rows[0].id);
  if (contactId) {
    await db.query(
      `insert into appointment_contacts (client_id, appointment_id, contact_id)
       values ($1,$2,$3)
       on conflict (client_id, appointment_id, contact_id) do nothing`,
      [cid, appointmentId, contactId],
    );
    await addContactTimelineEvent(contactId, {
      eventType: "appointment_created",
      title: input.title || "Appointment created",
      body: input.start,
      source: input.source || "manual",
      sourceId: appointmentId,
    });
  }
  const rows = await listCalendarEvents({ from: input.start, to: end, limit: 1 }, db, cid);
  return rows.find((event) => event.id === appointmentId) || rowEvent(result.rows[0]);
}

export async function updateCalendarAppointment(
  id: string,
  input: Partial<CalendarAppointmentInput>,
  db: Queryable = pool(),
  cid = clientId(),
): Promise<CalendarEventRecord | null> {
  const result = await db.query(
    `update appointments
        set title = coalesce($3, title),
            description = coalesce($4, description),
            scheduled_at = coalesce($5::timestamptz, scheduled_at),
            duration_minutes = coalesce($6, duration_minutes),
            status = coalesce($7, status),
            location_type = coalesce($8, location_type),
            location_value = coalesce($9, location_value),
            internal_notes = coalesce($10, internal_notes),
            notes = coalesce($10, notes),
            updated_at = now()
      where client_id = $1 and id = $2
      returning *`,
    [
      cid,
      id,
      input.title ?? null,
      input.description ?? null,
      input.start ?? null,
      input.start && input.end ? minutesBetween(input.start, input.end) : null,
      input.status ?? null,
      input.locationType ?? null,
      input.locationValue ?? null,
      input.notes ?? null,
    ],
  );
  if (!result.rows[0]) return null;
  const event = rowEvent(result.rows[0]);
  if (event.contactId) {
    await addContactTimelineEvent(event.contactId, {
      eventType: "appointment_updated",
      title: event.title || "Appointment updated",
      body: event.start,
      source: input.source || "manual",
      sourceId: event.id,
    });
  }
  return event;
}

export async function cancelCalendarAppointment(id: string, db: Queryable = pool(), cid = clientId()): Promise<boolean> {
  const result = await db.query(
    `update appointments set status = 'cancelled', updated_at = now() where client_id = $1 and id = $2`,
    [cid, id],
  );
  return (result.rowCount || 0) > 0;
}

export async function queryAvailability(input: {
  calendarId?: string;
  from: string;
  to: string;
  durationMinutes?: number;
  timezone?: string;
  limit?: number;
}, db: Queryable = pool(), cid = clientId()): Promise<AvailabilitySlot[]> {
  const calendar = input.calendarId
    ? (await db.query(`select * from calendars where client_id = $1 and id = $2 and archived_at is null`, [cid, input.calendarId])).rows[0]
    : null;
  const settings = calendar ? rowCalendar(calendar) : await ensureDefaultCalendar(db, cid);
  const busy = await listBusyRanges({ start: input.from, end: input.to }, db, cid);
  return generateAvailabilitySlots({
    windows: [{ start: input.from, end: input.to }],
    busy,
    durationMinutes: input.durationMinutes || settings.durationDefaultMinutes,
    stepMinutes: settings.slotIntervalMinutes,
    bufferMinutes: Math.max(settings.bufferBeforeMinutes, settings.bufferAfterMinutes),
    minimumNoticeMinutes: settings.minimumNoticeMinutes,
    maximumRangeDays: settings.maximumRangeDays,
    limit: input.limit || 50,
  });
}
