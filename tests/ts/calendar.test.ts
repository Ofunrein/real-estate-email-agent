import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildIcsInvite,
  cancelShowing,
  rescheduleShowing,
  scheduleShowing,
  upcomingShowings,
} from "@/lib/calendar";
import type { CrmAdapter, CrmAppointment } from "@/lib/crm/types";

function adapter(overrides: Partial<CrmAdapter> = {}): CrmAdapter {
  return {
    provider: "fake",
    findContactByPhone: async () => ({ id: "c1" }),
    findContactByEmail: async () => ({ id: "c1" }),
    upsertContact: async () => ({ id: "c1" }),
    listAppointments: async () => [],
    createAppointment: async (input) => ({ id: "appt1", contactId: input.contactId, startTime: input.startTime }),
    updateAppointment: async (id, u) => ({ id, contactId: "c1", startTime: u.startTime || "" }),
    cancelAppointment: async () => undefined,
    logActivity: async () => undefined,
    ...overrides,
  };
}

test("buildIcsInvite: valid VCALENDAR with start/end/summary", () => {
  const ics = buildIcsInvite({ title: "Showing — 123 Main St", startTime: "2026-06-12T19:00:00Z", address: "123 Main St" });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART:20260612T190000Z/);
  assert.match(ics, /DTEND:20260612T200000Z/); // +1h default
  assert.match(ics, /SUMMARY:Showing — 123 Main St/);
  assert.match(ics, /LOCATION:123 Main St/);
});

test("scheduleShowing: upserts contact, books, returns ics + spoken", async () => {
  let createdContactId = "";
  const result = await scheduleShowing(
    adapter({
      upsertContact: async () => ({ id: "c9" }),
      createAppointment: async (input) => {
        createdContactId = input.contactId;
        return { id: "appt1", contactId: input.contactId, startTime: input.startTime };
      },
    }),
    { calendarId: "cal_1", contact: { phone: "+15125550000", fullName: "Sam" }, startTime: "2026-06-12T19:00:00Z", address: "123 Main St" },
  );
  assert.equal(result.contactId, "c9");
  assert.equal(createdContactId, "c9");
  assert.match(result.spoken, /booked/i);
  assert.match(result.ics, /BEGIN:VCALENDAR/);
});

test("upcomingShowings: filters past + cancelled, sorts soonest", () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  const appts: CrmAppointment[] = [
    { id: "past", contactId: "c1", startTime: "2026-06-01T00:00:00Z" },
    { id: "soon", contactId: "c1", startTime: "2026-06-11T00:00:00Z" },
    { id: "later", contactId: "c1", startTime: "2026-06-20T00:00:00Z" },
    { id: "cxl", contactId: "c1", startTime: "2026-06-12T00:00:00Z", status: "cancelled" },
  ];
  const upcoming = upcomingShowings(appts, now);
  assert.deepEqual(upcoming.map((a) => a.id), ["soon", "later"]);
});

test("cancelShowing: cancels next upcoming", async () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  let cancelled = "";
  const result = await cancelShowing(
    adapter({
      listAppointments: async () => [{ id: "a2", contactId: "c1", startTime: "2026-06-15T00:00:00Z" }],
      cancelAppointment: async (id) => { cancelled = id; },
    }),
    { contact: { phone: "+15125550000" }, nowMs: now },
  );
  assert.equal(result.ok, true);
  assert.equal(cancelled, "a2");
});

test("cancelShowing: no contact -> asks to confirm", async () => {
  const result = await cancelShowing(
    adapter({ findContactByPhone: async () => null, findContactByEmail: async () => null }),
    { contact: { phone: "" } },
  );
  assert.equal(result.ok, false);
  assert.match(result.spoken, /confirm/i);
});

test("rescheduleShowing: updates next upcoming to new time", async () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  let updatedTo = "";
  const result = await rescheduleShowing(
    adapter({
      listAppointments: async () => [{ id: "a3", contactId: "c1", startTime: "2026-06-15T00:00:00Z" }],
      updateAppointment: async (_id, u) => { updatedTo = u.startTime || ""; return { id: "a3", contactId: "c1", startTime: u.startTime || "" }; },
    }),
    { contact: { phone: "+15125550000" }, newStartTime: "2026-06-18T18:00:00Z", nowMs: now },
  );
  assert.equal(result.ok, true);
  assert.equal(updatedTo, "2026-06-18T18:00:00Z");
});

test("rescheduleShowing: no upcoming -> graceful", async () => {
  const result = await rescheduleShowing(
    adapter({ listAppointments: async () => [] }),
    { contact: { phone: "+15125550000" }, newStartTime: "2026-06-18T18:00:00Z" },
  );
  assert.equal(result.ok, false);
});
