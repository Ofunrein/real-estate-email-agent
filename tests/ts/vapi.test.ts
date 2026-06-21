import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatToolResults,
  messageType,
  parseCallMeta,
  parseEndOfCallReport,
  parseToolCalls,
} from "@/lib/vapi";

test("parseToolCalls: new tool-calls shape with JSON-string arguments", () => {
  const calls = parseToolCalls({
    message: {
      type: "tool-calls",
      toolCallList: [
        { id: "tc_1", function: { name: "lookupProperty", arguments: '{"address":"123 Main St"}' } },
      ],
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "tc_1");
  assert.equal(calls[0].name, "lookupProperty");
  assert.equal(calls[0].args.address, "123 Main St");
});

test("parseToolCalls: object arguments and toolCalls alias", () => {
  const calls = parseToolCalls({
    message: { type: "tool-calls", toolCalls: [{ id: "x", function: { name: "qualifyLead", arguments: { role: "buyer" } } }] },
  });
  assert.equal(calls[0].name, "qualifyLead");
  assert.equal(calls[0].args.role, "buyer");
});

test("parseToolCalls: singular Vapi toolCall shape", () => {
  const calls = parseToolCalls({
    message: { type: "tool-calls", toolCall: { id: "single_1", function: { name: "getCallerContext", arguments: {} } } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "single_1");
  assert.equal(calls[0].name, "getCallerContext");
});

test("parseToolCalls: legacy function-call shape", () => {
  const calls = parseToolCalls({
    message: { type: "function-call", toolCallId: "leg_1", functionCall: { name: "getCallerContext", parameters: {} } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "getCallerContext");
  assert.equal(calls[0].id, "leg_1");
});

test("parseToolCalls: empty when no calls", () => {
  assert.deepEqual(parseToolCalls({ message: { type: "status-update" } }), []);
});

test("messageType: reads message.type then top-level", () => {
  assert.equal(messageType({ message: { type: "end-of-call-report" } }), "end-of-call-report");
  assert.equal(messageType({ type: "status-update" }), "status-update");
});

test("parseCallMeta: phone + thread ref", () => {
  const meta = parseCallMeta({ message: { call: { id: "call_9", customer: { number: "+15125550000" } } } });
  assert.equal(meta.callId, "call_9");
  assert.equal(meta.phone, "+15125550000");
  assert.equal(meta.threadRef, "voice:call_9");
});

test("parseEndOfCallReport: builds transcript from artifact messages", () => {
  const report = parseEndOfCallReport({
    message: {
      type: "end-of-call-report",
      call: { id: "call_2", customer: { number: "+15125550001" } },
      artifact: {
        messages: [
          { role: "assistant", message: "Hello!" },
          { role: "user", message: "Need a showing." },
        ],
      },
    },
  });
  assert.match(report.transcript, /AI: Hello!/);
  assert.match(report.transcript, /User: Need a showing/);
});

test("parseEndOfCallReport: computes duration from timestamps", () => {
  const report = parseEndOfCallReport({
    message: {
      type: "end-of-call-report",
      call: { id: "call_1", type: "inboundPhoneCall", customer: { number: "+15125550000" } },
      startedAt: "2026-06-10T17:00:00Z",
      endedAt: "2026-06-10T17:03:20Z",
      endedReason: "customer-ended-call",
      summary: "Discussed 123 Main St.",
      transcript: "AI: hi\nUser: 123 Main St",
      recordingUrl: "https://rec/call_1.mp3",
    },
  });
  assert.equal(report.callId, "call_1");
  assert.equal(report.direction, "inbound");
  assert.equal(report.durationSec, 200);
  assert.equal(report.endedReason, "customer-ended-call");
  assert.equal(report.recordingUrl, "https://rec/call_1.mp3");
});

test("parseEndOfCallReport: detects outbound from call type", () => {
  const report = parseEndOfCallReport({
    message: {
      type: "end-of-call-report",
      call: { id: "call_out", type: "outboundPhoneCall", customer: { number: "+15125550000" } },
    },
  });
  assert.equal(report.direction, "outbound");
});

test("parseEndOfCallReport: detects outbound from metadata fallback", () => {
  const report = parseEndOfCallReport({
    message: {
      type: "end-of-call-report",
      call: { id: "call_meta", customer: { number: "+15125550000" }, metadata: { direction: "outbound" } },
    },
  });
  assert.equal(report.direction, "outbound");
});

test("parseEndOfCallReport: prefers explicit duration", () => {
  const report = parseEndOfCallReport({ message: { durationSeconds: 42, call: { id: "c" } } });
  assert.equal(report.durationSec, 42);
});

test("formatToolResults: maps id to toolCallId", () => {
  assert.deepEqual(formatToolResults([{ id: "a", result: "ok" }]), {
    results: [{ toolCallId: "a", result: "ok" }],
  });
});
