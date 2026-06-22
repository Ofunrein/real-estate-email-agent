import type { CalendarEvent, CalendarProvider } from "./calendar-provider.interface";
import type { ContactRecord, ContactsProvider } from "./contacts-provider.interface";
import { resolveCalendarEvent, resolveContact, type ConflictResolution } from "./conflict-resolver";

export type SyncCursor = {
  pageToken?: string;
  syncToken?: string;
};

export type SyncStore<T extends { id: string }> = {
  get(id: string): Promise<T | null>;
  put(record: T, resolution: ConflictResolution<T>): Promise<void>;
};

export type SyncResult = {
  scanned: number;
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
  nextCursor: SyncCursor;
};

function emptyResult(nextCursor: SyncCursor = {}): SyncResult {
  return { scanned: 0, inserted: 0, updated: 0, skipped: 0, conflicts: 0, nextCursor };
}

async function applyRecords<T extends { id: string; updatedAt?: string; etag?: string }>(
  records: T[],
  store: SyncStore<T>,
  resolve: (incoming: T, existing?: T | null) => ConflictResolution<T>,
): Promise<Omit<SyncResult, "nextCursor">> {
  const result = { scanned: 0, inserted: 0, updated: 0, skipped: 0, conflicts: 0 };
  for (const record of records) {
    result.scanned += 1;
    const resolution = resolve(record, await store.get(record.id));
    if (resolution.action === "insert") result.inserted += 1;
    if (resolution.action === "update") result.updated += 1;
    if (resolution.action === "skip") result.skipped += 1;
    if (resolution.action === "conflict") result.conflicts += 1;
    await store.put(resolution.record, resolution);
  }
  return result;
}

export async function syncCalendarProvider(input: {
  provider: CalendarProvider;
  store: SyncStore<CalendarEvent>;
  cursor?: SyncCursor;
  limit?: number;
}): Promise<SyncResult> {
  const page = await input.provider.listEvents({
    pageToken: input.cursor?.pageToken,
    syncToken: input.cursor?.syncToken,
    limit: input.limit,
  });
  const applied = await applyRecords(page.events, input.store, resolveCalendarEvent);
  return { ...emptyResult({ pageToken: page.nextPageToken, syncToken: page.nextSyncToken }), ...applied };
}

export async function syncContactsProvider(input: {
  provider: ContactsProvider;
  store: SyncStore<ContactRecord>;
  cursor?: SyncCursor;
  limit?: number;
}): Promise<SyncResult> {
  const page = await input.provider.searchContacts({
    pageToken: input.cursor?.pageToken,
    syncToken: input.cursor?.syncToken,
    limit: input.limit,
  });
  const applied = await applyRecords(page.contacts, input.store, resolveContact);
  return { ...emptyResult({ pageToken: page.nextPageToken, syncToken: page.nextSyncToken }), ...applied };
}
