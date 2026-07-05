import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimProviderAction,
  completeProviderAction,
  providerActionHash,
  providerIdempotencyKey,
} from "@/lib/providerSendSafety";

function withoutDatabase<T>(fn: () => Promise<T> | T): Promise<T> | T {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const restore = () => {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  };
  try {
    const value = fn();
    if (value instanceof Promise) return value.finally(restore);
    restore();
    return value;
  } catch (error) {
    restore();
    throw error;
  }
}

test("provider action hash is stable across object key order", () => {
  assert.equal(providerActionHash({ b: 2, a: 1 }), providerActionHash({ a: 1, b: 2 }));
});

test("provider idempotency key prefers explicit header key", () => {
  const key = providerIdempotencyKey({
    idempotencyKey: "manual-key",
    action: "manual_reply",
    channel: "sms",
    target: "+15551234567",
    requestHash: "abc",
  });
  assert.equal(key, "manual-key");
});

test("provider send safety replays completed duplicate action", async () => withoutDatabase(async () => {
  const input = {
    idempotencyKey: `test-${Date.now()}-${Math.random()}`,
    action: "manual_reply",
    channel: "sms",
    target: "+15551234567",
    payload: { body: "hi" },
  };
  const first = await claimProviderAction(input);
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("first claim failed");
  await completeProviderAction(first.key, true, { ok: true, messageIds: ["m1"] });

  const second = await claimProviderAction(input);
  assert.equal(second.ok, false);
  if (second.ok) throw new Error("second claim unexpectedly ok");
  assert.equal(second.status, 200);
  assert.equal(second.replay, true);
  assert.deepEqual(second.result, { ok: true, messageIds: ["m1"] });
}));

test("provider send safety rate limits repeated target sends", async () => withoutDatabase(async () => {
  const target = `+1555${Math.floor(Math.random() * 1000000)}`;
  const first = await claimProviderAction({
    action: "voice_call",
    channel: "voice",
    target,
    payload: { body: "one" },
    maxPerMinute: 1,
  });
  assert.equal(first.ok, true);

  const second = await claimProviderAction({
    action: "voice_call",
    channel: "voice",
    target,
    payload: { body: "two" },
    maxPerMinute: 1,
  });
  assert.equal(second.ok, false);
  if (second.ok) throw new Error("rate limit did not fire");
  assert.equal(second.status, 429);
}));
