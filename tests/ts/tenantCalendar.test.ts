import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLocalDateTime } from "@/lib/ariaCalendar";
import { availabilitySlotsFromEvents, tenantBusinessWindows } from "@/lib/tenantCalendar";

const savedEnv = { ...process.env };

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

test("parseLocalDateTime preserves tenant timezone across daylight saving time", () => {
  assert.equal(parseLocalDateTime("2027-07-15", "10:00 AM", "America/Chicago"), "2027-07-15T15:00:00.000Z");
  assert.equal(parseLocalDateTime("2030-01-15", "10:00 AM", "America/Chicago"), "2030-01-15T16:00:00.000Z");
});

test("parseLocalDateTime rejects nonexistent DST wall-clock time", () => {
  assert.throws(
    () => parseLocalDateTime("2030-03-10", "2:30 AM", "America/Chicago"),
    /does not exist/,
  );
});

test("tenant business windows use the tenant timezone rather than UTC", () => {
  process.env.CALENDAR_BUSINESS_START_HOUR = "9";
  process.env.CALENDAR_BUSINESS_END_HOUR = "18";
  process.env.CALENDAR_BUSINESS_DAYS = "1,2,3,4,5";
  const windows = tenantBusinessWindows(
    "2027-07-15T00:00:00.000Z",
    "2027-07-16T23:59:59.000Z",
    "America/Chicago",
  );
  assert.deepEqual(windows, [
    { start: "2027-07-15T14:00:00.000Z", end: "2027-07-15T23:00:00.000Z" },
    { start: "2027-07-16T14:00:00.000Z", end: "2027-07-16T23:00:00.000Z" },
  ]);
});

test("external busy events and buffers remove conflicting slots", () => {
  process.env.CALENDAR_BUSINESS_START_HOUR = "9";
  process.env.CALENDAR_BUSINESS_END_HOUR = "12";
  process.env.CALENDAR_BUSINESS_DAYS = "1,2,3,4,5";
  process.env.CALENDAR_BUFFER_BEFORE_MINUTES = "15";
  process.env.CALENDAR_BUFFER_AFTER_MINUTES = "15";
  process.env.CALENDAR_MINIMUM_NOTICE_MINUTES = "0";
  process.env.CALENDAR_MAXIMUM_RANGE_DAYS = "365";
  const events = [{
    id: "busy-1",
    provider: "composio_google_calendar",
    sourceId: "busy-1",
    title: "Existing event",
    startTime: "2027-07-15T15:00:00.000Z",
    endTime: "2027-07-15T15:30:00.000Z",
    status: "confirmed",
    attendees: [],
  }];
  const slots = availabilitySlotsFromEvents({
    from: "2027-07-15T14:00:00.000Z",
    to: "2027-07-15T17:00:00.000Z",
    durationMinutes: 30,
    timezone: "America/Chicago",
    limit: 20,
  }, events);
  const starts = slots.map((slot) => slot.start);
  assert.ok(starts.includes("2027-07-15T14:00:00.000Z"));
  assert.ok(!starts.includes("2027-07-15T14:30:00.000Z"));
  assert.ok(!starts.includes("2027-07-15T15:00:00.000Z"));
  assert.ok(!starts.includes("2027-07-15T15:30:00.000Z"));
  assert.ok(starts.includes("2027-07-15T16:00:00.000Z"));
});

test("cancelled external events do not block availability", () => {
  process.env.CALENDAR_BUSINESS_START_HOUR = "9";
  process.env.CALENDAR_BUSINESS_END_HOUR = "11";
  process.env.CALENDAR_BUSINESS_DAYS = "1,2,3,4,5";
  process.env.CALENDAR_BUFFER_BEFORE_MINUTES = "0";
  process.env.CALENDAR_BUFFER_AFTER_MINUTES = "0";
  process.env.CALENDAR_MINIMUM_NOTICE_MINUTES = "0";
  process.env.CALENDAR_MAXIMUM_RANGE_DAYS = "365";
  const slots = availabilitySlotsFromEvents({
    from: "2027-07-15T14:00:00.000Z",
    to: "2027-07-15T16:00:00.000Z",
    durationMinutes: 30,
    timezone: "America/Chicago",
  }, [{
    id: "cancelled-1",
    provider: "composio_outlook_calendar",
    sourceId: "cancelled-1",
    title: "Cancelled event",
    startTime: "2027-07-15T15:00:00.000Z",
    endTime: "2027-07-15T15:30:00.000Z",
    status: "cancelled",
    attendees: [],
  }]);
  assert.ok(slots.some((slot) => slot.start === "2027-07-15T15:00:00.000Z"));
});

test("before and after buffers are applied independently", () => {
  process.env.CALENDAR_BUSINESS_START_HOUR = "9";
  process.env.CALENDAR_BUSINESS_END_HOUR = "12";
  process.env.CALENDAR_BUSINESS_DAYS = "1,2,3,4,5";
  process.env.CALENDAR_BUFFER_BEFORE_MINUTES = "5";
  process.env.CALENDAR_BUFFER_AFTER_MINUTES = "20";
  process.env.CALENDAR_MINIMUM_NOTICE_MINUTES = "0";
  process.env.CALENDAR_MAXIMUM_RANGE_DAYS = "365";
  const slots = availabilitySlotsFromEvents({
    from: "2027-07-15T14:00:00.000Z",
    to: "2027-07-15T17:00:00.000Z",
    durationMinutes: 30,
    timezone: "America/Chicago",
    limit: 20,
  }, [{
    id: "busy-2",
    provider: "composio_google_calendar",
    sourceId: "busy-2",
    title: "Existing event",
    startTime: "2027-07-15T15:00:00.000Z",
    endTime: "2027-07-15T15:30:00.000Z",
    status: "confirmed",
    attendees: [],
  }]);

  assert.equal(slots.some((slot) => slot.start === "2027-07-15T14:00:00.000Z"), true);
  assert.equal(slots.some((slot) => slot.start === "2027-07-15T15:30:00.000Z"), false);
  assert.equal(slots.some((slot) => slot.start === "2027-07-15T16:00:00.000Z"), true);
});

test("internal pending or confirmed reservations block shared availability", () => {
  process.env.CALENDAR_BUSINESS_START_HOUR = "9";
  process.env.CALENDAR_BUSINESS_END_HOUR = "12";
  process.env.CALENDAR_BUSINESS_DAYS = "1,2,3,4,5";
  process.env.CALENDAR_BUFFER_BEFORE_MINUTES = "0";
  process.env.CALENDAR_BUFFER_AFTER_MINUTES = "0";
  process.env.CALENDAR_MINIMUM_NOTICE_MINUTES = "0";
  process.env.CALENDAR_MAXIMUM_RANGE_DAYS = "365";
  const slots = availabilitySlotsFromEvents({
    from: "2027-07-15T14:00:00.000Z",
    to: "2027-07-15T17:00:00.000Z",
    durationMinutes: 30,
    timezone: "America/Chicago",
    limit: 20,
  }, [], [{
    start: "2027-07-15T15:00:00.000Z",
    end: "2027-07-15T15:30:00.000Z",
  }]);

  assert.equal(slots.some((slot) => slot.start === "2027-07-15T15:00:00.000Z"), false);
  assert.equal(slots.some((slot) => slot.start === "2027-07-15T15:30:00.000Z"), true);
});
