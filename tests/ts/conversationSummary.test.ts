import { test } from "node:test";
import assert from "node:assert/strict";

import { buildConversationSummary, customFieldFromConversationSummary } from "@/lib/conversationSummary";
import type { SheetRow } from "@/lib/sheetSchema";

function row(overrides: Partial<SheetRow>): SheetRow {
  return {
    event_at: "",
    channel: "",
    direction: "",
    email: "",
    phone: "",
    full_name: "",
    source: "",
    thread_ref: "",
    agent_name: "",
    human_owner: "",
    event_type: "message",
    message_text: "",
    summary: "",
    transcript_url: "",
    recording_url: "",
    ai_action: "",
    handoff_reason: "",
    status: "",
    call_duration_seconds: "",
    appointment_id: "",
    outcome_code: "",
    mailbox_email: "",
    gmail_thread_id: "",
    gmail_message_id: "",
    thread_status: "",
    provider_message_id: "",
    provider_thread_id: "",
    media_json: "[]",
    provider_metadata: "{}",
    reply_job_id: "",
    ...overrides,
  };
}

test("buildConversationSummary: summarizes cross-channel buyer/showing lead", () => {
  const summary = buildConversationSummary({
    events: [
      row({ channel: "instagram", direction: "inbound", full_name: "Maya", message_text: "Is this listing available? I want something like this reel." }),
      row({ channel: "sms", direction: "outbound", phone: "+15125550111", message_text: "Yes. I can send similar Austin homes here. Any must-haves?" }),
      row({ channel: "sms", direction: "inbound", message_text: "Saturday morning works for a showing" }),
    ],
    contact: { email: "maya@example.com" },
  });

  assert.equal(summary.eventCount, 3);
  assert.deepEqual(summary.channels, ["instagram", "sms"]);
  assert.equal(summary.intent, "showing or appointment request");
  assert.equal(summary.appointmentStatus, "requested, not confirmed");
  assert.match(summary.text, /Austin Realty conversation summary/);
  assert.match(summary.text, /Latest inbound: Saturday morning works/);
  assert.match(summary.text, /offer exact showing slots/i);
});

test("buildConversationSummary: scheduled appointment wins over request wording", () => {
  const summary = buildConversationSummary({
    events: [
      row({ channel: "whatsapp", direction: "inbound", message_text: "Can I get a valuation?" }),
      row({ channel: "voice", direction: "outbound", appointment_id: "appt_1", message_text: "Booked valuation call." }),
    ],
  });

  assert.equal(summary.intent, "seller valuation/listing lead");
  assert.equal(summary.appointmentStatus, "scheduled");
});

test("customFieldFromConversationSummary: prefers field id over field key", () => {
  const summary = buildConversationSummary({ events: [row({ channel: "sms", direction: "inbound", message_text: "Hi" })] });
  const field = customFieldFromConversationSummary(summary, { fieldId: "cf_123", fieldKey: "conversation_summary" });
  assert.equal(field.id, "cf_123");
  assert.equal("key" in field, false);
  assert.match(field.fieldValue, /Austin Realty/);
});
