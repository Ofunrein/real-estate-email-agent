import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emailCapabilitiesForScopes,
  ensureGmailLabel,
  GMAIL_AGENT_SCOPES,
  GMAIL_LABELS_SCOPE,
  GMAIL_SEND_SCOPE,
  GOOGLE_DRIVE_METADATA_SCOPE,
  GOOGLE_SHEETS_SCOPE,
  gmailScopesForMode,
  replaceGmailThreadLabels,
  sendGmailReply,
  signedGmailOAuthState,
  verifyGmailOAuthState,
} from "@/lib/gmailConnection";

test("replaceGmailThreadLabels atomically swaps managed workflow labels on the thread", async () => {
  let modifyInput: unknown;
  const gmail = {
    users: {
      labels: {
        list: async () => ({
          data: {
            labels: [
              { id: "auto", name: "AUTO_REPLIED" },
              { id: "human", name: "NEEDS_HUMAN" },
              { id: "needs-human", name: "Needs Human" },
              { id: "waiting", name: "Waiting on Reply" },
              { id: "UNREAD", name: "UNREAD" },
            ],
          },
        }),
        create: async () => {
          throw new Error("all requested labels already exist");
        },
      },
      threads: {
        modify: async (input: unknown) => {
          modifyInput = input;
        },
      },
      messages: { modify: async () => undefined },
    },
  };

  await replaceGmailThreadLabels(gmail as never, {
    threadId: "18abcdef12345678",
    messageId: "message-1",
    addLabelNames: ["AUTO_REPLIED", "Waiting on Reply"],
    managedLabelNames: ["AUTO_REPLIED", "NEEDS_HUMAN", "Needs Human", "Waiting on Reply", "UNREAD"],
  });

  assert.deepEqual(modifyInput, {
    userId: "me",
    id: "18abcdef12345678",
    requestBody: {
      addLabelIds: ["auto", "waiting"],
      removeLabelIds: ["human", "needs-human", "UNREAD"],
    },
  });
});

test("needs-human Gmail label uses a supported Gmail palette color", async () => {
  let requestBody: unknown;
  const gmail = {
    users: {
      labels: {
        list: async () => ({ data: { labels: [] } }),
        create: async (input: { requestBody: unknown }) => {
          requestBody = input.requestBody;
          return { data: { id: "label-needs-human" } };
        },
      },
    },
  };

  await ensureGmailLabel(gmail as never, "Needs Human", "#be123c");
  // #be123c snaps to the nearest legal Gmail background (#ac2b16, a dark red);
  // white text is auto-picked for contrast.
  assert.deepEqual((requestBody as { color: unknown }).color, {
    backgroundColor: "#ac2b16",
    textColor: "#ffffff",
  });
});

test("gmail oauth state is signed and carries client/operator", () => {
  const prior = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-secret";
  try {
    const state = signedGmailOAuthState({
      clientId: "austin-realty",
      operatorEmail: "operator@example.com",
      next: "/",
    });
    assert.deepEqual(verifyGmailOAuthState(state), {
      clientId: "austin-realty",
      operatorEmail: "operator@example.com",
      next: "/",
    });
    assert.throws(() => verifyGmailOAuthState(`${state}x`), /signature|state/i);
  } finally {
    if (prior == null) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prior;
  }
});

test("gmail scopes are tiered and draft-first by default", () => {
  assert.deepEqual([...GMAIL_AGENT_SCOPES], [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_DRIVE_METADATA_SCOPE,
  ]);
  assert.ok(!gmailScopesForMode("draft").includes(GMAIL_SEND_SCOPE));
  assert.ok(gmailScopesForMode("autosend").includes(GMAIL_SEND_SCOPE));
  const capabilities = emailCapabilitiesForScopes([GMAIL_LABELS_SCOPE]);
  assert.equal(capabilities.find((item) => item.scope === GMAIL_LABELS_SCOPE)?.granted, true);
  assert.equal(capabilities.find((item) => item.scope === GMAIL_SEND_SCOPE)?.granted, false);
});

