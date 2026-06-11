import { test } from "node:test";
import assert from "node:assert/strict";

import { runAriaTool, type AriaToolDeps } from "@/lib/ariaTools";
import type { CallerIdentity } from "@/lib/identity";

const ctx = { phone: "+15125550000", callId: "call_1", threadRef: "voice:call_1" };

function deps(overrides: Partial<AriaToolDeps> = {}): AriaToolDeps {
  return {
    resolveCaller: async (): Promise<CallerIdentity> => ({
      matched: false,
      lead: null,
      events: [],
      channelsSeen: [],
      lastTouchAt: "",
      needsStitch: true,
    }),
    lookupProperty: async ({ address }) => ({
      properties: [],
      spoken: `${address} is listed at $450,000, 3 bed, 2 bath.`,
      timedOut: false,
      fromCache: false,
    }),
    searchProperties: async () => ({
      properties: [{ address: "1 A St" } as never],
      spoken: "I found one option: 1. 1 A St, $400,000, 3 bed, 2 bath. Want details on any of these?",
    }),
    getCrm: () => null,
    calendarId: "cal_1",
    timezone: "America/Chicago",
    ...overrides,
  };
}

test("getCallerContext: returning caller summary + matched action", async () => {
  const out = await runAriaTool("getCallerContext", {}, ctx, deps({
    resolveCaller: async () => ({
      matched: true,
      lead: { full_name: "Sam Lee", email: "sam@x.com", property_interest: "123 Main St", lead_role: "buyer" } as never,
      events: [],
      channelsSeen: ["email", "sms"],
      lastTouchAt: "2026-06-01T10:00:00Z",
      needsStitch: false,
    }),
  }));
  assert.match(out.result, /Caller name: Sam Lee/);
  assert.match(out.result, /email, sms/);
  assert.equal(out.ingest.aiAction, "caller_matched");
  assert.equal(out.ingest.fullName, "Sam Lee");
});

test("getCallerContext: unknown caller", async () => {
  const out = await runAriaTool("getCallerContext", {}, ctx, deps());
  assert.match(out.result, /No prior record/);
  assert.equal(out.ingest.aiAction, "caller_unknown");
});

test("lookupProperty: relays spoken result + logs event", async () => {
  const out = await runAriaTool("lookupProperty", { address: "123 Main St" }, ctx, deps());
  assert.match(out.result, /\$450,000/);
  assert.equal(out.ingest.eventType, "voice_property_lookup");
  assert.equal(out.ingest.propertyInterest, "123 Main St");
  assert.equal(out.ingest.aiAction, "property_lookup");
});

test("lookupProperty: timeout sets async-sms action", async () => {
  const out = await runAriaTool("lookupProperty", { address: "9 Oak" }, ctx, deps({
    lookupProperty: async ({ address }) => ({ properties: [], spoken: `pulling up ${address}`, timedOut: true, fromCache: false }),
  }));
  assert.equal(out.ingest.aiAction, "property_lookup_async_sms");
});

test("searchProperties: relays matches + results action", async () => {
  const out = await runAriaTool("searchProperties", { area: "Mueller", beds: 3, maxPrice: 500000 }, ctx, deps());
  assert.match(out.result, /found one option/);
  assert.equal(out.ingest.eventType, "voice_property_search");
  assert.equal(out.ingest.aiAction, "property_search_results");
});

test("searchProperties: empty result action", async () => {
  const out = await runAriaTool("searchProperties", { area: "Nowhere" }, ctx, deps({
    searchProperties: async () => ({ properties: [], spoken: "I don't see matching listings right now." }),
  }));
  assert.equal(out.ingest.aiAction, "property_search_empty");
});

test("qualifyLead: captures fields, normalizes consent + intent", async () => {  const out = await runAriaTool(
    "qualifyLead",
    { name: "Sam Lee", email: "SAM@X.com", role: "seller", budget: "$600k", area: "Mueller", timeline: "60 days", call_consent: "sure", sms_consent: "no" },
    ctx,
    deps(),
  );
  assert.equal(out.ingest.leadRole, "seller");
  assert.equal(out.ingest.intent, "seller_lead");
  assert.equal(out.ingest.email, "sam@x.com");
  assert.equal(out.ingest.callConsent, "yes");
  assert.equal(out.ingest.smsConsent, "no");
  assert.equal(out.ingest.aiAction, "lead_qualified");
  assert.match(out.result, /seller/);
});

