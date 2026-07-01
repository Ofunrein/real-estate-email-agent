import type { CalendarAttendee, CalendarEvent, CalendarSource } from "./calendar-provider.interface";
import type { ContactEmail, ContactPhone, ContactRecord } from "./contacts-provider.interface";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function firstString(...values: unknown[]): string {
  return values.map(stringValue).find(Boolean) || "";
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeEmailAddress(value: unknown): string {
  return stringValue(value).toLowerCase();
}

export function normalizePhoneNumber(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  const hasPlus = text.trim().startsWith("+");
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function normalizeIdPart(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9_.:@-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function providerScopedId(provider: string, sourceId: string): string {
  const normalizedProvider = normalizeIdPart(provider) || "provider";
  const normalizedSourceId = normalizeIdPart(sourceId);
  return `${normalizedProvider}:${normalizedSourceId || stableHash(sourceId || "missing")}`;
}

export function calendarEventIdempotencyKey(input: {
  provider: string;
  calendarId?: string;
  sourceId?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
}): string {
  const sourceId = normalizeIdPart(input.sourceId);
  if (sourceId) return providerScopedId(input.provider, sourceId);
  return providerScopedId(input.provider, [
    normalizeIdPart(input.calendarId),
    normalizeIdPart(input.title),
    stringValue(input.startTime),
    stringValue(input.endTime),
  ].join("|"));
}

export function contactIdempotencyKey(input: {
  provider: string;
  sourceId?: string;
  email?: string;
  phone?: string;
  fullName?: string;
}): string {
  const sourceId = normalizeIdPart(input.sourceId);
  if (sourceId) return providerScopedId(input.provider, sourceId);
  const email = normalizeEmailAddress(input.email);
  if (email) return providerScopedId(input.provider, `email:${email}`);
  const phone = normalizePhoneNumber(input.phone);
  if (phone) return providerScopedId(input.provider, `phone:${phone}`);
  return providerScopedId(input.provider, `name:${normalizeIdPart(input.fullName)}`);
}

function dateTimeValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const item = record(value);
  return firstString(item.dateTime, item.date, item.value);
}

function attendeeList(value: unknown): CalendarAttendee[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attendees: CalendarAttendee[] = [];
  for (const item of value) {
    const attendee = record(item);
    const email = normalizeEmailAddress(firstString(attendee.email, attendee.address));
    if (!email || seen.has(email)) continue;
    seen.add(email);
    attendees.push({
      email,
      name: firstString(attendee.displayName, attendee.name) || undefined,
      responseStatus: firstString(attendee.responseStatus, attendee.status) || undefined,
    });
  }
  return attendees;
}

export function normalizeCalendarEvent(provider: string, rawValue: unknown): CalendarEvent {
  const raw = record(rawValue);
  const start = record(raw.start);
  const end = record(raw.end);
  const sourceId = firstString(raw.id, raw.eventId, raw.iCalUID, raw.uid);
  const calendarId = firstString(raw.calendarId, raw.calendar_id);
  const title = firstString(raw.summary, raw.subject, raw.title, "(untitled)");
  const startTime = firstString(dateTimeValue(raw.start), raw.startTime, raw.start_time);
  return {
    id: calendarEventIdempotencyKey({
      provider,
      calendarId,
      sourceId,
      title,
      startTime,
      endTime: firstString(dateTimeValue(raw.end), raw.endTime, raw.end_time),
    }),
    provider,
    sourceId,
    calendarId: calendarId || undefined,
    title,
    description: firstString(raw.description, raw.bodyPreview) || undefined,
    location: firstString(record(raw.location).displayName, raw.location) || undefined,
    startTime,
    endTime: firstString(dateTimeValue(raw.end), raw.endTime, raw.end_time) || undefined,
    timezone: firstString(start.timeZone, end.timeZone, raw.timezone, raw.timeZone) || undefined,
    status: firstString(raw.status, raw.showAs) || undefined,
    attendees: attendeeList(raw.attendees),
    htmlLink: firstString(raw.htmlLink, raw.webLink) || undefined,
    updatedAt: firstString(raw.updated, raw.lastModifiedDateTime, raw.updatedAt) || undefined,
    etag: firstString(raw.etag, raw["@odata.etag"]) || undefined,
    raw,
  };
}

export function normalizeCalendarSource(rawValue: unknown): CalendarSource {
  const raw = record(rawValue);
  const sourceId = firstString(raw.id, raw.calendarId, raw.calendar_id, raw.externalId, raw.external_id);
  const name = firstString(raw.summary, raw.name, raw.title, raw.displayName, raw.ownerEmail, "Calendar");
  return {
    id: sourceId || normalizeIdPart(name) || "primary",
    name,
    description: firstString(raw.description) || undefined,
    timezone: firstString(raw.timeZone, raw.timezone, raw.time_zone) || undefined,
    color: firstString(raw.backgroundColor, raw.color, raw.hexColor) || undefined,
    primary: Boolean(raw.primary || raw.isPrimary || raw.default),
    raw,
  };
}

function emailList(value: unknown): ContactEmail[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  const emails: ContactEmail[] = [];
  for (const item of items) {
    const source = record(item);
    const email = normalizeEmailAddress(firstString(source.value, source.address, source.emailAddress, item));
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push({ value: email, label: firstString(source.type, source.label, source.name) || undefined });
  }
  return emails;
}

function phoneList(value: unknown): ContactPhone[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  const phones: ContactPhone[] = [];
  for (const item of items) {
    const source = record(item);
    const phone = normalizePhoneNumber(firstString(source.value, source.number, item));
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push({ value: phone, label: firstString(source.type, source.label) || undefined });
  }
  return phones;
}

export function normalizeContact(provider: string, rawValue: unknown): ContactRecord {
  const raw = record(rawValue);
  const names = Array.isArray(raw.names) ? raw.names.map(record) : [];
  const name = names[0] || {};
  const sourceId = firstString(raw.resourceName, raw.id, raw.contactId);
  const emails = emailList(raw.emailAddresses || raw.email_addresses || raw.emails);
  const phones = phoneList(raw.phoneNumbers || raw.phone_numbers || raw.phones || raw.businessPhones || raw.mobilePhone);
  const fullName = firstString(raw.displayName, raw.fullName, name.displayName, name.unstructuredName);
  return {
    id: contactIdempotencyKey({
      provider,
      sourceId,
      email: emails[0]?.value,
      phone: phones[0]?.value,
      fullName,
    }),
    provider,
    sourceId,
    fullName: fullName || undefined,
    firstName: firstString(raw.givenName, name.givenName) || undefined,
    lastName: firstString(raw.surname, raw.familyName, name.familyName) || undefined,
    company: firstString(raw.companyName, record((Array.isArray(raw.organizations) ? raw.organizations[0] : undefined)).name) || undefined,
    title: firstString(raw.jobTitle, record((Array.isArray(raw.organizations) ? raw.organizations[0] : undefined)).title) || undefined,
    emails,
    phones,
    addresses: [],
    notes: firstString(raw.biography, raw.notes, raw.personalNotes) || undefined,
    tags: Array.isArray(raw.memberships) ? raw.memberships.map((item) => firstString(record(item).contactGroupMembership?.toString(), item)).filter(Boolean) : [],
    updatedAt: firstString(raw.metadata?.toString(), raw.updatedAt, raw.lastModifiedDateTime) || undefined,
    etag: firstString(raw.etag, raw["@odata.etag"]) || undefined,
    raw,
  };
}
