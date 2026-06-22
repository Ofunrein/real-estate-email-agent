import type { CalendarEvent } from "./calendar-provider.interface";
import type { ContactRecord } from "./contacts-provider.interface";

export type ConflictResolution<T> = {
  action: "insert" | "update" | "skip" | "conflict";
  record: T;
  reason: string;
};

function timestamp(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function sameVersion(a?: { etag?: string }, b?: { etag?: string }): boolean {
  return Boolean(a?.etag && b?.etag && a.etag === b.etag);
}

export function resolveProviderRecord<T extends { id: string; updatedAt?: string; etag?: string }>(
  incoming: T,
  existing?: T | null,
): ConflictResolution<T> {
  if (!existing) return { action: "insert", record: incoming, reason: "new_provider_record" };
  if (sameVersion(incoming, existing)) return { action: "skip", record: existing, reason: "matching_etag" };
  const incomingUpdated = timestamp(incoming.updatedAt);
  const existingUpdated = timestamp(existing.updatedAt);
  if (incomingUpdated > existingUpdated) return { action: "update", record: incoming, reason: "incoming_newer" };
  if (incomingUpdated && existingUpdated && incomingUpdated < existingUpdated) {
    return { action: "skip", record: existing, reason: "existing_newer" };
  }
  if (!incoming.etag && !existing.etag && JSON.stringify(incoming) === JSON.stringify(existing)) {
    return { action: "skip", record: existing, reason: "identical_payload" };
  }
  return { action: "conflict", record: existing, reason: "same_timestamp_different_payload" };
}

export function resolveCalendarEvent(incoming: CalendarEvent, existing?: CalendarEvent | null): ConflictResolution<CalendarEvent> {
  return resolveProviderRecord(incoming, existing);
}

export function resolveContact(incoming: ContactRecord, existing?: ContactRecord | null): ConflictResolution<ContactRecord> {
  return resolveProviderRecord(incoming, existing);
}
