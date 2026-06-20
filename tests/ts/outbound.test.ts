import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateFollowups, outboundAttemptSmsBody, placeOutboundCall, selectVoiceFollowups, sendOutboundAttemptSms, type LeadWithEvents } from "@/lib/outbound";
import { resolveClientConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";

const cadence = resolveClientConfig({}).cadence;
const TZ = "America/Chicago";
const NOON_CT = Date.parse("2026-06-10T17:00:00Z");

function lead(partial: Partial<SheetRow>): SheetRow {
  return { phone: "", email: "", full_name: "", sms_consent: "", call_consent: "", preferred_channel: "", ...partial } as SheetRow;
}

function outbound(channel: string, atMs: number): SheetRow {
  return { direction: "outbound", channel, event_at: new Date(atMs).toISOString() } as SheetRow;
}

test("selectVoiceFollowups: only voice-due leads with a phone", () => {
  const leads: LeadWithEvents[] = [
    // call-consented, soft touch 3d ago, in window -> voice eligible after sms/email tried? rotation puts sms first
    { lead: lead({ phone: "+15125550001", call_consent: "yes", sms_consent: "no", preferred_channel: "voice" }), events: [outbound("email", NOON_CT - 3 * 86400000)] },
    // no consent to call -> not voice
    { lead: lead({ phone: "+15125550002" }), events: [] },
  ];
  const voice = selectVoiceFollowups(leads, cadence, NOON_CT, TZ);
  for (const candidate of voice) {
    assert.equal(candidate.decision.channel, "voice");
    assert.ok(candidate.lead.phone);
  }
});

test("evaluateFollowups: returns a decision per lead", () => {
  const leads: LeadWithEvents[] = [
    { lead: lead({ phone: "+1", next_action: "do_not_contact" }), events: [] },
    { lead: lead({ phone: "+2" }), events: [] },
  ];
  const decisions = evaluateFollowups(leads, cadence, NOON_CT, TZ);
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].decision.action, "stop");
});

test("placeOutboundCall: posts assistant + phone + customer", async () => {
  let body: Record<string, unknown> | null = null;
  const result = await placeOutboundCall(
    { apiKey: "k", assistantId: "a1", phoneNumberId: "p1" },
    { customerNumber: "+15125550000" },
    async (b) => {
      body = b;
      return { ok: true, id: "call_x" };
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.id, "call_x");
  assert.equal(body!.assistantId, "a1");
  assert.equal(body!.phoneNumberId, "p1");
  assert.deepEqual(body!.customer, { number: "+15125550000" });
});

test("placeOutboundCall: missing config fails fast", async () => {
  const result = await placeOutboundCall({ apiKey: "", assistantId: "", phoneNumberId: "" }, { customerNumber: "+1" });
  assert.equal(result.ok, false);
  assert.match(result.error!, /Missing/);
});

test("placeOutboundCall: missing number fails", async () => {
  const result = await placeOutboundCall({ apiKey: "k", assistantId: "a", phoneNumberId: "p" }, { customerNumber: "" });
  assert.equal(result.ok, false);
});

test("outboundAttemptSmsBody: covers the text follow-up channel", () => {
  const body = outboundAttemptSmsBody({
    agentName: "Iris",
    companyName: "Austin Realty",
    callbackNumber: "+15128152032",
    context: "the Mueller listings",
  });
  assert.match(body, /just tried reaching you by phone/i);
  assert.match(body, /Mueller listings/);
  assert.match(body, /\+15128152032/);
});

test("sendOutboundAttemptSms: uses injected sender", async () => {
  let sentTo = "";
  let sentBody = "";
  const result = await sendOutboundAttemptSms("+15125550000", { agentName: "Iris" }, async (to, body) => {
    sentTo = to;
    sentBody = body;
    return { sent: true };
  });
  assert.equal(result.ok, true);
  assert.equal(sentTo, "+15125550000");
  assert.match(sentBody, /Iris/);
});
