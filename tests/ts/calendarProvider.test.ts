// Calendar provider abstraction + booking integration tests.
// Tests: CalendarProvider resolver, adapter graceful-degradation, slot generation,
// checkAvailability tool chain, and CRM resolver with new providers.
import { test } from "node:test";
import assert from "node:assert/strict";

// ── CalendarProvider resolver ────────────────────────────────────────────────

test("resolver: defaults to neon when no provider configured", async () => {
  const saved = { provider: process.env.CALENDAR_PROVIDER, gcid: process.env.GOOGLE_CLIENT_ID, gsa: process.env.GOOGLE_SERVICE_ACCOUNT_JSON, grt: process.env.GOOGLE_REFRESH_TOKEN, ocid: process.env.OUTLOOK_CLIENT_ID };
  delete process.env.CALENDAR_PROVIDER;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.OUTLOOK_CLIENT_ID;

  const { activeCalendarProviderName } = await import("@/lib/calendar/resolver");
  assert.equal(activeCalendarProviderName(), "neon");

  Object.entries(saved).forEach(([_, v]) => { if (v !== undefined) process.env[_ === "provider" ? "CALENDAR_PROVIDER" : _] = v; });
});

test("resolver: picks google when CALENDAR_PROVIDER=google", async () => {
  process.env.CALENDAR_PROVIDER = "google";
  const { activeCalendarProviderName } = await import("@/lib/calendar/resolver");
  assert.equal(activeCalendarProviderName(), "google");
  delete process.env.CALENDAR_PROVIDER;
});

test("resolver: picks outlook when CALENDAR_PROVIDER=outlook", async () => {
  process.env.CALENDAR_PROVIDER = "outlook";
  const { activeCalendarProviderName } = await import("@/lib/calendar/resolver");
  assert.equal(activeCalendarProviderName(), "outlook");
  delete process.env.CALENDAR_PROVIDER;
});

// ── Google adapter graceful degradation ─────────────────────────────────────

test("google adapter: queryAvailability returns [] without auth (no throw)", async () => {
  const savedCreds = {
    sa: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    rt: process.env.GOOGLE_REFRESH_TOKEN,
    id: process.env.GOOGLE_CLIENT_ID,
    sec: process.env.GOOGLE_CLIENT_SECRET,
  };
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  const { createGoogleCalendarAdapter } = await import("@/lib/calendar/google");
  const adapter = createGoogleCalendarAdapter();
  const slots = await adapter.queryAvailability({
    from: new Date().toISOString(),
    to: new Date(Date.now() + 8 * 3600_000).toISOString(),
    durationMinutes: 30,
    limit: 5,
  });

  assert.ok(Array.isArray(slots));
  assert.equal(slots.length, 0);

  Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_JSON: savedCreds.sa, GOOGLE_REFRESH_TOKEN: savedCreds.rt, GOOGLE_CLIENT_ID: savedCreds.id, GOOGLE_CLIENT_SECRET: savedCreds.sec });
});

test("google adapter: bookAppointment returns {success:false} without auth (no throw)", async () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID;

  const { createGoogleCalendarAdapter } = await import("@/lib/calendar/google");
  const adapter = createGoogleCalendarAdapter();
  const result = await adapter.bookAppointment({
    start: new Date().toISOString(),
    end: new Date(Date.now() + 1800_000).toISOString(),
    timezone: "America/Chicago",
    title: "Test Appointment",
  });

  assert.equal(result.success, false);
  assert.ok(result.error, "Should include error message");
});

// ── Slot generation logic ────────────────────────────────────────────────────

test("slot generation: correctly excludes busy ranges", () => {
  const from = Date.parse("2026-07-01T09:00:00-05:00");
  const to = Date.parse("2026-07-01T12:00:00-05:00");
  const busy = [{ start: Date.parse("2026-07-01T10:00:00-05:00"), end: Date.parse("2026-07-01T10:30:00-05:00") }];
  const dur = 30 * 60_000;
  const step = 30 * 60_000;
  const slots: string[] = [];

  for (let t = from; t + dur <= to; t += step) {
    const overlaps = busy.some((b) => t < b.end && t + dur > b.start);
    if (!overlaps) slots.push(new Date(t).toISOString());
  }

  // 09:00, 09:30, [10:00 BUSY], 10:30, 11:00, 11:30 = 5 slots
  assert.equal(slots.length, 5);
  const busySlot = new Date("2026-07-01T10:00:00-05:00").toISOString();
  assert.ok(!slots.includes(busySlot), "Busy 10:00 slot should be excluded");
});

