import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLeadContextEnvelope, leadCaptureDedupeKey, renderChannelReply, type LeadCapturePayload } from "@/lib/leadContext";
import { runIrisConversationBrain } from "@/lib/irisConversationBrain";

const capture: LeadCapturePayload = {
  provider: "meta",
  source_type: "lead_ad",
  source_id: "lead-123",
  campaign: { name: "South Austin" },
  clicked_property: { address: "123 Main Street", requested: ["price", "photos"] },
  lead: { name: "Sam", phone: "+15125550100", budget: "500000", area: "South Austin" },
  behavior: { action: "viewed_photos" },
  consent: { sms: "yes" },
};

test("lead capture dedupe key is stable and accepts explicit idempotency", () => {
  assert.equal(leadCaptureDedupeKey(capture), leadCaptureDedupeKey({ ...capture }));
  assert.equal(leadCaptureDedupeKey(capture, "request-1"), "request-1");
});

test("context envelope merges durable lead and raw acquisition context", () => {
  const context = buildLeadContextEnvelope({
    channel: "sms",
    threadRef: "meta:lead-123",
    provider: "meta",
    lead: { full_name: "Sam", phone: "+15125550100", budget: "500000", area: "South Austin", sms_consent: "yes" },
    events: [{ direction: "inbound", message_text: "Can I see photos?", channel: "sms" }],
    providerMetadata: { source_type: capture.source_type, source_id: capture.source_id, campaign: capture.campaign, clicked_property: capture.clicked_property, behavior: capture.behavior },
  });
  assert.equal(context.property.address, "123 Main Street");
  assert.equal(context.source.sourceType, "lead_ad");
  assert.equal(context.profile.budget, "500000");
  assert.equal(context.conversation.recentEvents.length, 1);
  assert.equal(context.fingerprint.length, 64);
});

test("shared brain stops opt-outs and never drafts a reply", () => {
  const context = buildLeadContextEnvelope({ channel: "sms", threadRef: "sms:1", lead: { do_not_contact: "yes" } });
  const result = runIrisConversationBrain({ channel: "sms", threadRef: "sms:1", latestMessage: "STOP", events: [], context });
  assert.equal(result.decision, "stop");
  assert.equal(result.draft, "");
  assert.equal(result.safe_to_auto_send, false);
});

test("shared brain gives safe help but alerts human for sensitive requests", () => {
  const context = buildLeadContextEnvelope({ channel: "instagram", threadRef: "ig:1" });
  const result = runIrisConversationBrain({ channel: "instagram", threadRef: "ig:1", latestMessage: "Is this a safe neighborhood? I want a person", events: [], context });
  assert.equal(result.decision, "human_alert");
  assert.equal(result.needs_human, true);
  assert.match(result.draft, /official resources/i);
});

test("captured property context produces a contextual safe first reply", () => {
  const context = buildLeadContextEnvelope({
    channel: "sms", threadRef: "meta:lead-123", provider: "meta",
    providerMetadata: { clicked_property: { address: "123 Main Street", price: "$499,000", beds: "3" } },
  });
  const result = runIrisConversationBrain({ channel: "sms", threadRef: "meta:lead-123", latestMessage: "Can I see the price and photos?", events: [], context });
  assert.equal(result.decision, "auto_send");
  assert.match(result.draft, /123 Main Street/);
  assert.match(result.draft, /photos/i);
});

test("channel renderer enforces SMS and DM bounds", () => {
  assert.equal(renderChannelReply("sms", "x".repeat(500)).length, 320);
  assert.equal(renderChannelReply("instagram", "x".repeat(700)).length, 500);
  assert.equal(renderChannelReply("email", "x".repeat(700)).length, 700);
});
