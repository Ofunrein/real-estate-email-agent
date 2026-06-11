// In-process smoke test for Aria's tool + call lifecycle, no server/DB/network.
// Feeds simulated Vapi payloads through the real webhook handlers with stubbed
// deps and prints the spoken results + persisted records.
// Run: npm run aria:test
import assert from "node:assert/strict";

import { handleAriaToolCalls, handleAriaEndOfCall } from "../lib/ariaWebhook.ts";

function toolPayload(name, args, { callId = "call_1", phone = "+15125550000" } = {}) {
  return {
    message: {
      type: "tool-calls",
      call: { id: callId, customer: { number: phone } },
      toolCallList: [{ id: `tc_${name}`, function: { name, arguments: args } }],
    },
  };
}

const recorded = [];
const stubRecord = async (input) => {
  recorded.push(input);
  return { event: input, lead: {} };
};

async function run() {
  // Drive runAriaTool with a fully stubbed identity + data layer for determinism.
  const { runAriaTool } = await import("../lib/ariaTools.ts");

  const fakeDeps = {
    resolveCaller: async () => ({
      matched: true,
      lead: { full_name: "Sam Buyer", email: "sam@x.com", property_interest: "123 Main St", lead_role: "buyer" },
      events: [],
      channelsSeen: ["email", "sms"],
      lastTouchAt: "2026-06-01T10:00:00Z",
      needsStitch: false,
    }),
    lookupProperty: async ({ address }) => ({
      properties: [{ address, price: "450000", beds: "3", baths: "2", sqft: "1800", neighborhood: "Mueller" }],
      spoken: `${address} is listed at $450,000, 3 bed, 2 bath, 1,800 square feet, in Mueller.`,
      timedOut: false,
      fromCache: false,
    }),
  };

  const ctx = { phone: "+15125550000", callId: "call_1", threadRef: "voice:call_1" };

  const caller = await runAriaTool("getCallerContext", {}, ctx, fakeDeps);
  console.log("getCallerContext ->", caller.result);
  assert.match(caller.result, /Caller name: Sam Buyer/);
  assert.equal(caller.ingest.aiAction, "caller_matched");

  const lookup = await runAriaTool("lookupProperty", { address: "123 Main St" }, ctx, fakeDeps);
  console.log("lookupProperty ->", lookup.result);
  assert.match(lookup.result, /450,000/);
  assert.equal(lookup.ingest.eventType, "voice_property_lookup");

  const qualify = await runAriaTool(
    "qualifyLead",
    { name: "Sam Buyer", role: "buyer", budget: "$500k", area: "Mueller", call_consent: "yes" },
    ctx,
    fakeDeps,
  );
  console.log("qualifyLead ->", qualify.result);
  assert.equal(qualify.ingest.aiAction, "lead_qualified");
  assert.equal(qualify.ingest.callConsent, "yes");
  assert.equal(qualify.ingest.intent, "buyer_lead");

  // end-of-call-report persistence
  const calls = [];
  const eoc = await handleAriaEndOfCall(
    {
      message: {
        type: "end-of-call-report",
        call: { id: "call_1", customer: { number: "+15125550000" } },
        startedAt: "2026-06-10T17:00:00Z",
        endedAt: "2026-06-10T17:03:20Z",
        endedReason: "customer-ended-call",
        summary: "Caller asked about 123 Main St and was qualified as a buyer.",
        transcript: "AI: Thanks for calling...\nUser: I'm interested in 123 Main St...",
        recordingUrl: "https://recordings.vapi.ai/call_1.mp3",
      },
    },
    {
      upsertCall: async (call) => {
        calls.push(call);
      },
      record: stubRecord,
      notify: async () => undefined,
    },
  );
  console.log("endOfCall ->", `${eoc.duration_sec}s, disposition=${eoc.disposition}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].duration_sec, 200);
  assert.equal(calls[0].recording_url, "https://recordings.vapi.ai/call_1.mp3");
  assert.ok(calls[0].transcript.includes("123 Main St"));

  // Dispatcher: parse a Vapi tool-calls payload and return the results body.
  const dispatchBody = await handleAriaToolCalls(toolPayload("lookupProperty", { address: "123 Main St" }), {
    record: stubRecord,
    notify: async () => undefined,
    runTool: async (name, args, c) => ({
      result: `ran ${name} for ${args.address} on ${c.threadRef}`,
      ingest: { channel: "voice", agentName: "Aria", phone: c.phone, eventType: "voice_property_lookup" },
    }),
  });
  console.log("dispatch ->", JSON.stringify(dispatchBody));
  assert.equal(dispatchBody.results.length, 1);
  assert.equal(dispatchBody.results[0].toolCallId, "tc_lookupProperty");
  assert.match(dispatchBody.results[0].result, /ran lookupProperty for 123 Main St/);

  console.log("\nAria smoke test: PASS");
}

run().catch((error) => {
  console.error("\nAria smoke test: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
