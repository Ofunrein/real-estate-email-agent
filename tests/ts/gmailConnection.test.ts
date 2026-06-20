import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sendGmailReply,
  signedGmailOAuthState,
  verifyGmailOAuthState,
} from "@/lib/gmailConnection";

test("gmail oauth state is signed and carries client/operator", () => {
  const prior = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-secret";
  try {
    const state = signedGmailOAuthState({
      clientId: "ryse-realty",
      operatorEmail: "operator@example.com",
      next: "/",
    });
    assert.deepEqual(verifyGmailOAuthState(state), {
      clientId: "ryse-realty",
      operatorEmail: "operator@example.com",
      next: "/",
    });
    assert.throws(() => verifyGmailOAuthState(`${state}x`), /signature|state/i);
  } finally {
    if (prior == null) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prior;
  }
});

test("sendGmailReply sends threaded raw message", async () => {
  const calls: unknown[] = [];
  const gmail = {
    users: {
      messages: {
        send: async (input: unknown) => {
          calls.push(input);
        },
      },
    },
  };

  await sendGmailReply(gmail as never, {
    to: "lead@example.com",
    subject: "Property question",
    body: "Here are the details.",
    threadId: "18abcdef12345678",
    messageId: "<original@example.com>",
    references: "<root@example.com>",
  });

  assert.equal(calls.length, 1);
  const call = calls[0] as { userId: string; requestBody: { raw: string; threadId?: string } };
  assert.equal(call.userId, "me");
  assert.equal(call.requestBody.threadId, "18abcdef12345678");
  const decoded = Buffer.from(call.requestBody.raw, "base64url").toString("utf8");
  assert.match(decoded, /To: lead@example.com/);
  assert.match(decoded, /Subject: Re: Property question/);
  assert.match(decoded, /In-Reply-To: <original@example.com>/);
  assert.match(decoded, /Here are the details\./);
});
