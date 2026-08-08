import assert from "node:assert/strict";
import test from "node:test";

import { irisReplySendEventData } from "../../lib/irisReplyQueue";

test("reply send event carries the originating workspace tenant", () => {
  assert.deepEqual(irisReplySendEventData("sms:SM123", "ryse-realty"), {
    dedupeKey: "sms:SM123",
    clientId: "ryse-realty",
  });
});

test("reply send event omits an empty workspace instead of inventing a tenant", () => {
  assert.deepEqual(irisReplySendEventData("email:abc", ""), {
    dedupeKey: "email:abc",
  });
});
