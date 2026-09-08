import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { emailBodyHtml, emailHtml, emailText } from "@/lib/demoOutreachEmail";

/**
 * Frozen rendering vectors for the outreach email.
 *
 * lib/demoOutreachEmail.ts is a byte-identical port of lumenosis-site lib/email-html.ts.
 * The two repos share no package, so drift cannot be prevented by a type. It is prevented
 * here instead: these vectors were recorded from the rendering that prospects already
 * receive, and after cutover THIS app performs the send. If a future edit changes a
 * style, an escape, or the link markup, a prospect would get a different email than the
 * pre-cutover path produced, and this test fails first.
 *
 * The recorded strings are the contract. Do not regenerate them to make a change pass —
 * a diff here means the send behaviour changed.
 */

const BODY = [
  "Hi Dana,",
  "",
  "I put together a live demo for 1200 Oak Grove Ln using your own listing data. Take a look: [open your demo room](https://lumenosis.com/demo/abc123token)",
  "",
  "Raw link if the button is stripped: https://lumenosis.com/demo/abc123token",
  "",
  "A & B <tags> should be escaped.",
  "",
  "Best,",
  "Iris",
].join("\n");

const EXPECTED_TEXT =
  "Hi Dana,\n\nI put together a live demo for 1200 Oak Grove Ln using your own listing data. Take a look: open your demo room: https://lumenosis.com/demo/abc123token\n\nRaw link if the button is stripped: https://lumenosis.com/demo/abc123token\n\nA & B <tags> should be escaped.\n\nBest,\nIris";

const EXPECTED_HTML =
  '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f2ec">\n' +
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e6e2d8;border-radius:14px">\n' +
  "<tr><td style=\"padding:32px 32px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif\">\n" +
  '<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#1f2937">Hi Dana,</p>\n' +
  '<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#1f2937">I put together a live demo for 1200 Oak Grove Ln using your own listing data. Take a look: <a href="https://lumenosis.com/demo/abc123token" style="color:#8a682c;font-weight:600;text-decoration:underline">open your demo room</a></p>\n' +
  '<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#1f2937">Raw link if the button is stripped: <a href="https://lumenosis.com/demo/abc123token" style="color:#8a682c;font-weight:600;text-decoration:underline">https://lumenosis.com/demo/abc123token</a></p>\n' +
  '<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#1f2937">A &amp; B &lt;tags&gt; should be escaped.</p>\n' +
  '<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e6e2d8;font-size:15px;line-height:1.6;color:#4b5563">Best,<br>Iris</p>\n' +
  "</td></tr></table></body></html>";

test("the plain-text alternative renders exactly as recorded", () => {
  assert.equal(emailText(BODY), EXPECTED_TEXT);
});

test("the HTML email renders exactly as recorded", () => {
  assert.equal(emailHtml(BODY), EXPECTED_HTML);
});

test("a demo link inside the body is rendered verbatim, never rewritten", () => {
  const html = emailHtml("Open it: [demo](https://lumenosis.com/demo/tok-EXACT_1)");
  // The href must be the exact token URL. Any re-signing, tracking wrapper, or redirect
  // would break the preservation guarantee that already-sent links keep working.
  assert.ok(html.includes('href="https://lumenosis.com/demo/tok-EXACT_1"'));
  assert.equal(emailText("Open it: [demo](https://lumenosis.com/demo/tok-EXACT_1)"),
    "Open it: demo: https://lumenosis.com/demo/tok-EXACT_1");
});

test("markup in the body cannot escape into the email", () => {
  const html = emailBodyHtml('<script>alert("x")</script>');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("a sign-off paragraph gets the divider style and body paragraphs do not", () => {
  assert.ok(emailBodyHtml("Thanks,\nIris").includes("border-top:1px solid #e6e2d8"));
  assert.ok(!emailBodyHtml("Just a line.").includes("border-top"));
});

test("an empty or whitespace-only body produces no paragraphs", () => {
  assert.equal(emailBodyHtml("   \n\n  "), "");
});

test("the module carries no secret, endpoint, or environment read", () => {
  const source = readFileSync(new URL("../../lib/demoOutreachEmail.ts", import.meta.url), "utf8");
  // Pure rendering only: the send path owns the provider call and the credentials.
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /api\.agentmail\.to/);
});
