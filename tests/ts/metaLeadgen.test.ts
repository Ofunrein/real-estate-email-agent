import { test } from "node:test";
import assert from "node:assert/strict";

import { extractLeadgenIds, initialLeadgenReply, metaLeadgenIngestInput, normalizeMetaLeadgenLead, type MetaLeadgenLead } from "@/lib/metaLeadgen";

const buyerLead: MetaLeadgenLead = {
  id: "lead_123",
  created_time: "2026-07-02T10:00:00Z",
  form_id: "form_1",
  ad_name: "South Austin buyers",
  campaign_name: "FB Lead Ads",
  field_data: [
    { name: "full_name", values: ["John Buyer"] },
    { name: "phone_number", values: ["(512) 555-0199"] },
    { name: "email", values: ["JOHN@example.com"] },
    { name: "what_are_you_looking_for", values: ["Looking for 3 bed under 500k in South Austin. Text me."] },
  ],
};

test("normalizeMetaLeadgenLead extracts contact, criteria, consent, and channel", () => {
  const normalized = normalizeMetaLeadgenLead(buyerLead);
  assert.equal(normalized.fullName, "John Buyer");
  assert.equal(normalized.email, "john@example.com");
  assert.equal(normalized.phone, "15125550199");
  assert.equal(normalized.preferredChannel, "sms");
  assert.equal(normalized.bedrooms, "3");
  assert.equal(normalized.budget, "500000");
  assert.equal(normalized.leadRole, "buyer");
  assert.equal(normalized.smsConsent, "lead_form");
});

test("metaLeadgenIngestInput creates a speed-to-lead SMS thread event", () => {
  const ingest = metaLeadgenIngestInput(buyerLead);
  assert.equal(ingest.source, "facebook_lead_ad");
  assert.equal(ingest.threadRef, "sms:15125550199");
  assert.equal(ingest.eventType, "facebook_lead_form_submitted");
  assert.equal(ingest.providerMessageId, "lead_123");
  assert.equal(ingest.nextAction, "speed_to_lead_followup");
});

test("initialLeadgenReply uses Austin Realty and criteria", () => {
  const reply = initialLeadgenReply(normalizeMetaLeadgenLead(buyerLead));
  assert.match(reply, /Austin Realty/);
  assert.match(reply, /3-bed/);
  assert.match(reply, /500,000/);
});

test("extractLeadgenIds supports Meta webhook changes and direct debug payloads", () => {
  assert.deepEqual(extractLeadgenIds({ entry: [{ changes: [{ value: { leadgen_id: "abc" } }] }] }), ["abc"]);
  assert.deepEqual(extractLeadgenIds({ leadgenId: "direct" }), ["direct"]);
});
