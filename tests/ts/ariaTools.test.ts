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
      properties: [{ address, price: "450000", beds: "3", baths: "2", photo_url: "https://photos.zillowstatic.com/fp/one.jpg", listing_url: "https://example.com/listing" } as never],
      spoken: `${address} is listed at $450,000, 3 bed, 2 bath.`,
      timedOut: false,
      fromCache: false,
    }),
    searchProperties: async () => ({
      properties: [{ address: "1 A St", price: "400000", beds: "3", baths: "2", photo_url: "https://photos.zillowstatic.com/fp/two.jpg", listing_url: "https://example.com/1-a" } as never],
      spoken: "I found one option: 1. 1 A St, $400,000, 3 bed, 2 bath. Want details on any of these?",
    }),
    getCrm: () => null,
    calendarId: "cal_1",
    timezone: "America/Chicago",
    queryAvailability: async () => [],
    bookAppointment: async () => ({ success: true, appointment_id: "appt_vapi", neon_id: "neon_vapi", confirmed_time: "Friday, Jun 26 at 2:00 PM" }),
    findUpcomingAppointmentByPhone: async () => null,
    findAppointmentById: async () => null,
    cancelAppointmentById: async () => false,
    rescheduleAppointmentById: async () => null,
    cancelGHLEvent: async () => false,
    rescheduleGHLEvent: async () => ({ success: false, error: "not_configured" }),
    sendSms: async () => undefined,
    notifyBooking: async () => undefined,
    notifyTransfer: async () => undefined,
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

test("lookupProperty: hydrates prior lead memory before lookup", async () => {
  let receivedLead: unknown = null;
  const out = await runAriaTool(
    "lookupProperty",
    { address: "4309 Fairwood Avenue" },
    ctx,
    deps({
      resolveCaller: async () => ({
        matched: true,
        lead: { property_interest: "4309 Fairway Path" } as never,
        events: [],
        channelsSeen: ["sms"],
        lastTouchAt: "2026-06-11T00:00:00Z",
        needsStitch: false,
      }),
      lookupProperty: async ({ lead }) => {
        receivedLead = lead;
        return {
          properties: [],
          spoken: `Using memory for ${lead?.property_interest}`,
          timedOut: false,
          fromCache: false,
        };
      },
    }),
  );
  assert.match(out.result, /4309 Fairway Path/);
  assert.deepEqual(receivedLead, { property_interest: "4309 Fairway Path" });
});

