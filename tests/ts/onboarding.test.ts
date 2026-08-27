import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { missingIntakeFields, normalizeTypeformResponse, plannedPrivateChannels, verifyTypeformSignature, type TypeformWebhook } from "@/lib/onboarding";

const payload: TypeformWebhook = { form_response: { form_id: "v3hPCHwT", token: "response-1", answers: [
  { field: { ref: "primary_contact_name" }, text: "Ada Owner" },
  { field: { ref: "primary_contact_email" }, email: "ada@example.com" },
  { field: { ref: "company_name" }, text: "Acme Realty" },
  { field: { ref: "mailbox_address" }, email: "leads@example.com" },
  { field: { ref: "human_review_rules" }, text: "Pause for legal questions" },
  { field: { ref: "urgent_handoff_owner" }, email: "owner@example.com" },
  { field: { ref: "connection_approver" }, email: "tech@example.com" },
  { field: { ref: "team_names" }, text: "Sales, Leasing" },
  { field: { ref: "phone_numbers" }, text: "+1 512 555 1212" },
] } };

test("normalizes Typeform refs into the durable onboarding record", () => {
  const intake = normalizeTypeformResponse(payload);
  assert.equal(intake.company_name, "Acme Realty");
  assert.deepEqual(missingIntakeFields(intake), []);
  assert.deepEqual(plannedPrivateChannels(intake), ["client-acme-realty-iris", "client-acme-realty-sales", "client-acme-realty-leasing", "client-acme-realty-5125551212"]);
});

test("missing required values block provisioning", () => {
  const intake = normalizeTypeformResponse({ form_response: { answers: [] } });
  assert.ok(missingIntakeFields(intake).includes("mailbox_address"));
});

test("verifies Typeform HMAC signatures", () => {
  const raw = JSON.stringify(payload); const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("base64")}`;
  assert.equal(verifyTypeformSignature(raw, signature, secret), true);
  assert.equal(verifyTypeformSignature(`${raw}x`, signature, secret), false);
});
