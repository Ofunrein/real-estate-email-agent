import { test } from "node:test";
import assert from "node:assert/strict";

import { buildComposioSocialSendArguments } from "@/lib/composioSocial";
import { finalizeOutboundTextBody, finalizeOutboundTextWithMedia } from "@/lib/smsFormatting";
import { smsMessageWithMediaLog } from "@/lib/twilioSms";
import { whatsAppMessageWithMediaLog } from "@/lib/metaWhatsapp";

// The URL-paragraph contract used to live only in the Twilio path. WhatsApp trimmed and shipped,
// Meta social DMs only stripped em dashes, the Instagram browser bridge joined "Attachments:"
// straight onto the first link, and the dashboard's own Twilio WhatsApp POST sent input.body
// untouched. Same generator, four different shapes on the phone.
//
// finalizeOutboundTextBody is now the single contract. These assertions hold it to being the
// SAME contract everywhere and to reading nothing tenant-specific.

const URL_RE = /https?:\/\/\S+/g;

function assertUrlParagraphInvariant(final: string, label: string) {
  const lines = final.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!/https?:\/\//.test(line)) continue;
    assert.equal(line.replace(URL_RE, "").trim(), "", `${label}: URL shares its line`);
    assert.equal((line.match(URL_RE) || []).length, 1, `${label}: two URLs jammed on one line`);
    if (index > 0) assert.equal(lines[index - 1], "", `${label}: no blank line before the URL`);
    if (index < lines.length - 1) assert.equal(lines[index + 1], "", `${label}: no blank line after the URL`);
  }
  assert.ok(!/^\s*\n/.test(final), `${label}: leading blank line`);
  assert.ok(!/\n\s*$/.test(final), `${label}: trailing blank line`);
  assert.ok(!/\n{3,}/.test(final), `${label}: 3+ consecutive newlines`);
}

const WALL = "Here's the unit. Listing: https://www.zillow.com/homedetails/a_zpid/ Want a tour?";

test("the shared finalizer isolates URLs and keeps prose after a link on its own line", () => {
  const final = finalizeOutboundTextBody(WALL);

  assertUrlParagraphInvariant(final, "shared finalizer");
  assert.deepEqual(final.split("\n"), [
    "Here's the unit.",
    "",
    "https://www.zillow.com/homedetails/a_zpid/",
    "",
    "Want a tour?",
  ]);
});

test("the finalizer preserves intentional blank lines and never collapses newlines into spaces", () => {
  const authored = "Quick update.\n\nThe seller countered at 415k.\n\nWant me to push back?";

  assert.equal(finalizeOutboundTextBody(authored), authored);
  assert.equal(finalizeOutboundTextBody("one\ntwo"), "one\ntwo");
  // Collapsing is the specific historical bug; assert it directly.
  assert.notEqual(finalizeOutboundTextBody(authored), authored.replace(/\s+/g, " "));
});

test("a numbered roundup becomes one item per line, not a run-on paragraph", () => {
  const runOn = "I found 3 matches: 1. 6828 Walkup Ln 2. 6814 Old Quarry Ln 3. 6822 Willamette Dr";
  const final = finalizeOutboundTextBody(runOn);

  assert.match(final, /^1\. 6828 Walkup Ln$/m);
  assert.match(final, /^2\. 6814 Old Quarry Ln$/m);
  assert.match(final, /^3\. 6822 Willamette Dr$/m);
  assert.doesNotMatch(final, /Walkup Ln 2\./, "list items are still on one line");
});

test("media URLs attach as their own paragraphs with no label sharing the line", () => {
  const final = finalizeOutboundTextWithMedia("Photos for 6816 Beatty Dr.", [
    "https://photos.zillowstatic.com/fp/one.jpg",
    "https://photos.zillowstatic.com/fp/two.jpg",
  ]);

  assertUrlParagraphInvariant(final, "media");
  assert.equal(final.split("\n").filter((line) => line.includes("https://")).length, 2);
  assert.doesNotMatch(final, /MMS image:|WhatsApp image:|Attachments:/);
});

test("SMS and WhatsApp media logs produce the identical shape for identical input", () => {
  const body = "Photos for 6816 Beatty Dr.";
  const urls = ["https://photos.zillowstatic.com/fp/one.jpg"];

  const sms = smsMessageWithMediaLog(body, urls);
  const whatsapp = whatsAppMessageWithMediaLog(body, urls);

  assertUrlParagraphInvariant(sms, "sms media log");
  assertUrlParagraphInvariant(whatsapp, "whatsapp media log");
  assert.equal(sms, whatsapp, "SMS and WhatsApp drifted apart again");
  assert.doesNotMatch(whatsapp, /WhatsApp image:/, "the label is back on the URL's line");
});

test("the social DM argument builder ships the finalized body on every text key", () => {
  const args = buildComposioSocialSendArguments(
    "messenger",
    { page_id: "page_1", message_text: "stale", body: "stale", message: "stale" },
    { to: "recipient_1", body: WALL, threadRef: "messenger:thread_1" },
  );

  const expected = finalizeOutboundTextBody(WALL);
  for (const key of ["body", "message", "message_text"]) {
    assert.equal(args[key], expected, `${key} did not get the finalized body`);
    assertUrlParagraphInvariant(String(args[key]), `social ${key}`);
  }
});

test("every text transport applies the same contract, so no channel drifts", () => {
  // One assertion per transport-facing entry point that turns a generated reply into the string
  // handed to a provider. If a new channel forgets to finalize, this is what catches it.
  const expected = finalizeOutboundTextBody(WALL);
  const shapes = {
    sms: smsMessageWithMediaLog(WALL, []),
    whatsapp: whatsAppMessageWithMediaLog(WALL, []),
    social: String(
      buildComposioSocialSendArguments("instagram", {}, { to: "u", body: WALL }).body,
    ),
    shared: finalizeOutboundTextWithMedia(WALL, []),
  };

  for (const [channel, value] of Object.entries(shapes)) {
    assert.equal(value, expected, `${channel} produced a different shape than the shared contract`);
  }
});

test("the contract is tenant-independent: no client id or env changes the output", () => {
  const keys = ["CLIENT_ID", "CLIENT_NAME", "TEAM_NAME", "AGENT_NAME_SMS", "TWILIO_FROM"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const baseline = finalizeOutboundTextBody(WALL);

  try {
    for (const tenant of ["austin-realty", "miami-luxury", "default", ""]) {
      for (const key of keys) process.env[key] = `${tenant}-${key}`;
      process.env.CLIENT_ID = tenant;
      assert.equal(
        finalizeOutboundTextBody(WALL),
        baseline,
        `tenant ${tenant || "(empty)"} got different spacing`,
      );
      assert.equal(smsMessageWithMediaLog(WALL, []), baseline, `tenant ${tenant} SMS drifted`);
      assert.equal(whatsAppMessageWithMediaLog(WALL, []), baseline, `tenant ${tenant} WhatsApp drifted`);
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key] as string;
    }
  }
});

test("the finalizer is idempotent, so passing through two layers cannot drift spacing", () => {
  for (const value of [WALL, "plain ack", "a\n\nb\n\nhttps://example.com/x\n\nc"]) {
    const once = finalizeOutboundTextBody(value);
    assert.equal(finalizeOutboundTextBody(once), once, `not idempotent: ${JSON.stringify(value)}`);
    assert.equal(finalizeOutboundTextWithMedia(once, []), once, "media wrapper drifted on re-entry");
  }
});
