import { test } from "node:test";
import assert from "node:assert/strict";

import { handleAriaToolCalls, handleAriaEndOfCall } from "@/lib/ariaWebhook";

function toolPayload(name: string, args: Record<string, unknown>) {
  return {
    message: {
      type: "tool-calls",
      call: { id: "call_1", customer: { number: "+15125550000" } },
      toolCallList: [{ id: `tc_${name}`, function: { name, arguments: args } }],
    },
  };
}

test("handleAriaToolCalls: records event + returns results body", async () => {
  const recorded: Array<{ aiAction?: string }> = [];
  const body = await handleAriaToolCalls(toolPayload("lookupProperty", { address: "1 A St" }), {
    record: async (input) => {
      recorded.push(input);
      return undefined;
    },
    notify: async () => undefined,
    runTool: async (name) => ({
      result: `did ${name}`,
      ingest: { channel: "voice", agentName: "Iris", aiAction: "property_lookup" },
    }),
  });
  assert.equal(body.results[0].toolCallId, "tc_lookupProperty");
  assert.equal(recorded.length, 1);
});

test("handleAriaToolCalls: notifies on showing_booked, not on lookup", async () => {
  const notified: string[] = [];
  const notify = async (event: { type: string }) => {
    notified.push(event.type);
  };
  await handleAriaToolCalls(toolPayload("scheduleShowing", {}), {
    record: async () => undefined,
    notify,
    runTool: async () => ({ result: "booked", ingest: { channel: "voice", agentName: "Iris", aiAction: "showing_booked" } }),
  });
  await handleAriaToolCalls(toolPayload("lookupProperty", { address: "1 A St" }), {
    record: async () => undefined,
    notify,
    runTool: async () => ({ result: "found", ingest: { channel: "voice", agentName: "Iris", aiAction: "property_lookup" } }),
  });
  assert.deepEqual(notified, ["showing_booked"]);
});

test("handleAriaEndOfCall: notifies on transfer endedReason", async () => {
  const notified: string[] = [];
  await handleAriaEndOfCall(
    {
      message: {
        type: "end-of-call-report",
        call: { id: "call_2", customer: { number: "+15125550000" } },
        endedReason: "assistant-forwarded-call",
        summary: "Transferred to agent.",
        transcript: "...",
      },
    },
    {
      upsertCall: async () => undefined,
      record: async () => undefined,
      notify: async (event) => {
        notified.push(event.type);
      },
    },
  );
  assert.deepEqual(notified, ["transfer_to_human"]);
});

test("handleAriaEndOfCall: persists outbound direction from Vapi call type", async () => {
  let savedDirection = "";
  let recordedDirection = "";
  await handleAriaEndOfCall(
    {
      message: {
        type: "end-of-call-report",
        call: { id: "call_out", type: "outboundPhoneCall", customer: { number: "+15125550000" } },
        summary: "Outbound follow-up completed.",
      },
    },
    {
      upsertCall: async (call) => {
        savedDirection = call.direction || "";
      },
      record: async (input) => {
        recordedDirection = input.direction || "";
      },
      notify: async () => undefined,
    },
  );
  assert.equal(savedDirection, "outbound");
  assert.equal(recordedDirection, "outbound");
});

test("handleAriaEndOfCall: defaults to inbound direction", async () => {
  let savedDirection = "";
  let recordedDirection = "";
  await handleAriaEndOfCall(
    {
      message: {
        type: "end-of-call-report",
        call: { id: "call_in", customer: { number: "+15125550000" } },
      },
    },
    {
      upsertCall: async (call) => {
        savedDirection = call.direction || "";
      },
      record: async (input) => {
        recordedDirection = input.direction || "";
      },
      notify: async () => undefined,
    },
  );
  assert.equal(savedDirection, "inbound");
  assert.equal(recordedDirection, "inbound");
});

test("handleAriaEndOfCall: no notify on normal hangup", async () => {
  const notified: string[] = [];
  await handleAriaEndOfCall(
    {
      message: {
        type: "end-of-call-report",
        call: { id: "call_3", customer: { number: "+15125550000" } },
        endedReason: "customer-ended-call",
      },
    },
    {
      upsertCall: async () => undefined,
      record: async () => undefined,
      notify: async (event) => {
        notified.push(event.type);
      },
    },
  );
  assert.deepEqual(notified, []);
});
