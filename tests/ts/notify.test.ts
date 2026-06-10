import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyUrgency,
  decideNotification,
  dedupeKey,
  inQuietHours,
  notifyAgent,
  type NotifyEvent,
} from "@/lib/notify";
import { resolveClientConfig } from "@/lib/clientConfig";

const config = resolveClientConfig({}).notify; // quiet 21->8, preferred sms

test("classifyUrgency: tiers", () => {
  assert.equal(classifyUrgency("transfer_to_human"), "interrupt");
  assert.equal(classifyUrgency("showing_booked"), "digest");
  assert.equal(classifyUrgency("property_lookup"), "none");
});

test("inQuietHours: wraps midnight (21 -> 8)", () => {
  assert.equal(inQuietHours(22, config), true);
  assert.equal(inQuietHours(3, config), true);
  assert.equal(inQuietHours(8, config), false);
  assert.equal(inQuietHours(12, config), false);
});

test("decideNotification: interrupt during day -> sms", () => {
  const d = decideNotification({ type: "transfer_to_human", leadPhone: "+1" }, config, { localHour: 12, dayKey: "2026-06-10" });
  assert.equal(d.deliver, true);
  assert.equal(d.channel, "sms");
  assert.equal(d.tier, "interrupt");
});

test("decideNotification: interrupt during quiet hours -> dashboard", () => {
  const d = decideNotification({ type: "transfer_to_human", leadPhone: "+1" }, config, { localHour: 23, dayKey: "2026-06-10" });
  assert.equal(d.channel, "dashboard");
  assert.equal(d.reason, "interrupt_quiet_hours_to_digest");
});

test("decideNotification: digest -> dashboard", () => {
  const d = decideNotification({ type: "showing_booked" }, config, { localHour: 12, dayKey: "2026-06-10" });
  assert.equal(d.channel, "dashboard");
  assert.equal(d.tier, "digest");
});

test("decideNotification: non-notifiable -> no deliver", () => {
  const d = decideNotification({ type: "property_lookup" }, config, { localHour: 12, dayKey: "2026-06-10" });
  assert.equal(d.deliver, false);
});

test("decideNotification: dedupes within recentKeys", () => {
  const event: NotifyEvent = { type: "transfer_to_human", leadPhone: "+15125550000" };
  const key = dedupeKey(event, "2026-06-10");
  const d = decideNotification(event, config, { localHour: 12, dayKey: "2026-06-10", recentKeys: new Set([key]) });
  assert.equal(d.deliver, false);
  assert.equal(d.reason, "deduped");
});

test("notifyAgent: interrupt sends via injected sender; digest records", async () => {
  let interrupts = 0;
  let digests = 0;
  const deps = {
    sendInterrupt: async () => {
      interrupts += 1;
      return { sent: true, skipped: false, sid: "x", error: "", mediaCount: 0 };
    },
    recordDigest: async () => {
      digests += 1;
    },
  };
  await notifyAgent({ type: "transfer_to_human", leadPhone: "+1" }, config, { localHour: 12, dayKey: "d" }, deps);
  await notifyAgent({ type: "showing_booked" }, config, { localHour: 12, dayKey: "d" }, deps);
  assert.equal(interrupts, 1);
  assert.equal(digests, 1);
});
