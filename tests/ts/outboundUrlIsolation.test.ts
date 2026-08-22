import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { finalizeOutboundSmsBody, smsMessageWithMediaLog } from "@/lib/twilioSms";
import { normalizeMessagesReply, checkMessagesFormatting } from "@/lib/smsFormatting";

// Martin supplied four screenshots of the live Iris AI thread (chat 1984) as production failure
// evidence: whole listing roundups arriving as one run-on paragraph, with `Listing: https://…`
// inline and the next numbered listing starting immediately after `_zpid/`.
//
// These assertions run against the FINAL outbound payload - the string that
// finalizeOutboundSmsBody hands to the Twilio form POST - not against a helper in isolation.
// That is the boundary the screenshots were taken on the far side of.

type ScreenshotCase = {
  id: string;
  screenshot: string;
  received: string;
  urlCount: number;
  mustNotContain: string[];
};

const fixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests/fixtures/imessage-screenshot-regressions.json"), "utf8"),
) as { cases: ScreenshotCase[] };

const URL_RE = /https?:\/\/\S+/g;

/** Physical lines, exactly as Messages will lay them out. */
function lines(text: string): string[] {
  return text.split("\n");
}

function urlLines(text: string): Array<{ line: string; index: number }> {
  return lines(text)
    .map((line, index) => ({ line, index }))
    .filter((entry) => /https?:\/\//.test(entry.line));
}

function assertUrlParagraphInvariant(final: string, label: string) {
  const all = lines(final);

  for (const { line, index } of urlLines(final)) {
    // 1 + 2: the URL starts and ends its own physical line, nothing else on it.
    assert.equal(
      line.replace(URL_RE, "").trim(),
      "",
      `${label}: URL shares its line with "${line.replace(URL_RE, "").trim()}"`,
    );
    // Exactly one URL per line, so two links can never be jammed together.
    assert.equal((line.match(URL_RE) || []).length, 1, `${label}: more than one URL on a line: ${line}`);

    // 3 + 4: blank line before and after, so the URL is its own paragraph. At a message
    // boundary there is no meaningless blank line, so the edge counts as satisfied.
    if (index > 0) {
      assert.equal(all[index - 1], "", `${label}: no blank line before URL on line ${index}`);
    }
    if (index < all.length - 1) {
      assert.equal(all[index + 1], "", `${label}: no blank line after URL on line ${index}`);
    }
  }

  // No meaningless leading or trailing blank lines at the message boundaries.
  assert.ok(!/^\s*\n/.test(final), `${label}: leading blank line`);
  assert.ok(!/\n\s*$/.test(final), `${label}: trailing blank line`);
  assert.ok(!/\n{3,}/.test(final), `${label}: 3+ consecutive newlines`);

  // 5 + 6: a numbered listing never begins on the same line as a URL. `[^\S\n]` is horizontal
  // whitespace only - a paragraph break between the link and the next item is the goal, not a bug.
  assert.doesNotMatch(final, /_zpid\/[^\S\n]+\d+\./, `${label}: a numbered listing followed a URL inline`);
  assert.doesNotMatch(final, /https?:\/\/\S+[^\S\n]+\d+\.[^\S\n]/, `${label}: a numbered listing followed a URL inline`);

  // 7: raw clickable URL preserved, no Markdown link syntax introduced.
  assert.doesNotMatch(final, /\[[^\]]*\]\([^)]*\)/, `${label}: Markdown link syntax`);
}

