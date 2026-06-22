import { test } from "node:test";
import assert from "node:assert/strict";
import type { QueryResult, QueryResultRow } from "pg";

import {
  detectCalendarConflicts,
  findCalendarConflicts,
  generateAvailabilitySlots,
  listBusyRanges,
  rangesOverlap,
} from "@/lib/calendarOs";
import {
  contactDedupeKeys,
  mergeContactInputs,
  normalizeContactInput,
} from "@/lib/contactOs";

type QueryCall = {
  text: string;
  values: readonly unknown[];
};

class FakeDb {
  calls: QueryCall[] = [];
  private responses: QueryResultRow[][];

  constructor(responses: QueryResultRow[][] = []) {
    this.responses = responses;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    const rows = (this.responses.shift() || []) as T[];
    return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
  }
}

test("generateAvailabilitySlots skips busy ranges with buffers", () => {
  const slots = generateAvailabilitySlots({
    windows: [{ start: "2026-06-22T14:00:00Z", end: "2026-06-22T17:00:00Z" }],
    busy: [{ start: "2026-06-22T15:00:00Z", end: "2026-06-22T15:30:00Z" }],
    durationMinutes: 30,
    stepMinutes: 30,
    bufferMinutes: 15,
    now: "2026-06-22T12:00:00Z",
  });

  assert.deepEqual(slots.map((slot) => slot.start), [
    "2026-06-22T14:00:00.000Z",
    "2026-06-22T16:00:00.000Z",
    "2026-06-22T16:30:00.000Z",
  ]);
});

test("generateAvailabilitySlots honors minimum notice and max range", () => {
  const slots = generateAvailabilitySlots({
    windows: [{ start: "2026-06-22T14:00:00Z", end: "2026-06-25T16:00:00Z" }],
    durationMinutes: 60,
    stepMinutes: 60,
    minimumNoticeMinutes: 120,
    maximumRangeDays: 1,
    now: "2026-06-22T13:00:00Z",
    limit: 10,
  });

  assert.equal(slots[0].start, "2026-06-22T15:00:00.000Z");
  assert(slots.every((slot) => Date.parse(slot.start) <= Date.parse("2026-06-23T13:00:00Z")));
});

test("detectCalendarConflicts returns slot/block pairs", () => {
  const conflicts = detectCalendarConflicts(
    [{ start: "2026-06-22T15:15:00Z", end: "2026-06-22T15:45:00Z" }],
    [{ start: "2026-06-22T15:30:00Z", end: "2026-06-22T16:00:00Z" }],
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].busy.start, "2026-06-22T15:30:00Z");
});

test("rangesOverlap treats canceled-adjacent boundaries correctly", () => {
  assert.equal(
    rangesOverlap(
      { start: "2026-06-22T15:00:00Z", end: "2026-06-22T15:30:00Z" },
      { start: "2026-06-22T15:30:00Z", end: "2026-06-22T16:00:00Z" },
    ),
    false,
  );
  assert.equal(
    rangesOverlap(
      { start: "2026-06-22T15:00:00Z", end: "2026-06-22T15:30:00Z" },
      { start: "2026-06-22T15:30:00Z", end: "2026-06-22T16:00:00Z" },
      1,
    ),
    true,
  );
});

test("listBusyRanges queries appointments and booking holds only", async () => {
  const db = new FakeDb([
    [{ start: "2026-06-22T15:00:00Z", end: "2026-06-22T15:30:00Z" }],
  ]);

  const rows = await listBusyRanges(
    { start: "2026-06-22T14:00:00Z", end: "2026-06-22T16:00:00Z" },
    db,
    "client-a",
  );

  assert.equal(rows.length, 1);
  assert.match(db.calls[0].text, /from appointments/i);
  assert.match(db.calls[0].text, /from booking_holds/i);
  assert.doesNotMatch(db.calls[0].text, /calendar_events_os/i);
});

test("findCalendarConflicts expands lookup by buffer", async () => {
  const db = new FakeDb([
    [{ start: "2026-06-22T15:00:00Z", end: "2026-06-22T15:30:00Z" }],
  ]);

  const conflicts = await findCalendarConflicts(
    { start: "2026-06-22T15:30:00Z", end: "2026-06-22T16:00:00Z" },
    db,
    "client-a",
    10,
  );

  assert.equal(conflicts.length, 1);
  assert.equal(db.calls[0].values[1], "2026-06-22T15:20:00.000Z");
});

test("normalizeContactInput and contactDedupeKeys build canonical identities", () => {
  const contact = normalizeContactInput({
    fullName: "  Sam   Lee ",
    emails: ["SAM@Example.COM "],
    phones: ["+1 (512) 555-0000"],
    source: "google_contacts",
  });

  assert.equal(contact.fullName, "Sam Lee");
  assert.equal(contact.emails[0], "sam@example.com");
  assert.equal(contact.phones[0], "15125550000");
  assert.deepEqual(contactDedupeKeys({ emails: ["SAM@Example.COM "], phones: ["+1 (512) 555-0000"] }), [
    "email:sam@example.com",
    "phone:15125550000",
  ]);
});

test("mergeContactInputs preserves unique channels and conservative do-not-contact", () => {
  const merged = mergeContactInputs(
    { fullName: "Sam Lee", emails: ["sam@example.com"], doNotContact: false, customFields: { stage: "showing" } },
    { fullName: "Samuel", emails: ["SAM@example.com", "other@example.com"], phones: ["5125551111"], doNotContact: true, customFields: { source: "csv" } },
  );

  assert.equal(merged.fullName, "Sam Lee");
  assert.deepEqual(merged.emails, ["sam@example.com", "other@example.com"]);
  assert.deepEqual(merged.phones, ["15125551111"]);
  assert.equal(merged.doNotContact, true);
  assert.deepEqual(merged.customFields, { source: "csv", stage: "showing" });
});
