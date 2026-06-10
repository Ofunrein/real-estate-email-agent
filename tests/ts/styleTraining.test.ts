import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStyleFewShot, fetchStyleContext, type StyleTrainingDeps } from "@/lib/styleTraining";
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
  const deps: StyleTrainingDeps = {
    enabled: () => true,
    read: async () => [example("Warm and brief, that's our style.")],
  };
  const block = await fetchStyleContext("", deps);
  assert.match(block, /Warm and brief/);
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
