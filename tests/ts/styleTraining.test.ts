import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStyleFewShot, fetchStyleContext, redactEmailStyleExample, type StyleTrainingDeps } from "@/lib/styleTraining";
import type { StyleExample } from "@/lib/database";

function example(excerpt: string): StyleExample {
  return { category: "", tone_tags: [], redacted_excerpt: excerpt };
}

test("buildStyleFewShot: formats approved excerpts, empty when none", () => {
  assert.equal(buildStyleFewShot([]), "");
  const block = buildStyleFewShot([example("Hi! Thanks for reaching out about the home."), example("Happy to set up a tour.")], 3);
  assert.match(block, /Example 1:/);
  assert.match(block, /Example 2:/);
  assert.match(block, /only their voice/);
});

test("buildStyleFewShot: respects limit", () => {
  const block = buildStyleFewShot([example("a"), example("b"), example("c")], 1);
  assert.match(block, /Example 1:/);
  assert.ok(!block.includes("Example 2:"));
});

test("fetchStyleContext: empty string when disabled", async () => {
  let read = false;
  const deps: StyleTrainingDeps = {
    enabled: () => false,
    read: async () => {
      read = true;
      return [];
    },
  };
  assert.equal(await fetchStyleContext("", deps), "");
  assert.equal(read, false, "no DB read when disabled");
});

test("fetchStyleContext: builds block when enabled", async () => {
  const reads: Array<{ category: string; limit: number; mailboxEmail: string }> = [];
  const deps: StyleTrainingDeps = {
    enabled: () => true,
    read: async (category, limit, mailboxEmail) => {
      reads.push({ category, limit, mailboxEmail: mailboxEmail || "" });
      return [example("Warm and brief, that's our style.")];
    },
  };
  const block = await fetchStyleContext("property_reply", deps, "iris@tenant-a.example");
  assert.match(block, /Warm and brief/);
  assert.deepEqual(reads, [{ category: "property_reply", limit: 3, mailboxEmail: "iris@tenant-a.example" }]);
});

test("fetchStyleContext: read failure degrades to empty", async () => {
  const deps: StyleTrainingDeps = {
    enabled: () => true,
    read: async () => {
      throw new Error("db down");
    },
  };
  assert.equal(await fetchStyleContext("", deps), "");
});

test("redactEmailStyleExample: preserves voice while removing lead-specific facts", () => {
  const redacted = redactEmailStyleExample([
    "Hi Sam, happy to help with 4309 Fairway Path for $650,000.",
    "Call me at (512) 555-0199 or use https://example.com/tour.",
    "Email agent@example.com.",
  ].join(" "));

  assert.match(redacted, /Hi Sam, happy to help/);
  assert.match(redacted, /\[property\]/);
  assert.match(redacted, /\[price\]/);
  assert.match(redacted, /\[phone\]/);
  assert.match(redacted, /\[link\]/);
  assert.match(redacted, /\[email\]/);
  assert.doesNotMatch(redacted, /4309 Fairway|650,000|555-0199|example\.com/);
});