test("every screenshot payload comes out of the final outbound serializer with isolated URLs", () => {
  assert.ok(fixture.cases.length >= 8, "expected the full screenshot fixture set");

  for (const item of fixture.cases) {
    const final = finalizeOutboundSmsBody(item.received);
    const label = `${item.id} (${item.screenshot})`;

    assertUrlParagraphInvariant(final, label);

    // Every URL that went in comes out intact and unbroken.
    const before = item.received.match(URL_RE) || [];
    assert.equal(
      urlLines(final).length,
      item.urlCount,
      `${label}: expected ${item.urlCount} URL lines, got ${urlLines(final).length}`,
    );
    for (const url of before) {
      const cleaned = url.replace(/[).,;:!?]+$/, "");
      assert.ok(final.includes(cleaned), `${label}: URL was altered or lost: ${cleaned}`);
    }

    for (const banned of item.mustNotContain) {
      assert.ok(!final.includes(banned), `${label}: still contains ${JSON.stringify(banned)}`);
    }

    // No words are lost or reordered by the restructuring, except labels that existed only to
    // introduce a link ("Listing:") and the brackets that only wrapped one.
    const words = (value: string) =>
      value
        .replace(URL_RE, " ")
        .replace(/\b(?:listing|link|links|url|photos?|view|more info|details)\s*:/gi, " ")
        .replace(/[()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    assert.equal(words(final), words(item.received), `${label}: prose changed during restructuring`);
  }
});

test("the three-listing screenshot becomes one readable block per listing", () => {
  const item = fixture.cases.find((entry) => entry.id === "screenshot_three_listings_south_austin");
  assert.ok(item);
  const final = finalizeOutboundSmsBody(item!.received);

  // intro, then three (details, blank, URL, blank) groups, then the closing question.
  const blocks = final.split("\n\n");
  assert.ok(blocks.length >= 7, `expected at least 7 paragraphs, got ${blocks.length}:\n${final}`);
  assert.match(blocks[0], /^I found 3 matches:/);
  assert.match(blocks[blocks.length - 1], /Which one should I focus on\?$/);

  // Each listing's details land on their own line, not jammed into the intro.
  assert.match(final, /^1\. 6828 Walkup Ln/m);
  assert.match(final, /^2\. 6814 Old Quarry Ln/m);
  assert.match(final, /^3\. 6822 Willamette Dr/m);

  // Each of the three links sits alone.
  assert.equal(urlLines(final).length, 3);
});

test("a long wrapped Zillow URL is never split across lines", () => {
  const long = `https://www.zillow.com/homedetails/${"Very-Long-Street-Name-".repeat(12)}Austin-TX-78701/306644848_zpid/`;
  assert.ok(long.length > 250);
  const final = finalizeOutboundSmsBody(`Here's the unit. Listing: ${long} Want a tour?`);

  assert.ok(final.includes(long), "the URL was broken apart");
  assertUrlParagraphInvariant(final, "long wrapped URL");
  // Visual wrapping on the phone is fine; a literal newline inside the URL is not.
  assert.equal(urlLines(final).length, 1);
});

test("media URLs on the outbound payload are their own paragraphs too", () => {
  const body = "Photos coming through for 6816 Beatty Dr.";
  const final = smsMessageWithMediaLog(body, [
    "https://photos.zillowstatic.com/fp/one.jpg",
    "https://photos.zillowstatic.com/fp/two.jpg",
  ]);

  assertUrlParagraphInvariant(final, "media log");
  assert.equal(urlLines(final).length, 2);
  assert.doesNotMatch(final, /MMS image:/);
});

test("the final serializer is idempotent, so double-normalizing cannot drift spacing", () => {
  for (const item of fixture.cases) {
    const once = finalizeOutboundSmsBody(item.received);
    assert.equal(finalizeOutboundSmsBody(once), once, `${item.id}: not idempotent`);
    // And the generator-side normalizer agrees with the transport-side one.
    assert.equal(normalizeMessagesReply(once), once, `${item.id}: normalizer disagrees with serializer`);
  }
});

test("the checker flags each screenshot payload as received and clears it once serialized", () => {
  for (const item of fixture.cases) {
    if (!item.urlCount) continue;
    // Only the payloads that actually arrived broken should be flagged. One fixture is already
    // correctly shaped and is here to prove the serializer leaves good input alone.
    const arrivedBroken = urlLines(item.received).some(
      (entry) => entry.line.replace(URL_RE, "").trim() !== "",
    ) || item.received.split("\n").some((line) => line.length > 180);

    const receivedCodes = checkMessagesFormatting(item.received, { family: "multi_listing" }).map((v) => v.code);
    if (arrivedBroken) {
      assert.ok(
        receivedCodes.includes("url_not_isolated") || receivedCodes.includes("line_wall"),
        `${item.id}: the checker did not flag a payload that arrived broken`,
      );
    }

    const finalCodes = checkMessagesFormatting(finalizeOutboundSmsBody(item.received), { family: "multi_listing" })
      .map((v) => v.code);
    assert.ok(!finalCodes.includes("url_not_isolated"), `${item.id}: still url_not_isolated after serialization`);
    assert.ok(!finalCodes.includes("line_wall"), `${item.id}: still a wall after serialization`);
  }
});
