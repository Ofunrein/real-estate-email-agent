import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  channelSuppression,
  isDoNotContact,
  optInPatch,
  optOutPatch,
  preserveSuppression,
} from "@/lib/contactSuppression";
import type { SheetRow } from "@/lib/sheetSchema";

function lead(row: Partial<SheetRow>): Partial<SheetRow> {
  return row;
}

test("a lead who texted STOP is blocked on every automated channel", () => {
  const stopped = lead(optOutPatch("sms") as Partial<SheetRow>);
  for (const channel of ["sms", "whatsapp", "voice", "email"] as const) {
    const verdict = channelSuppression(stopped, channel);
    assert.equal(verdict.suppressed, true, `${channel} should be suppressed`);
    assert.equal(verdict.code, "do_not_contact");
  }
});

test("the exact metadata the webhooks attach must not read as consent", () => {
  // Both SMS and WhatsApp webhooks hardcode smsConsent:"inbound_text" on the
  // queued job. If a stored row somehow carries it, it is not an opt-out — but
  // it must also never be mistaken for a stored opt-out being absent.
  const inboundOnly = lead({ sms_consent: "inbound_text" });
  assert.equal(channelSuppression(inboundOnly, "sms").suppressed, false);

  const optedOutButAlsoTexting = lead({ sms_consent: "no" });
  assert.equal(channelSuppression(optedOutButAlsoTexting, "sms").suppressed, true);
  assert.equal(channelSuppression(optedOutButAlsoTexting, "sms").code, "sms_opted_out");
});

test("an SMS opt-out also stops the calling cadence", () => {
  const smsStopped = lead({ sms_consent: "no" });
  assert.equal(channelSuppression(smsStopped, "voice").suppressed, true);
});

test("legacy rows that encoded the opt-out in free text still suppress", () => {
  assert.equal(isDoNotContact(lead({ next_action: "do_not_contact" })), true);
  assert.equal(isDoNotContact(lead({ handoff_status: "do_not_contact" })), true);
  assert.equal(isDoNotContact(lead({ do_not_contact: "true" })), true);
  assert.equal(isDoNotContact(lead({ do_not_contact: "false" })), false);
  assert.equal(isDoNotContact(lead({})), false);
});

test("the next inbound message cannot silently clear an opt-out", () => {
  const existing = { ...(optOutPatch("sms") as SheetRow), phone: "15125550100" } as SheetRow;
  // This is exactly what channelIngest writes for an ordinary inbound text.
  const incoming = { next_action: "review_or_reply", sms_consent: "inbound_text" } as Partial<SheetRow>;
  const naive = { ...existing, ...incoming } as SheetRow;

  const merged = preserveSuppression(existing, incoming, naive);
  assert.equal(merged.do_not_contact, "true");
  assert.equal(merged.next_action, "do_not_contact");
  assert.equal(channelSuppression(merged, "sms").suppressed, true);
});

test("an explicit START lifts the opt-out", () => {
  const existing = optOutPatch("sms") as SheetRow;
  const incoming = optInPatch("sms") as Partial<SheetRow>;
  const merged = preserveSuppression(existing, incoming, { ...existing, ...incoming } as SheetRow);

  assert.equal(isDoNotContact(merged), false);
  assert.equal(channelSuppression(merged, "sms").suppressed, false);
});

test("suppression does not fire for a lead who never opted out", () => {
  const active = lead({ sms_consent: "yes", call_consent: "yes" });
  for (const channel of ["sms", "whatsapp", "voice", "email"] as const) {
    assert.equal(channelSuppression(active, channel).suppressed, false, channel);
  }
  assert.equal(channelSuppression(undefined, "sms").suppressed, false);
});

test("an email unsubscribe blocks email but not an unrelated channel", () => {
  const unsubscribed = lead(optInPatch("sms") as Partial<SheetRow>);
  unsubscribed.email_consent = "no";
  assert.equal(channelSuppression(unsubscribed, "email").suppressed, true);
  assert.equal(channelSuppression(unsubscribed, "email").code, "email_opted_out");
  assert.equal(channelSuppression(unsubscribed, "sms").suppressed, false);
});

test("every automated send path checks suppression at send time", () => {
  // A snapshot taken when a cadence task was queued cannot know about a STOP
  // that arrived afterwards, and cancel-on-inbound is a race mitigation rather
  // than a gate. Each of these must re-read the stored lead before sending.
  const cadence = readFileSync(new URL("../../lib/inngest/functions/cadenceTaskRun.ts", import.meta.url), "utf8");
  assert.match(cadence, /findLeadInDatabase/);
  assert.match(cadence, /channelSuppression/);
  // The check must come before the send, not after it.
  assert.ok(cadence.indexOf("channelSuppression") < cadence.indexOf("sendManualReply({ channel"));

  const replySend = readFileSync(new URL("../../lib/inngest/functions/messageReplySend.ts", import.meta.url), "utf8");
  assert.match(replySend, /channelSuppression/);

  // Transport boundary: catches every direct sender (speed-to-lead, website
  // reply, appointment confirmations) without each one remembering.
  const twilio = readFileSync(new URL("../../lib/twilioSms.ts", import.meta.url), "utf8");
  assert.match(twilio, /suppressedRecipient/);
  assert.match(twilio, /operatorInitiated/);
});

test("provider tokens are never duplicated in plaintext metadata", () => {
  // Encrypting the column while writing the same token into the unencrypted
  // metadata jsonb next to it would make the encryption cosmetic.
  const metaDirect = readFileSync(new URL("../../lib/metaDirectConnection.ts", import.meta.url), "utf8");
  const metadataBlocks = metaDirect.split("metadata: {").slice(1);
  for (const block of metadataBlocks) {
    assert.ok(!block.slice(0, block.indexOf("}")).includes("page_access_token"), "token copied into metadata");
  }
  const database = readFileSync(new URL("../../lib/database.ts", import.meta.url), "utf8");
  assert.match(database, /stripTokensFromMetadata/);
});
