import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Golden list captured from lib/inboxData.ts:15-29 (AgentInboxData) at the start of this audit.
// This audit does not modify lib/inboxData.ts. If a future change drops one of these keys, the
// dashboard's /api/data consumer (components/AgentInboxClient.tsx) goes blank for that section —
// this test exists so that regression is caught in CI, not in production.
const REQUIRED_KEYS = [
  "leads",
  "events",
  "voiceCalls",
  "properties",
  "metrics",
  "threads",
  "threadCategories",
  "inboxCategories",
  "inboxSettings",
  "drafts",
  "emailCapabilities",
  "threadReadStates",
  "channelAccounts",
  "propertyHealth",
];

test("AgentInboxData type in lib/inboxData.ts still declares every required key", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../lib/inboxData.ts"), "utf8");
  const typeMatch = source.match(/export type AgentInboxData = \{([\s\S]*?)\};/);
  assert.ok(typeMatch, "AgentInboxData type not found in lib/inboxData.ts");
  const body = typeMatch![1];
  for (const key of REQUIRED_KEYS) {
    assert.ok(new RegExp(`\\b${key}\\s*:`).test(body), `AgentInboxData is missing required key "${key}"`);
  }
});

test("channel/direction enum values referenced by this audit's docs match the repo's actual literals", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../lib/inboxData.ts"), "utf8");
  assert.ok(source.includes('"inbound" | "outbound"'), "direction enum literal changed shape");
});
