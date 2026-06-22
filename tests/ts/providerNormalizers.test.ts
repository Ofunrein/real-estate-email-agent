import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calendarEventIdempotencyKey,
  contactIdempotencyKey,
  normalizeCalendarEvent,
  normalizeContact,
  normalizeEmailAddress,
  normalizePhoneNumber,
} from "@/integrations/provider-normalizers";
import { resolveCalendarEvent, resolveContact } from "@/integrations/conflict-resolver";

test("normalizeEmailAddress and normalizePhoneNumber are stable", () => {
  assert.equal(normalizeEmailAddress(" Sam@Example.COM "), "sam@example.com");
  assert.equal(normalizePhoneNumber("(512) 555-0100"), "+15125550100");
  assert.equal(normalizePhoneNumber("+44 20 7946 0958"), "+442079460958");
});

test("calendar event normalization creates provider-scoped idempotent ids", () => {
  const raw = {
    id: "evt_1",
    calendarId: "cal_1",
    summary: "Showing - 123 Main",
    start: { dateTime: "2026-06-23T15:00:00-05:00", timeZone: "America/Chicago" },
    end: { dateTime: "2026-06-23T15:30:00-05:00", timeZone: "America/Chicago" },
    attendees: [
      { email: "Buyer@Example.com", displayName: "Buyer" },
      { email: " buyer@example.com " },
    ],
    updated: "2026-06-22T10:00:00Z",
    etag: "abc",
  };

  const first = normalizeCalendarEvent("composio_google_calendar", raw);
  const second = normalizeCalendarEvent("composio_google_calendar", { ...raw, summary: "Showing - 123 Main" });

  assert.equal(first.id, "composio_google_calendar:evt_1");
  assert.equal(first.id, second.id);
  assert.equal(first.title, "Showing - 123 Main");
  assert.equal(first.timezone, "America/Chicago");
  assert.deepEqual(first.attendees, [{ email: "buyer@example.com", name: "Buyer", responseStatus: undefined }]);
});

test("calendar idempotency falls back to deterministic event content", () => {
  const key = calendarEventIdempotencyKey({
    provider: "outlook_calendar",
    calendarId: "calendar",
    title: "Showing",
    startTime: "2026-06-23T15:00:00Z",
    endTime: "2026-06-23T15:30:00Z",
  });

  assert.equal(
    key,
    calendarEventIdempotencyKey({
      provider: "outlook_calendar",
      calendarId: "calendar",
      title: "Showing",
      startTime: "2026-06-23T15:00:00Z",
      endTime: "2026-06-23T15:30:00Z",
    }),
  );
  assert.match(key, /^outlook_calendar:/);
});

test("contact normalization dedupes emails and phones", () => {
  const contact = normalizeContact("composio_google_contacts", {
    resourceName: "people/c1",
    names: [{ displayName: "Sam Lee", givenName: "Sam", familyName: "Lee" }],
    emailAddresses: [{ value: "SAM@example.com", type: "home" }, { value: "sam@example.com", type: "work" }],
    phoneNumbers: [{ value: "512.555.0100", type: "mobile" }, { value: "+1 (512) 555-0100", type: "other" }],
    organizations: [{ name: "Lumenosis", title: "Broker" }],
    etag: "person-etag",
  });

  assert.equal(contact.id, "composio_google_contacts:people_c1");
  assert.equal(contact.fullName, "Sam Lee");
  assert.deepEqual(contact.emails, [{ value: "sam@example.com", label: "home" }]);
  assert.deepEqual(contact.phones, [{ value: "+15125550100", label: "mobile" }]);
  assert.equal(contact.company, "Lumenosis");
  assert.equal(contact.title, "Broker");
});

test("contact idempotency prefers source id, then email, then phone", () => {
  assert.equal(contactIdempotencyKey({ provider: "google_contacts", sourceId: "people/123", email: "a@example.com" }), "google_contacts:people_123");
  assert.equal(contactIdempotencyKey({ provider: "google_contacts", email: "A@Example.com" }), "google_contacts:email:a@example.com");
  assert.equal(contactIdempotencyKey({ provider: "google_contacts", phone: "(512) 555-0100" }), "google_contacts:phone:_15125550100");
});

test("conflict resolver is idempotent for matching etags and updates newer records", () => {
  const existing = normalizeCalendarEvent("google_calendar", { id: "evt", summary: "Old", start: { dateTime: "2026-06-23T10:00:00Z" }, updated: "2026-06-20T00:00:00Z", etag: "a" });
  const same = normalizeCalendarEvent("google_calendar", { id: "evt", summary: "Changed locally", start: { dateTime: "2026-06-23T10:00:00Z" }, updated: "2026-06-21T00:00:00Z", etag: "a" });
  const newer = normalizeCalendarEvent("google_calendar", { id: "evt", summary: "New", start: { dateTime: "2026-06-23T10:00:00Z" }, updated: "2026-06-22T00:00:00Z", etag: "b" });

  assert.equal(resolveCalendarEvent(same, existing).action, "skip");
  const update = resolveCalendarEvent(newer, existing);
  assert.equal(update.action, "update");
  assert.equal(update.record.title, "New");
});

test("contact conflict resolver skips older incoming records", () => {
  const existing = normalizeContact("outlook_contacts", { id: "c1", displayName: "Sam", lastModifiedDateTime: "2026-06-22T00:00:00Z" });
  const incoming = normalizeContact("outlook_contacts", { id: "c1", displayName: "Samuel", lastModifiedDateTime: "2026-06-20T00:00:00Z" });

  const resolution = resolveContact(incoming, existing);
  assert.equal(resolution.action, "skip");
  assert.equal(resolution.record.fullName, "Sam");
});
