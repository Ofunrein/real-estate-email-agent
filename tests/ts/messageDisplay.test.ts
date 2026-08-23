import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  MESSAGE_TEXT_CLASS,
  isTextMessageChannel,
  messageBubbleClassName,
  messageDisplayText,
  messagePreviewText,
} from "@/lib/messageDisplay";
import { finalizeOutboundTextBody, finalizeOutboundTextWithMedia } from "@/lib/smsFormatting";

// The dashboard rendered every plain-text body through a helper that ran `.replace(/\s+/g, " ")`,
// then styled the bubble with the browser default `white-space: normal`. Two independent ways to
// destroy the same thing: the outbound serializer spends blank lines to give a URL its own
// paragraph, and both of these collapsed them back. Text-channel threads read as a jumbled wall.
//
// These assertions cover the display contract itself, not a screenshot: what the helper returns,
// what class the bubble carries, and that the CSS for that class actually preserves newlines.

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8");
}

test("a text-channel body keeps every intentional newline and blank line", () => {
  const body = [
    "I found 2 matches:",
    "",
    "1. 6828 Walkup Ln, 3 bed 2 bath",
    "",
    "https://www.zillow.com/homedetails/6828-Walkup-Ln-Austin-TX-78745/306644848_zpid/",
    "",
    "Which one should I focus on?",
  ].join("\n");

  const rendered = messageDisplayText(body);

  assert.equal(rendered, body, "paragraph structure changed");
  assert.equal(rendered.split("\n").length, 7);
  assert.ok(rendered.includes("\n\n"), "blank lines were collapsed");
  assert.doesNotMatch(rendered, /matches: 1\./, "a newline became a space");
});

test("a URL keeps a blank line before and after it, and prose after a link starts a new line", () => {
  const rendered = messageDisplayText(
    finalizeOutboundTextBody("Here it is. Listing: https://example.com/a_zpid/ Want a tour?"),
  );
  const lines = rendered.split("\n");
  const urlIndex = lines.findIndex((line) => line.includes("https://"));

  assert.ok(urlIndex > 0, "URL should not be the first line here");
  assert.equal(lines[urlIndex].replace(/https?:\/\/\S+/g, "").trim(), "", "URL shares its line");
  assert.equal(lines[urlIndex - 1], "", "no blank line before the URL");
  assert.equal(lines[urlIndex + 1], "", "no blank line after the URL");
  assert.equal(lines[urlIndex + 2], "Want a tour?", "prose after the link did not start a new line");
});

test("horizontal runs still collapse inside a line, but never across lines", () => {
  assert.equal(messageDisplayText("a   b\t\tc"), "a b c");
  assert.equal(messageDisplayText("one  \n  two"), "one\ntwo");
  // 3+ newlines is a rendering artifact, one blank line is a paragraph.
  assert.equal(messageDisplayText("one\n\n\n\ntwo"), "one\n\ntwo");
  assert.equal(messageDisplayText("\n\n  hi  \n\n"), "hi");
});

test("a numbered list renders one item per line instead of one run-on paragraph", () => {
  const rendered = messageDisplayText("Options:\n1. Tour Saturday\n2. Tour Sunday\n3. Send more listings");
  const lines = rendered.split("\n");

  assert.deepEqual(lines, ["Options:", "1. Tour Saturday", "2. Tour Sunday", "3. Send more listings"]);
});

test("markup in a plain-text body becomes text, never markup", () => {
  const rendered = messageDisplayText("<script>alert(1)</script>Hello<br>there</p>again");

  assert.doesNotMatch(rendered, /<script|<br|<\/p>/i, "raw tags survived into the render");
  assert.match(rendered, /^alert\(1\) Hello\nthere\nagain$/);
  // A double-encoded entity must not decode into a live tag.
  assert.equal(messageDisplayText("&amp;lt;img src=x&amp;gt;"), "&lt;img src=x&gt;");
});

test("previews collapse to one line, because a thread row is one line tall", () => {
  const body = "Line one\n\nLine two";

  assert.equal(messagePreviewText(body), "Line one Line two");
  assert.equal(messageDisplayText(body), body, "the preview rule must not leak into the bubble");
  assert.equal(messagePreviewText(""), "No message yet");
  assert.equal(messageDisplayText("", "nothing"), "nothing");
});

test("the plain-text bubble carries the pre-wrap class and the HTML bubble does not", () => {
  assert.equal(messageBubbleClassName(false), `iris-bubble ${MESSAGE_TEXT_CLASS}`);
  assert.equal(messageBubbleClassName(true), "iris-bubble has-html");
  assert.doesNotMatch(messageBubbleClassName(true), new RegExp(MESSAGE_TEXT_CLASS));
});

test("the CSS for that class actually preserves newlines, and email HTML is left alone", () => {
  const css = read("app/globals.css");

  assert.match(
    css,
    new RegExp(`\\.${MESSAGE_TEXT_CLASS} p\\{white-space:pre-wrap`),
    "the text bubble class has no pre-wrap rule, so preserved newlines stay invisible",
  );
  assert.match(css, /\.iris-bubble\.has-html p\{white-space:normal\}/, "email HTML must keep normal wrapping");
});

test("the live message timeline renders through the display helper, not a collapsing one", () => {
  const dashboard = read("components/iris-dashboard/IrisDashboard.tsx");

  assert.match(dashboard, /messageDisplayText\(plainBody/, "the bubble does not use messageDisplayText");
  assert.match(dashboard, /messageBubbleClassName\(hasHtml\)/, "the bubble class is not the shared one");
  assert.doesNotMatch(
    dashboard,
    /<p>\{clampText\(plainBody/,
    "the bubble is still collapsing whitespace through clampText",
  );
});

test("every text channel is covered, and email/voice are not", () => {
  for (const channel of [
    "sms",
    "rcs",
    "imessage",
    "whatsapp",
    "instagram",
    "messenger",
    "social",
    "web",
    "website",
    "website_chat",
    "WhatsApp",
    " SMS ",
  ]) {
    assert.equal(isTextMessageChannel(channel), true, `${channel} should be a text channel`);
  }
  for (const channel of ["email", "voice", "", "unknown"]) {
    assert.equal(isTextMessageChannel(channel), false, `${channel} should not be a text channel`);
  }
});

test("what the serializer produced is exactly what the bubble renders", () => {
  // The round trip is the real invariant: normalization spends blank lines, display must spend
  // none of them back. Idempotent in both directions.
  const cases = [
    "Quick yes, that unit is available.",
    "I found 2 matches:\n\n1. 6828 Walkup Ln\n\nhttps://example.com/a_zpid/\n\n2. 6814 Old Quarry Ln\n\nhttps://example.com/b_zpid/\n\nWhich one?",
    finalizeOutboundTextWithMedia("Photos for 6816 Beatty Dr.", [
      "https://photos.zillowstatic.com/fp/one.jpg",
      "https://photos.zillowstatic.com/fp/two.jpg",
    ]),
  ];

  for (const value of cases) {
    const final = finalizeOutboundTextBody(value);
    assert.equal(messageDisplayText(final), final, `display altered the final payload: ${JSON.stringify(final)}`);
    assert.equal(messageDisplayText(messageDisplayText(final)), final, "display is not idempotent");
  }
});
