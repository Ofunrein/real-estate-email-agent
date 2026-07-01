import { Pool } from "pg";

import { createComposioGoogleCalendarProvider, createComposioOutlookCalendarProvider } from "@/integrations/composio/calendar-provider";
import { createComposioGoogleContactsProvider, createComposioOutlookContactsProvider } from "@/integrations/composio/contacts-provider";
import type { CalendarEvent, CalendarProvider, CalendarSource } from "@/integrations/calendar-provider.interface";
import type { ContactRecord as ExternalContact, ContactsProvider } from "@/integrations/contacts-provider.interface";
import { clientId } from "@/lib/database";
import { upsertContact } from "@/lib/contactOs";
import {
  listProviderConnections,
  providerName,
  reconcileComposioProviderConnections,
  type ExternalProvider,
  type ProviderConnectionRecord,
  type ProviderDomain,
} from "@/lib/providerConnections";

type SyncKind = "full" | "incremental";

export type SyncSummary = {
  domain: ProviderDomain;
  syncType: SyncKind;
  providers: string[];
  connections: number;
  itemsRead: number;
  itemsWritten: number;
  errors: string[];
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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function eventEnd(event: CalendarEvent): string {
  if (event.endTime) return event.endTime;
  const start = Date.parse(event.startTime);
  return Number.isFinite(start) ? new Date(start + 30 * 60 * 1000).toISOString() : new Date().toISOString();
}

function durationMinutes(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 30;
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

function calendarProvider(connection: ProviderConnectionRecord): CalendarProvider | null {
  const input = { userEmail: connection.email || connection.user_id, connectedAccountId: connection.composio_connected_account_id };
  if (connection.provider === "composio_google_calendar") return createComposioGoogleCalendarProvider(input);
  if (connection.provider === "composio_outlook_calendar") return createComposioOutlookCalendarProvider(input);
  return null;
}

function contactsProvider(connection: ProviderConnectionRecord): ContactsProvider | null {
  const input = { userEmail: connection.email || connection.user_id, connectedAccountId: connection.composio_connected_account_id };
  if (connection.provider === "composio_google_contacts") return createComposioGoogleContactsProvider(input);
  if (connection.provider === "composio_outlook_contacts") return createComposioOutlookContactsProvider(input);
  return null;
}

function defaultCalendarSource(connection: ProviderConnectionRecord): CalendarSource {
  return {
    id: "primary",
    name: connection.display_name || connection.email || `${connection.provider} primary`,
    primary: true,
  };
}

async function ensureCalendarAccount(connection: ProviderConnectionRecord) {
  const existing = await pool().query(
    `select *
       from calendar_accounts
      where client_id = $1
        and connection_id = $2
        and provider = $3
        and provider_account_id = $4
      limit 1`,
    [clientId(), connection.id, connection.provider, connection.composio_connected_account_id],
  );
  if (existing.rows[0]) {
    const updated = await pool().query(
      `update calendar_accounts
          set display_name = $3,
              email = $4,
              status = 'active',
              metadata = metadata || $5::jsonb,
              updated_at = now()
        where client_id = $1 and id = $2
        returning *`,
      [
        clientId(),
        existing.rows[0].id,
        connection.display_name || connection.email || connection.provider,
        connection.email || "",
        JSON.stringify({ connection_id: connection.id, connected_account_id: connection.composio_connected_account_id }),
      ],
    );
    return updated.rows[0];
  }
  const inserted = await pool().query(
    `insert into calendar_accounts (
       client_id, connection_id, provider, provider_account_id, display_name, email, status, metadata
     ) values ($1,$2,$3,$4,$5,$6,'active',$7::jsonb)
     returning *`,
    [
      clientId(),
      connection.id,
      connection.provider,
      connection.composio_connected_account_id,
      connection.display_name || connection.email || connection.provider,
      connection.email || "",
      JSON.stringify({ connection_id: connection.id, connected_account_id: connection.composio_connected_account_id }),
    ],
  );
  return inserted.rows[0];
}

async function ensureExternalCalendar(connection: ProviderConnectionRecord, source: CalendarSource) {
  const account = await ensureCalendarAccount(connection);
  const externalCalendarId = source.id || "primary";
  const existing = await pool().query(
    `select *
       from calendars
      where client_id = $1
        and account_id = $2
        and metadata->>'external_calendar_id' = $3
        and archived_at is null
      limit 1`,
    [clientId(), account.id, externalCalendarId],
  );
  const metadata = {
    external_calendar_id: externalCalendarId,
    provider: connection.provider,
    provider_account_id: connection.composio_connected_account_id,
    primary: Boolean(source.primary),
    raw: source.raw || {},
  };
  if (existing.rows[0]) {
    const updated = await pool().query(
      `update calendars
          set name = $3,
              description = $4,
              color = $5,
              timezone = $6,
              metadata = metadata || $7::jsonb,
              updated_at = now()
        where client_id = $1 and id = $2
        returning *`,
      [
        clientId(),
        existing.rows[0].id,
        source.name || "Calendar",
        source.description || existing.rows[0].description || "",
        source.color || existing.rows[0].color || "#6366f1",
        source.timezone || existing.rows[0].timezone || "America/Chicago",
        JSON.stringify(metadata),
      ],
    );
    return updated.rows[0];
  }
  const inserted = await pool().query(
    `insert into calendars (
       client_id, account_id, owner_user_id, name, description, color, timezone,
       booking_link_slug, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     returning *`,
    [
      clientId(),
      account.id,
      connection.user_id || "",
      source.name || "Calendar",
      source.description || "",
      source.color || "#6366f1",
      source.timezone || "America/Chicago",
      "",
      JSON.stringify(metadata),
    ],
  );
  return inserted.rows[0];
}

async function connectedRows(domain: ProviderDomain, userEmail: string): Promise<ProviderConnectionRecord[]> {
  const providers: ExternalProvider[] = ["google", "outlook"];
  const rows: ProviderConnectionRecord[] = [];
  for (const provider of providers) {
    try {
      rows.push(...await reconcileComposioProviderConnections({ domain, provider, userEmail }));
    } catch {
      rows.push(...await listProviderConnections({ domain, provider: providerName(domain, provider) }));
    }
  }
  const seen = new Set<string>();
  return rows
    .filter((row) => row.status === "connected" && row.composio_connected_account_id)
    .filter((row) => {
      const key = `${row.provider}:${row.composio_connected_account_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function syncCursor(domain: ProviderDomain, connection: ProviderConnectionRecord, externalCalendarId = "") {
  const table = domain === "calendar" ? "calendar_sync_states" : "contact_sync_states";
  const column = domain === "calendar" ? "external_calendar_id" : "''";
  const result = await pool().query(
    `select *
       from ${table}
      where client_id = $1
        and provider = $2
        and connection_id = $3
        and ${column} = $4
      limit 1`,
    [clientId(), connection.provider, connection.id, externalCalendarId],
  );
  return result.rows[0] as { sync_cursor?: string } | undefined;
}

async function writeSyncState(input: {
  domain: ProviderDomain;
  connection: ProviderConnectionRecord;
  externalCalendarId?: string;
  syncType: SyncKind;
  cursor?: string;
  status: string;
  error?: string;
  metadata?: Record<string, unknown>;
}) {
  const table = input.domain === "calendar" ? "calendar_sync_states" : "contact_sync_states";
  const fullColumn = input.syncType === "full" ? "last_full_sync_at" : "last_incremental_sync_at";
  if (input.domain === "calendar") {
    await pool().query(
      `insert into calendar_sync_states (
         client_id, connection_id, provider, external_calendar_id, sync_cursor,
         sync_cursor_type, status, ${fullColumn}, last_error, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9::jsonb)
       on conflict (client_id, provider, external_calendar_id, coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid))
       do update set
         sync_cursor = excluded.sync_cursor,
         sync_cursor_type = excluded.sync_cursor_type,
         status = excluded.status,
         ${fullColumn} = now(),
         last_error = excluded.last_error,
         metadata = calendar_sync_states.metadata || excluded.metadata,
         updated_at = now()`,
      [
        clientId(),
        input.connection.id,
        input.connection.provider,
        input.externalCalendarId || "",
        input.cursor || "",
        input.cursor ? "sync_token" : "",
        input.status,
        input.error || "",
        JSON.stringify(input.metadata || {}),
      ],
    );
  } else {
    await pool().query(
      `insert into contact_sync_states (
         client_id, connection_id, provider, sync_cursor, sync_cursor_type,
         status, ${fullColumn}, last_error, metadata
       ) values ($1,$2,$3,$4,$5,$6,now(),$7,$8::jsonb)
       on conflict (client_id, provider, coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid))
       do update set
         sync_cursor = excluded.sync_cursor,
         sync_cursor_type = excluded.sync_cursor_type,
         status = excluded.status,
         ${fullColumn} = now(),
         last_error = excluded.last_error,
         metadata = contact_sync_states.metadata || excluded.metadata,
         updated_at = now()`,
      [
        clientId(),
        input.connection.id,
        input.connection.provider,
        input.cursor || "",
        input.cursor ? "sync_token" : "",
        input.status,
        input.error || "",
        JSON.stringify(input.metadata || {}),
      ],
    );
  }
}

async function writeSyncLog(input: {
  domain: ProviderDomain;
  connection: ProviderConnectionRecord;
  syncType: SyncKind;
  status: string;
  itemsRead: number;
  itemsWritten: number;
  error?: string;
  externalCalendarId?: string;
}) {
  if (input.domain === "calendar") {
    await pool().query(
      `insert into calendar_sync_logs (
         client_id, provider, connection_id, external_calendar_id,
         sync_type, status, items_read, items_written, error
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [clientId(), input.connection.provider, input.connection.id, input.externalCalendarId || "", input.syncType, input.status, input.itemsRead, input.itemsWritten, input.error || ""],
    );
    return;
  }
  await pool().query(
    `insert into contact_sync_logs (
       client_id, provider, connection_id, sync_type, status, items_read, items_written, error
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [clientId(), input.connection.provider, input.connection.id, input.syncType, input.status, input.itemsRead, input.itemsWritten, input.error || ""],
  );
}

async function upsertExternalCalendarEvent(connection: ProviderConnectionRecord, event: CalendarEvent, source: CalendarSource): Promise<boolean> {
  if (!event.startTime) return false;
  const externalEventId = text(event.sourceId || event.id);
  if (!externalEventId) return false;
  const calendar = await ensureExternalCalendar(connection, source);
  const externalCalendarId = event.calendarId || source.id || "primary";
  const existing = await pool().query(
    `select appointment_id
       from appointment_external_refs
      where client_id = $1
        and provider = $2
        and provider_account_id = $3
        and external_calendar_id = $4
        and external_event_id = $5
      limit 1`,
    [clientId(), connection.provider, connection.composio_connected_account_id, externalCalendarId, externalEventId],
  );
  const attendee = event.attendees[0];
  const contact = attendee?.email
    ? await upsertContact({
      fullName: attendee.name || attendee.email,
      emails: [attendee.email],
      source: connection.provider,
      leadSource: "calendar_sync",
      rawProviderPayload: { attendee, eventId: externalEventId },
    })
    : null;
  const end = eventEnd(event);
  if (existing.rows[0]?.appointment_id) {
    await pool().query(
      `update appointments
          set title = $3,
              description = $4,
              scheduled_at = $5::timestamptz,
              scheduled_at_local = $5,
              duration_minutes = $6,
              status = $7,
              source = $8,
              booked_via_channel = $8,
              location_value = $9,
              contact_id = coalesce($10::uuid, contact_id),
              calendar_id = $11::uuid,
              updated_at = now()
        where client_id = $1 and id = $2`,
      [
        clientId(),
        existing.rows[0].appointment_id,
        event.title || "Synced appointment",
        event.description || "",
        event.startTime,
        durationMinutes(event.startTime, end),
        event.status || "scheduled",
        connection.provider,
        event.location || "",
        contact?.id || null,
        calendar.id,
      ],
    );
  } else {
    const created = await pool().query(
      `insert into appointments (
         client_id, caller_email, caller_name, appointment_type, property_address,
         scheduled_at, scheduled_at_local, duration_minutes, status, booked_via_channel,
         notes, title, description, timezone, calendar_id, contact_id, source, location_type,
         location_value, internal_notes
       ) values ($1,$2,$3,$4,$5,$6::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid,$15::uuid,$16,$17,$18,$19)
       returning id`,
      [
        clientId(),
        attendee?.email || "",
        attendee?.name || "",
        "external_calendar",
        event.location || "",
        event.startTime,
        durationMinutes(event.startTime, end),
        event.status || "scheduled",
        connection.provider,
        event.description || "",
        event.title || "Synced appointment",
        event.description || "",
        event.timezone || calendar.timezone,
        calendar.id,
        contact?.id || null,
        connection.provider,
        event.location ? "custom_address" : "provider",
        event.location || "",
        event.htmlLink || "",
      ],
    );
    await pool().query(
      `insert into appointment_external_refs (
         client_id, appointment_id, provider, provider_account_id, external_calendar_id,
         external_event_id, last_synced_at, sync_status, metadata
       ) values ($1,$2,$3,$4,$5,$6,now(),'synced',$7::jsonb)
       on conflict (client_id, provider, provider_account_id, external_calendar_id, external_event_id)
       do update set appointment_id = excluded.appointment_id, last_synced_at = now(), sync_status = 'synced', metadata = excluded.metadata`,
      [
        clientId(),
        created.rows[0].id,
        connection.provider,
        connection.composio_connected_account_id,
        externalCalendarId,
        externalEventId,
        JSON.stringify(event.raw || {}),
      ],
    );
  }
  return true;
}

async function upsertExternalContact(connection: ProviderConnectionRecord, contact: ExternalContact): Promise<boolean> {
  const externalContactId = text(contact.sourceId || contact.id);
  if (!externalContactId) return false;
  const saved = await upsertContact({
    fullName: contact.fullName,
    firstName: contact.firstName,
    lastName: contact.lastName,
    emails: contact.emails.map((email) => email.value),
    phones: contact.phones.map((phone) => phone.value),
    company: contact.company,
    source: connection.provider,
    leadSource: "contacts_sync",
    customFields: { title: contact.title, tags: contact.tags },
    rawProviderPayload: contact.raw || {},
  });
  await pool().query(
    `insert into contact_external_refs (
       client_id, contact_id, provider, provider_account_id, external_contact_id,
       last_synced_at, sync_status, raw_provider_payload
     ) values ($1,$2,$3,$4,$5,now(),'synced',$6::jsonb)
     on conflict (client_id, provider, provider_account_id, external_contact_id)
     do update set
       contact_id = excluded.contact_id,
       last_synced_at = now(),
       sync_status = 'synced',
       raw_provider_payload = excluded.raw_provider_payload`,
    [
      clientId(),
      saved.id,
      connection.provider,
      connection.composio_connected_account_id,
      externalContactId,
      JSON.stringify(contact.raw || {}),
    ],
  );
  return true;
}

export async function syncCalendars(input: { userEmail: string; syncType: SyncKind }): Promise<SyncSummary> {
  const summary: SyncSummary = { domain: "calendar", syncType: input.syncType, providers: [], connections: 0, itemsRead: 0, itemsWritten: 0, errors: [] };
  const rows = await connectedRows("calendar", input.userEmail);
  summary.connections = rows.length;
  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  for (const connection of rows) {
    const provider = calendarProvider(connection);
    if (!provider) continue;
    summary.providers.push(connection.provider);
    try {
      let calendars = [defaultCalendarSource(connection)];
      if (provider.listCalendars) {
        try {
          const listed = await provider.listCalendars();
          if (listed.length) calendars = listed;
        } catch (error) {
          await writeSyncLog({
            domain: "calendar",
            connection,
            syncType: input.syncType,
            status: "calendar_list_fallback",
            itemsRead: 0,
            itemsWritten: 0,
            error: error instanceof Error ? error.message : String(error),
            externalCalendarId: "primary",
          });
        }
      }
      for (const calendar of calendars) {
        const externalCalendarId = calendar.id || "primary";
        const state = input.syncType === "incremental" ? await syncCursor("calendar", connection, externalCalendarId) : undefined;
        let pageToken = "";
        let cursor = "";
        let read = 0;
        let written = 0;
        let pages = 0;
        do {
          const page = await provider.listEvents({
            calendarId: externalCalendarId,
            timeMin,
            timeMax,
            syncToken: input.syncType === "incremental" ? state?.sync_cursor : undefined,
            pageToken: pageToken || undefined,
            limit: 100,
          });
          pages += 1;
          read += page.events.length;
          cursor = page.nextSyncToken || cursor;
          pageToken = page.nextPageToken || "";
          for (const event of page.events) {
            const eventWithCalendar = { ...event, calendarId: event.calendarId || externalCalendarId };
            if (await upsertExternalCalendarEvent(connection, eventWithCalendar, calendar)) written += 1;
          }
        } while (pageToken && pages < 10);
        summary.itemsRead += read;
        summary.itemsWritten += written;
        await writeSyncState({
          domain: "calendar",
          connection,
          externalCalendarId,
          syncType: input.syncType,
          cursor,
          status: "synced",
          metadata: { calendar_name: calendar.name, pages, truncated: Boolean(pageToken) },
        });
        await writeSyncLog({ domain: "calendar", connection, externalCalendarId, syncType: input.syncType, status: "synced", itemsRead: read, itemsWritten: written });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${connection.provider}: ${message}`);
      await writeSyncState({ domain: "calendar", connection, syncType: input.syncType, status: "failed", error: message });
      await writeSyncLog({ domain: "calendar", connection, syncType: input.syncType, status: "failed", itemsRead: 0, itemsWritten: 0, error: message });
    }
  }
  return summary;
}