test("unknown tool: safe error outcome", async () => {
  const out = await runAriaTool("frobnicate", {}, ctx, deps());
  assert.match(out.result, /Unknown tool/);
  assert.equal(out.ingest.status, "error");
});

function fakeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    provider: "fake",
    findContactByPhone: async () => ({ id: "c1" }),
    findContactByEmail: async () => ({ id: "c1" }),
    upsertContact: async () => ({ id: "c1" }),
    listAppointments: async () => [],
    createAppointment: async (input: { contactId: string; startTime: string }) => ({ id: "appt1", contactId: input.contactId, startTime: input.startTime }),
    updateAppointment: async (id: string, u: { startTime?: string }) => ({ id, contactId: "c1", startTime: u.startTime || "" }),
    cancelAppointment: async () => undefined,
    logActivity: async () => undefined,
    ...overrides,
  } as never;
}

test("scheduleShowing: unavailable when no CRM", async () => {
  const out = await runAriaTool("scheduleShowing", { startTime: "2026-06-12T19:00:00Z" }, ctx, deps({ getCrm: () => null }));
  assert.equal(out.ingest.aiAction, "scheduling_unavailable");
});

test("scheduleShowing: books with CRM + calendar", async () => {
  let created: { calendarId?: string; contactId?: string } | null = null;
  const out = await runAriaTool(
    "scheduleShowing",
    { startTime: "2026-06-12T19:00:00Z", address: "123 Main St", name: "Sam" },
    ctx,
    deps({ getCrm: () => fakeAdapter({ createAppointment: async (input: { calendarId: string; contactId: string; startTime: string }) => { created = input; return { id: "appt1", contactId: input.contactId, startTime: input.startTime }; } }) }),
  );
  assert.equal(out.ingest.aiAction, "showing_booked");
  assert.equal(created!.calendarId, "cal_1");
  assert.equal(created!.contactId, "c1");
  assert.match(out.result, /booked/i);
});

test("scheduleShowing: book without time asks for one", async () => {
  const out = await runAriaTool("scheduleShowing", {}, ctx, deps({ getCrm: () => fakeAdapter() }));
  assert.equal(out.ingest.aiAction, "showing_needs_time");
});

test("scheduleShowing: cancel uses next upcoming", async () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  let cancelled = "";
  const out = await runAriaTool(
    "scheduleShowing",
    { action: "cancel" },
    ctx,
    deps({ getCrm: () => fakeAdapter({
      listAppointments: async () => [{ id: "appt9", contactId: "c1", startTime: future }],
      cancelAppointment: async (id: string) => { cancelled = id; },
    }) }),
  );
  assert.equal(cancelled, "appt9");
  assert.equal(out.ingest.aiAction, "showing_cancelled");
});

test("scheduleShowing: needs identity when phone + email missing", async () => {
  const out = await runAriaTool("scheduleShowing", { startTime: "2026-06-12T19:00:00Z" }, { ...ctx, phone: "" }, deps({ getCrm: () => fakeAdapter() }));
  assert.equal(out.ingest.aiAction, "scheduling_needs_identity");
});

test("syncToCrm: upserts + logs note", async () => {
  let logged: { contactId?: string; body?: string } | null = null;
  const out = await runAriaTool(
    "syncToCrm",
    { name: "Sam", email: "sam@x.com", note: "Asked about 123 Main St" },
    ctx,
    deps({ getCrm: () => fakeAdapter({ logActivity: async (a: { contactId: string; body: string }) => { logged = a; } }) }),
  );
  assert.equal(out.ingest.aiAction, "crm_synced");
  assert.equal(logged!.contactId, "c1");
  assert.match(logged!.body!, /123 Main St/);
});

test("syncToCrm: skipped without CRM", async () => {
  const out = await runAriaTool("syncToCrm", {}, ctx, deps({ getCrm: () => null }));
  assert.equal(out.ingest.aiAction, "crm_sync_skipped");
});

test("every tool tags channel voice + Aria", async () => {
  for (const [name, args] of [["getCallerContext", {}], ["lookupProperty", { address: "1 A St" }], ["qualifyLead", {}]] as const) {
    const out = await runAriaTool(name, args, ctx, deps());
    assert.equal(out.ingest.channel, "voice");
    assert.equal(out.ingest.agentName, "Aria");
    assert.equal(out.ingest.phone, ctx.phone);
  }
});
