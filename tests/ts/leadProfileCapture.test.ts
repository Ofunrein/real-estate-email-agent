import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendLeadProfileCaptureAsk,
  decideLeadProfileCapture,
  extractLeadProfileDetails,
  leadProfileMemoryPatch,
} from "@/lib/leadProfileCapture";

test("extractLeadProfileDetails: captures email phone and stated name", () => {
  const details = extractLeadProfileDetails("This is Sam Lee, sam@example.com, 512-571-2595");
  assert.equal(details.email, "sam@example.com");
  assert.equal(details.phone, "+15125712595");
  assert.equal(details.fullName, "Sam Lee");
});

test("extractLeadProfileDetails: ignores false name from buyer phrasing", () => {
  const details = extractLeadProfileDetails("I'm looking for 3 beds in Austin under 800k");
  assert.equal(details.fullName, "");
});

test("decideLeadProfileCapture: social asks optional text copy for high intent missing phone", () => {
  const decision = decideLeadProfileCapture({
    channel: "instagram",
    message: "Can I tour this listing tomorrow?",
    lead: { full_name: "Maya Buyer", phone: "contact_123" },
    classification: { intent: "showing_request", status: "ready_to_reply" },
  });
  assert.equal(decision.shouldAsk, true);
  assert.equal(decision.askFor, "phone");
  assert.match(decision.question, /keep sending them here/i);
  assert.match(decision.question, /text copy/i);
});

test("decideLeadProfileCapture: SMS asks name only for high intent when phone is known", () => {
  const decision = decideLeadProfileCapture({
    channel: "sms",
    message: "Yes I'm preapproved and want to book a showing",
    lead: { phone: "+15125712595" },
    classification: { intent: "showing_request", status: "ready_to_reply" },
  });
  assert.equal(decision.shouldAsk, true);
  assert.equal(decision.askFor, "full_name");
});

test("appendLeadProfileCaptureAsk: does not add a second question", () => {
  const decision = decideLeadProfileCapture({
    channel: "sms",
    message: "Can you send photos?",
    lead: { phone: "+15125712595" },
    classification: { intent: "property_details", status: "ready_to_reply" },
  });
  assert.equal(appendLeadProfileCaptureAsk("I can send them here. Which one should I focus on?", decision), "I can send them here. Which one should I focus on?");
});

test("leadProfileMemoryPatch: stores extracted contact fields without overwriting channel usefulness", () => {
  const patch = leadProfileMemoryPatch({
    channel: "instagram",
    source: "manychat",
    message: "my name is Sam Lee and my email is sam@example.com",
    existing: { phone: "contact_1" },
    extracted: extractLeadProfileDetails("my name is Sam Lee and my email is sam@example.com"),
  });
  assert.equal(patch.email, "sam@example.com");
  assert.equal(patch.full_name, "Sam Lee");
  assert.equal(patch.phone, undefined);
  assert.equal(patch.last_channel, "instagram");
});