export async function syncContacts(input: { userEmail: string; syncType: SyncKind }): Promise<SyncSummary> {
  const summary: SyncSummary = { domain: "contacts", syncType: input.syncType, providers: [], connections: 0, itemsRead: 0, itemsWritten: 0, errors: [] };
  const rows = await connectedRows("contacts", input.userEmail);
  summary.connections = rows.length;
  for (const connection of rows) {
    const provider = contactsProvider(connection);
    if (!provider) continue;
    summary.providers.push(connection.provider);
    try {
      const state = input.syncType === "incremental" ? await syncCursor("contacts", connection) : undefined;
      const page = await provider.searchContacts({
        syncToken: input.syncType === "incremental" ? state?.sync_cursor : undefined,
        limit: 100,
      });
      let written = 0;
      for (const contact of page.contacts) {
        if (await upsertExternalContact(connection, contact)) written += 1;
      }
      summary.itemsRead += page.contacts.length;
      summary.itemsWritten += written;
      await writeSyncState({ domain: "contacts", connection, syncType: input.syncType, cursor: page.nextSyncToken, status: "synced", metadata: { next_page_token: page.nextPageToken || "" } });
      await writeSyncLog({ domain: "contacts", connection, syncType: input.syncType, status: "synced", itemsRead: page.contacts.length, itemsWritten: written });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${connection.provider}: ${message}`);
      await writeSyncState({ domain: "contacts", connection, syncType: input.syncType, status: "failed", error: message });
      await writeSyncLog({ domain: "contacts", connection, syncType: input.syncType, status: "failed", itemsRead: 0, itemsWritten: 0, error: message });
    }
  }
  return summary;
}
