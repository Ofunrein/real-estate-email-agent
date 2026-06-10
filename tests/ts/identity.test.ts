import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildConfirmation,
  chooseStitchCandidate,
  confirmationMatches,
  lastTouchAt,
  resolveCaller,
  stitchByEmailOrName,
  summarizeChannels,
  type IdentityDeps,
} from "@/lib/identity";
import type { SheetRow } from "@/lib/sheetSchema";

function lead(partial: Partial<SheetRow>): SheetRow {
  return { email: "", phone: "", full_name: "", ...partial } as SheetRow;
}

function event(partial: Partial<SheetRow>): SheetRow {
  return { channel: "", event_at: "", ...partial } as SheetRow;
}

test("summarizeChannels: distinct, most-used first", () => {
  const events = [
    event({ channel: "email" }),
    event({ channel: "sms" }),
    event({ channel: "sms" }),
    event({ channel: "" }),
  ];
  assert.deepEqual(summarizeChannels(events), ["sms", "email"]);
});

test("lastTouchAt: returns latest timestamp", () => {
  const events = [
    event({ event_at: "2026-06-01T10:00:00Z" }),
    event({ event_at: "2026-06-09T08:00:00Z" }),
    event({ event_at: "2026-05-20T00:00:00Z" }),
  ];
  assert.equal(lastTouchAt(events), "2026-06-09T08:00:00Z");
});

test("buildConfirmation: picks first available safe detail", () => {
  assert.deepEqual(buildConfirmation(lead({ area: "Mueller", budget: "500k" })), {
    field: "area",
    value: "Mueller",
    question: "What area were you looking in?",
  });
  assert.equal(buildConfirmation(lead({})), null);
  assert.equal(buildConfirmation(null), null);
});

test("confirmationMatches: fuzzy substring both directions", () => {
  assert.ok(confirmationMatches("123 Main St", "main st"));
  assert.ok(confirmationMatches("Mueller", "the mueller area"));
  assert.ok(!confirmationMatches("Mueller", "downtown"));
  assert.ok(!confirmationMatches("", "anything"));
});

test("chooseStitchCandidate: email beats name beats first", () => {
  const a = lead({ email: "a@x.com", full_name: "Sam Lee" });
  const b = lead({ email: "b@x.com", full_name: "Sam Lee" });
  assert.equal(chooseStitchCandidate([a, b], { email: "b@x.com" }), b);
  assert.equal(chooseStitchCandidate([a, b], { name: "Sam Lee" }), a);
  assert.equal(chooseStitchCandidate([a, b], {}), a);
  assert.equal(chooseStitchCandidate([], { email: "x@x.com" }), null);
});

test("resolveCaller: phone match returns cross-channel history", async () => {
  const matched = lead({ phone: "+15125550000", email: "buyer@x.com", area: "Mueller" });
  const events = [event({ channel: "email", event_at: "2026-06-01T10:00:00Z" })];
  const deps: IdentityDeps = {
    findLead: async () => matched,
    readEvents: async () => events,
  };
  const result = await resolveCaller("5125550000", deps);
  assert.equal(result.matched, true);
  assert.equal(result.needsStitch, false);
  assert.equal(result.lead, matched);
  assert.deepEqual(result.channelsSeen, ["email"]);
  assert.equal(result.lastTouchAt, "2026-06-01T10:00:00Z");
});

test("resolveCaller: cold phone needs stitch", async () => {
  let readCalled = false;
  const deps: IdentityDeps = {
    findLead: async () => null,
    readEvents: async () => {
      readCalled = true;
      return [];
    },
  };
  const result = await resolveCaller("5125559999", deps);
  assert.equal(result.matched, false);
  assert.equal(result.needsStitch, true);
  assert.equal(result.lead, null);
  assert.equal(readCalled, false, "no event read when no lead");
});

test("resolveCaller: empty phone does not query", async () => {
  let findCalled = false;
  const deps: IdentityDeps = {
    findLead: async () => {
      findCalled = true;
      return null;
    },
    readEvents: async () => [],
  };
  const result = await resolveCaller("", deps);
  assert.equal(findCalled, false);
  assert.equal(result.needsStitch, true);
});

test("stitchByEmailOrName: finds by email and returns confirmation", async () => {
  const found = lead({ email: "buyer@x.com", full_name: "Sam Lee", property_interest: "123 Main St" });
  const deps: IdentityDeps = {
    findLead: async (incoming) => (incoming.email ? found : null),
    readEvents: async () => [event({ channel: "sms" })],
  };
  const result = await stitchByEmailOrName({ email: "buyer@x.com" }, deps);
  assert.equal(result.lead, found);
  assert.deepEqual(result.confirm, {
    field: "property_interest",
    value: "123 Main St",
    question: "Which property were you asking about?",
  });
  assert.deepEqual(summarizeChannels(result.events), ["sms"]);
});

test("stitchByEmailOrName: falls back to name when no email hit", async () => {
  const found = lead({ full_name: "Sam Lee", area: "Mueller" });
  const deps: IdentityDeps = {
    findLead: async (incoming) => (incoming.full_name ? found : null),
    readEvents: async () => [],
  };
  const result = await stitchByEmailOrName({ name: "Sam Lee" }, deps);
  assert.equal(result.lead, found);
  assert.equal(result.confirm?.field, "area");
});

test("stitchByEmailOrName: no match returns null lead and confirm", async () => {
  const deps: IdentityDeps = {
    findLead: async () => null,
    readEvents: async () => [],
  };
  const result = await stitchByEmailOrName({ email: "nobody@x.com" }, deps);
  assert.equal(result.lead, null);
  assert.equal(result.confirm, null);
});