test("sendGmailReply sends threaded raw message", async () => {
  const calls: unknown[] = [];
  const gmail = {
    users: {
      threads: {
        get: async (input: unknown) => {
          calls.push({ threadGet: input });
        },
      },
      messages: {
        send: async (input: unknown) => {
          calls.push(input);
          return { data: { id: "sent-message", threadId: "18abcdef12345678" } };
        },
      },
    },
  };

  const result = await sendGmailReply(gmail as never, {
    to: "lead@example.com",
    subject: "Property question",
    body: "Here are the details.",
    htmlBody: [
      '<div style="border:1px solid #ddd"><img src="https://app.example.com/api/media/image-proxy?url=photo">',
      '<strong>100 E 51st St #7</strong><br><span>$843,900 · 4 beds · 3 baths</span>',
      '<br><a href="https://www.zillow.com/homedetails/example">View Property</a></div>',
    ].join(""),
    threadId: "18abcdef12345678",
    messageId: "<original@example.com>",
    references: "<root@example.com>",
  });

  assert.equal(calls.length, 2);
  assert.deepEqual((calls[0] as { threadGet: { id: string } }).threadGet.id, "18abcdef12345678");
  assert.equal(result.threaded, true);
  const call = calls[1] as { userId: string; requestBody: { raw: string; threadId?: string } };
  assert.equal(call.userId, "me");
  assert.equal(call.requestBody.threadId, "18abcdef12345678");
  const decoded = Buffer.from(call.requestBody.raw, "base64url").toString("utf8");
  assert.match(decoded, /To: lead@example.com/);
  assert.match(decoded, /Subject: Re: Property question/);
  assert.match(decoded, /In-Reply-To: <original@example.com>/);
  assert.match(decoded, /Here are the details\./);
  assert.match(decoded, /Content-Type: multipart\/alternative/);
  assert.match(decoded, /100 E 51st St #7/);
  assert.match(decoded, /\$843,900 · 4 beds · 3 baths/);
  assert.match(decoded, /api\/media\/image-proxy/);
  assert.match(decoded, /View Property/);
});

test("sendGmailReply retries fresh when thread is missing in active mailbox", async () => {
  const calls: unknown[] = [];
  const gmail = {
    users: {
      threads: {
        get: async () => {
          const error = new Error("Requested entity was not found.");
          (error as Error & { code?: number }).code = 404;
          throw error;
        },
      },
      messages: {
        send: async (input: unknown) => {
          calls.push(input);
          return { data: { id: "fresh-message", threadId: "new-thread" } };
        },
      },
    },
  };

  const result = await sendGmailReply(gmail as never, {
    to: "lead@example.com",
    subject: "Property question",
    body: "Fresh reply.",
    threadId: "18abcdef12345678",
  });

  assert.equal(calls.length, 1);
  const call = calls[0] as { requestBody: { threadId?: string } };
  assert.equal(call.requestBody.threadId, undefined);
  assert.equal(result.threaded, false);
  assert.equal(result.threadId, "new-thread");
  assert.match(result.fallbackReason || "", /not found/i);
});

test("sendGmailReply does not retry on auth or scope errors", async () => {
  const calls: unknown[] = [];
  const gmail = {
    users: {
      threads: {
        get: async () => {
          const error = new Error("Insufficient Permission");
          (error as Error & { code?: number }).code = 403;
          throw error;
        },
      },
      messages: {
        send: async (input: unknown) => {
          calls.push(input);
          return { data: { id: "should-not-send", threadId: "thread" } };
        },
      },
    },
  };

  await assert.rejects(() => sendGmailReply(gmail as never, {
    to: "lead@example.com",
    subject: "Property question",
    body: "No retry.",
    threadId: "18abcdef12345678",
  }), /Insufficient Permission/);
  assert.equal(calls.length, 0);
});
