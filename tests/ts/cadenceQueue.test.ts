import { test } from "node:test";
import assert from "node:assert/strict";

import { planCadenceQueue, leadIdentity, type CadenceQueueChannel } from "@/lib/cadenceQueue";
import { resolveClientConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";

const config = resolveClientConfig({}).cadence;
const TZ = "America/Chicago";
const NOON_CT = Date.parse("2026-06-10T17:00:00Z");

function lead(partial: Partial<SheetRow> = {}): Partial<SheetRow> {
  return { sms_consent: "", call_consent: "", preferred_channel: "", ...partial };
}

function outbound(channel: string, atMs: number, partial: Partial<SheetRow> = {}): SheetRow {
  return {
    direction: "outbound",
    channel,
    event_at: new Date(atMs).toISOString(),
    ...partial,
  } as SheetRow;
}

function inbound(channel: string, atMs: number, partial: Partial<SheetRow> = {}): SheetRow {
  return {
    direction: "inbound",
    channel,
    event_at: new Date(atMs).toISOString(),
    ...partial,
  } as SheetRow;
}

function plan(rows: { lead: Partial<SheetRow>; events?: SheetRow[] }[], nowMs = NOON_CT) {
  return planCadenceQueue({
    leads: rows.map((row) => ({ lead: row.lead, events: row.events || [] })),
    config,
    nowMs,
    timezone: TZ,
  });
}

test("leadIdentity: prefers normalized phone, then email, then name", () => {
  assert.equal(leadIdentity({ phone: "(512) 555-0189", email: "A@Example.com" }), "phone:15125550189");
  assert.equal(leadIdentity({ email: "A@Example.com" }), "email:a@example.com");
  assert.equal(leadIdentity({ full_name: "  Ada   Buyer " }), "name:ada buyer");
});

test("planCadenceQueue: queues SMS, email, voice, WhatsApp, Messenger, Instagram, and manual human tasks", () => {
  const priorSoftTouch = NOON_CT - 3 * 24 * 60 * 60 * 1000;
  const result = plan([
    { lead: lead({ phone: "+15128460001", preferred_channel: "sms" }) },
    { lead: lead({ email: "email@example.com", preferred_channel: "email" }) },
    {
      lead: lead({ phone: "+15128460002", preferred_channel: "voice", call_consent: "yes" }),
      events: [outbound("sms", priorSoftTouch)],
    },
    { lead: lead({ phone: "+15128460003", preferred_channel: "whatsapp", whatsapp_consent: "yes" }) },
    {
      lead: lead({ full_name: "Messenger Lead", preferred_channel: "messenger" }),
      events: [outbound("messenger", priorSoftTouch, { thread_ref: "psid-1" })],
    },
    {
      lead: lead({ full_name: "Instagram Lead", preferred_channel: "instagram" }),
      events: [outbound("instagram", priorSoftTouch, { thread_ref: "ig-1" })],
    },
    { lead: lead({ email: "manual@example.com", handoff_status: "needs_human" }) },
  ]);

  assert.deepEqual(
    result.tasks.map((task) => task.channel).sort(),
    ["email", "instagram", "manual_human", "messenger", "sms", "voice", "whatsapp"] satisfies CadenceQueueChannel[],
  );
  assert.equal(result.skipped.length, 0);
  assert.equal(result.tasks.find((task) => task.channel === "manual_human")?.reason, "manual_followup_required");
});

test("planCadenceQueue: task IDs are deterministic by lead identity, channel, and local due date", () => {
  const rows = [{ lead: lead({ phone: "+15128460001", preferred_channel: "sms" }) }];
  const first = plan(rows);
  const second = plan(rows);

  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0].id, second.tasks[0].id);
  assert.match(first.tasks[0].id, /^iris-cadence:[a-z0-9]+:sms:2026-06-10$/);
});

test("planCadenceQueue: keeps stop-on-reply and wait decisions as skip reasons", () => {
  const result = plan([
    {
      lead: lead({ phone: "+15128460004" }),
      events: [
        outbound("sms", NOON_CT - 5 * 24 * 60 * 60 * 1000),
        inbound("sms", NOON_CT - 4 * 24 * 60 * 60 * 1000),
      ],
    },
    {
      lead: lead({ phone: "+15128460005" }),
      events: [outbound("sms", NOON_CT - 60 * 60 * 1000)],
    },
  ]);

  assert.equal(result.tasks.length, 0);
  assert.deepEqual(result.skipped.map((skip) => skip.reason), ["lead_engaged", "min_gap_not_elapsed"]);
  assert.ok(result.skipped[1].nextEligibleAt);
});

test("planCadenceQueue: blocks unsafe reserved/test numbers before queueing", () => {
  const result = plan([{ lead: lead({ phone: "+15551234567", preferred_channel: "sms" }) }]);

  assert.equal(result.tasks.length, 0);
  assert.equal(result.skipped[0].channel, "sms");
  assert.equal(result.skipped[0].reason, "missing_or_unsafe_channel_address");
});

test("planCadenceQueue: defers automated touches outside the contact window", () => {
  const midnightCt = Date.parse("2026-06-11T05:00:00Z");
  const result = plan([{ lead: lead({ email: "night@example.com", preferred_channel: "email" }) }], midnightCt);

  assert.equal(result.tasks.length, 0);
  assert.equal(result.skipped[0].channel, "email");
  assert.equal(result.skipped[0].reason, "contact_window_closed");
  assert.ok(result.skipped[0].nextEligibleAt);
});