test("lookupProperty: failed lookup does not overwrite known property interest", async () => {
  const out = await runAriaTool(
    "lookupProperty",
    { address: "4309 Fairwood Avenue" },
    { ...ctx, lead: { property_interest: "4309 Fairway Path" } as never },
    deps({
      lookupProperty: async () => ({
        properties: [],
        spoken: "I don't have a confirmed match yet.",
        timedOut: false,
        fromCache: false,
      }),
    }),
  );
  assert.equal(out.ingest.propertyInterest, "4309 Fairway Path");
  assert.doesNotMatch(out.ingest.propertyInterest || "", /Fairwood/);
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

test("checkAvailability: returns available slots from repo calendar stack", async () => {
  let requestedWindow: { from: string; to: string; durationMinutes?: number } | null = null;
  const out = await runAriaTool("checkAvailability", { date: "2026-06-26", timeOfDay: "afternoon" }, ctx, deps({
    queryAvailability: async (input) => {
      requestedWindow = input;
      return [
        { start: "2026-06-26T19:00:00.000Z", end: "2026-06-26T19:30:00.000Z", durationMinutes: 30 },
        { start: "2026-06-26T19:30:00.000Z", end: "2026-06-26T20:00:00.000Z", durationMinutes: 30 },
      ];
    },
  }));
  assert.equal(out.ingest.eventType, "voice_availability_checked");
  assert.equal(out.ingest.aiAction, "availability_found");
  assert.equal(requestedWindow!.durationMinutes, 30);
  assert.match(requestedWindow!.from, /^2026-06-26T17:00:00/);
  assert.match(out.result, /2:00 PM/);
  assert.match(out.result, /Which one works best/);
});

test("checkAvailability: no slots asks for another time", async () => {
  const out = await runAriaTool("checkAvailability", { date: "2026-06-26", timeOfDay: "morning" }, ctx, deps());
  assert.equal(out.ingest.aiAction, "availability_empty");
  assert.equal(out.ingest.status, "not_found");
  assert.match(out.result, /another time/);
});

test("bookConsultation: maps Vapi appointment shape into server appointment booking", async () => {
  let booked: { date?: string; time?: string; appointment_type?: string } | null = null;
  const out = await runAriaTool("bookConsultation", {
    appointmentTime: "2026-06-26T19:00:00.000Z",
    callerName: "Sam Lee",
    callerPhone: "+15125550000",
    callerEmail: "sam@example.com",
    propertyAddress: "123 Main St",
  }, ctx, deps({
    bookAppointment: async (input) => {
      booked = input;
      return { success: true, appointment_id: "appt_1", neon_id: "neon_1", confirmed_time: "Friday, Jun 26 at 2:00 PM" };
    },
  }));
  assert.equal(booked!.date, "2026-06-26");
  assert.equal(booked!.time, "2:00 PM");
  assert.equal(booked!.appointment_type, "consultation");
  assert.equal(out.ingest.aiAction, "appointment_booked");
  assert.equal(out.ingest.appointmentId, "neon_1");
});

test("sendPropertyDetailsSms: sends listing details and photo media", async () => {
  let sent: { to: string; body: string; mediaUrls?: string[] } | null = null;
  let logged: Parameters<NonNullable<AriaToolDeps["recordSms"]>>[0] | null = null;
  const out = await runAriaTool("sendPropertyDetailsSms", { address: "123 Main St", query: "send photos" }, ctx, deps({
    sendSms: async (to, body, mediaUrls) => {
      sent = { to, body, mediaUrls };
      return { sent: true, skipped: false, error: "" };
    },
    recordSms: async (input) => {
      logged = input;
    },
  }));

  assert.equal(out.ingest.eventType, "voice_property_details_sms");
  assert.equal(out.ingest.aiAction, "property_details_sms_sent_with_photos");
  assert.equal(sent!.to, ctx.phone);
  assert.match(sent!.body, /123 Main St/);
  assert.deepEqual(sent!.mediaUrls, ["https://photos.zillowstatic.com/fp/one.jpg"]);
  assert.equal(logged!.channel, "sms");
  assert.equal(logged!.direction, "outbound");
  assert.equal(logged!.threadRef, `sms:${ctx.phone}`);
  assert.match(logged!.messageText || "", /MMS image:/);
  assert.match(out.result, /texted the listing details and photos/);
});

test("sendPropertyDetailsSms: searches when no exact address was selected", async () => {
  let searched = "";
  const out = await runAriaTool("sendPropertyDetailsSms", { query: "condos downtown under 900k" }, ctx, deps({
    searchProperties: async ({ query }) => {
      searched = query || "";
      return {
        properties: [{ address: "70 Rainey St #1509", price: "750000", beds: "2", baths: "2", listing_url: "https://example.com/70" } as never],
        spoken: "found",
        timedOut: false,
        fromCache: true,
      };
    },
  }));

  assert.equal(searched, "condos downtown under 900k");
  assert.equal(out.ingest.aiAction, "property_details_sms_sent");
  assert.match(out.ingest.summary || "", /70 Rainey/);
});

test("qualifyLead: captures fields, normalizes consent + intent", async () => {
  const out = await runAriaTool(
    "qualifyLead",
    {
      name: "Sam Lee",
      email: "SAM@X.com",
      role: "seller",
      budget: "$600k",
      area: "Mueller",
      timeline: "60 days",
      bedrooms: "3 bed",
      bathrooms: "2.5 bath",
      preferred_channel: "email",
      call_consent: "sure",
      sms_consent: "no",
    },
    ctx,
    deps(),
  );
  assert.equal(out.ingest.leadRole, "seller");
  assert.equal(out.ingest.intent, "seller_lead");
  assert.equal(out.ingest.email, "sam@x.com");
  assert.equal(out.ingest.callConsent, "yes");
  assert.equal(out.ingest.smsConsent, "no");
  assert.equal(out.ingest.preferredChannel, "email");
  assert.equal(out.ingest.aiAction, "lead_qualified");
  assert.match(out.ingest.summary || "", /beds=3 bed/);
  assert.match(out.ingest.summary || "", /baths=2.5 bath/);
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

test("every tool tags channel voice + Iris", async () => {
  for (const [name, args] of [["getCallerContext", {}], ["lookupProperty", { address: "1 A St" }], ["sendPropertyDetailsSms", { address: "1 A St", query: "send details" }], ["qualifyLead", {}]] as const) {
    const out = await runAriaTool(name, args, ctx, deps());
    assert.equal(out.ingest.channel, "voice");
    assert.equal(out.ingest.agentName, "Iris");
    assert.equal(out.ingest.phone, ctx.phone);
  }
});
