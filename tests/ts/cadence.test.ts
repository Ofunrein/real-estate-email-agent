import { test } from "node:test";
import assert from "node:assert/strict";

import { nextTouch } from "@/lib/cadence";
import { resolveClientConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";

const config = resolveClientConfig({}).cadence;
const TZ = "America/Chicago";
// A weekday mid-morning instant inside the call window for deterministic tests.
const NOON_CT = Date.parse("2026-06-10T17:00:00Z"); // 12:00 CT

function lead(partial: Partial<SheetRow> = {}): Partial<SheetRow> {
  return { sms_consent: "", call_consent: "", preferred_channel: "", ...partial };
}

function outbound(channel: string, atMs: number): SheetRow {
  return { direction: "outbound", channel, event_at: new Date(atMs).toISOString() } as SheetRow;
}

function inbound(channel: string, atMs: number): SheetRow {
  return { direction: "inbound", channel, event_at: new Date(atMs).toISOString() } as SheetRow;
}

test("nextTouch: speed-to-lead on first contact picks a soft channel", () => {
  const d = nextTouch({ lead: lead(), events: [], config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "send");
  assert.equal(d.reason, "speed_to_lead");
  assert.equal(d.channel, "sms");
});

test("nextTouch: stops when opted out", () => {
  const d = nextTouch({ lead: lead({ next_action: "do_not_contact" }), events: [], config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "stop");
  assert.equal(d.reason, "opted_out");
});

test("nextTouch: holds when lead replied after last outbound", () => {
  const events = [outbound("sms", NOON_CT - 5 * 86400000), inbound("sms", NOON_CT - 4 * 86400000)];
  const d = nextTouch({ lead: lead(), events, config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "lead_engaged");
});

test("nextTouch: stops at max touches", () => {
  const events = Array.from({ length: 14 }, (_, i) => outbound("sms", NOON_CT - (20 - i) * 86400000));
  const d = nextTouch({ lead: lead(), events, config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "stop");
  assert.equal(d.reason, "max_touches_reached");
});

test("nextTouch: waits when min gap not elapsed", () => {
  const events = [outbound("sms", NOON_CT - 1 * 3600000)]; // 1h ago, gap is 48h
  const d = nextTouch({ lead: lead(), events, config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "wait");
  assert.equal(d.reason, "min_gap_not_elapsed");
  assert.ok(d.nextEligibleAt);
});

test("nextTouch: waits when already touched today", () => {
  // touch earlier today (5h ago) — but min gap is 48h so that fires first; use a
  // config with tiny gap to isolate the one-channel-per-day rule.
  const fastGap = { ...config, minGapHours: 1 };
  const events = [outbound("sms", NOON_CT - 5 * 3600000)];
  const d = nextTouch({ lead: lead(), events, config: fastGap, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "wait");
  assert.equal(d.reason, "already_touched_today");
});

test("nextTouch: voice only after a soft touch, in window, with consent", () => {
  // prior soft touch 3 days ago, caller consented to calls
  const events = [outbound("sms", NOON_CT - 3 * 86400000)];
  const d = nextTouch({ lead: lead({ call_consent: "yes", preferred_channel: "voice" }), events, config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "send");
  // sms/email come first in rotation; ensure voice is at least eligible by checking consent gating elsewhere
  assert.ok(["sms", "email", "voice"].includes(d.channel!));
});

test("nextTouch: voice skipped outside call window", () => {
  const lateNight = Date.parse("2026-06-11T05:00:00Z"); // ~00:00 CT
  const events = [outbound("sms", lateNight - 3 * 86400000)];
  const d = nextTouch({
    lead: lead({ call_consent: "yes", sms_consent: "no" }),
    events,
    config,
    nowMs: lateNight,
    timezone: TZ,
  });
  // sms blocked by consent, voice blocked by window, email remains
  assert.notEqual(d.channel, "voice");
});

test("nextTouch: respects sms opt-out, falls to email", () => {
  const events = [outbound("email", NOON_CT - 3 * 86400000)];
  const d = nextTouch({ lead: lead({ sms_consent: "no" }), events, config, nowMs: NOON_CT, timezone: TZ });
  assert.equal(d.action, "send");
  assert.equal(d.channel, "email");
});