// ── ariaTools checkAvailability with injected provider ───────────────────────

test("checkAvailability tool: calls queryAvailability dep and returns slots", async () => {
  const { runAriaTool } = await import("@/lib/ariaTools");
  let depCalled = false;
  const fakeSlots = [
    { start: "2026-07-01T14:00:00Z", end: "2026-07-01T14:30:00Z", durationMinutes: 30 },
    { start: "2026-07-01T14:30:00Z", end: "2026-07-01T15:00:00Z", durationMinutes: 30 },
  ];

  const outcome = await runAriaTool(
    "checkAvailability",
    { date: "2026-07-01", timeOfDay: "afternoon" },
    { phone: "+15125550001", callId: "cal_test", threadRef: "voice:cal_test" },
    {
      resolveCaller: async () => ({ matched: false, lead: null, events: [], channelsSeen: [], lastTouchAt: "", needsStitch: false }),
      queryAvailability: async () => { depCalled = true; return fakeSlots; },
      calendarId: "test-cal",
    },
  );

  assert.ok(depCalled, "queryAvailability dep should be invoked");
  assert.equal(outcome.ingest.aiAction, "availability_found");
  assert.ok(outcome.result.length > 0, "Result should be non-empty");
});

test("checkAvailability tool: returns helpful message when no slots", async () => {
  const { runAriaTool } = await import("@/lib/ariaTools");

  const outcome = await runAriaTool(
    "checkAvailability",
    { date: "2026-07-01" },
    { phone: "+15125550002", callId: "cal_test2", threadRef: "voice:cal_test2" },
    {
      resolveCaller: async () => ({ matched: false, lead: null, events: [], channelsSeen: [], lastTouchAt: "", needsStitch: false }),
      queryAvailability: async () => [],
      calendarId: "test-cal",
    },
  );

  assert.equal(outcome.ingest.aiAction, "availability_empty");
  assert.ok(outcome.result.length > 0, "Should return non-empty spoken message");
});

test("checkAvailability tool: degrades gracefully on provider error", async () => {
  const { runAriaTool } = await import("@/lib/ariaTools");

  const outcome = await runAriaTool(
    "checkAvailability",
    { date: "2026-07-01" },
    { phone: "+15125550003", callId: "cal_test3", threadRef: "voice:cal_test3" },
    {
      resolveCaller: async () => ({ matched: false, lead: null, events: [], channelsSeen: [], lastTouchAt: "", needsStitch: false }),
      queryAvailability: async () => { throw new Error("calendar_unavailable"); },
      calendarId: "test-cal",
    },
  );

  assert.equal(outcome.ingest.aiAction, "availability_failed");
  assert.match(outcome.result, /cannot|not.*right now|flag/i, "Should degrade gracefully");
});

// ── CRM resolver: new providers ──────────────────────────────────────────────

test("crm resolver: resolves kvcore adapter when KVCORE_API_KEY set", async () => {
  const { resolveCrmAdapter } = await import("@/lib/crm");
  const adapter = resolveCrmAdapter(
    { crmProvider: "kvcore" } as Parameters<typeof resolveCrmAdapter>[0],
    { KVCORE_API_KEY: "test-key" },
  );
  assert.ok(adapter !== null, "Should resolve kvcore adapter");
  assert.ok(typeof adapter?.upsertContact === "function");
});

test("crm resolver: resolves fub adapter when FUB_API_KEY set", async () => {
  const { resolveCrmAdapter } = await import("@/lib/crm");
  const adapter = resolveCrmAdapter(
    { crmProvider: "fub" } as Parameters<typeof resolveCrmAdapter>[0],
    { FUB_API_KEY: "test-key" },
  );
  assert.ok(adapter !== null, "Should resolve fub adapter");
  assert.ok(typeof adapter?.logActivity === "function");
});

test("crm resolver: returns null when kvcore key missing", async () => {
  const { resolveCrmAdapter } = await import("@/lib/crm");
  const adapter = resolveCrmAdapter(
    { crmProvider: "kvcore" } as Parameters<typeof resolveCrmAdapter>[0],
    {},
  );
  assert.equal(adapter, null, "Should return null without credentials");
});
