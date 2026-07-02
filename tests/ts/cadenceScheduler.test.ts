import { test } from "node:test";
import assert from "node:assert/strict";

import { planCadenceForLead } from "@/lib/cadenceScheduler";
import type { SheetRow } from "@/lib/sheetSchema";

const nowMs = Date.parse("2026-06-10T17:00:00Z");

test("planCadenceForLead produces durable speed-to-lead task from lead state", () => {
  const plan = planCadenceForLead({
    lead: { phone: "+15128460199", preferred_channel: "sms", sms_consent: "lead_form" },
    events: [],
    nowMs,
    timezone: "America/Chicago",
  });
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].channel, "sms");
  assert.equal(plan.tasks[0].reason, "speed_to_lead");
});

test("planCadenceForLead holds when lead replied after outbound", () => {
  const events = [
    { direction: "outbound", channel: "sms", event_at: "2026-06-09T17:00:00Z" } as SheetRow,
    { direction: "inbound", channel: "sms", event_at: "2026-06-09T18:00:00Z" } as SheetRow,
  ];
  const plan = planCadenceForLead({ lead: { phone: "+15128460199" }, events, nowMs, timezone: "America/Chicago" });
  assert.equal(plan.tasks.length, 0);
  assert.equal(plan.skipped[0].reason, "lead_engaged");
});
