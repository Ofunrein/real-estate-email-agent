import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type DemoQuery,
  approveDemo,
  demoClientId,
  demoOwnershipEnabled,
  demoUrlForToken,
  emailDomain,
  listDemos,
  sendDemoOutreach,
  toDemoSummary,
} from "@/lib/demoOwnershipStore";

/**
 * Behavioural tests for the central Postgres ownership store.
 *
 * These drive the real SQL through an injected query function, so they assert the
 * statements this module actually emits (tenant predicates, claim/release ordering,
 * verbatim token handling) rather than a reimplementation of them.
 *
 * The schema-level guarantees these depend on — that the roles cannot exceed their
 * grants, that ON CONFLICT is inferable, that a resumed migration copies only the
 * remainder — are exercised against a real Postgres by
 * docs/proof/demo-ownership-verification.md, not asserted here.
 */

type Call = { text: string; values: unknown[] };

/** Records every statement and replays scripted result sets in order. */
function recorder(results: Array<Record<string, unknown>[]>) {
  const calls: Call[] = [];
  const query: DemoQuery = async (text, values = []) => {
    calls.push({ text, values });
    return { rows: results[calls.length - 1] ?? [] };
  };
  return { calls, query };
}

const ROW = {
  id: "d1",
  full_name: "Dana Reed",
  business_name: "Reed Realty",
  email: "dana@reedrealty.com",
  address: "12 Oak St",
  status: "approved",
  access_token: "E5rW-example-existing-token_abc",
  subject: "Your listing",
  outreach_status: "draft",
  created_at: "2026-01-02 03:04:05",
};

test("demo URLs are reproduced verbatim, never re-derived or rotated", () => {
  // The exact string already sent to a prospect. If this changes, live links break.
  assert.equal(
    demoUrlForToken("E5rW-example-existing-token_abc"),
    "https://lumenosis.com/demo/E5rW-example-existing-token_abc",
  );
  // Tokens are opaque: no encoding, trimming, or case normalisation is applied.
  for (const token of ["a.b~c", "UPPER_lower-123", "%2F", " leading"]) {
    assert.equal(demoUrlForToken(token), `https://lumenosis.com/demo/${token}`);
  }
});

test("a summary exposes the mailbox domain only, never the prospect address", () => {
  const summary = toDemoSummary(ROW);
  assert.equal(summary.emailDomain, "reedrealty.com");
  assert.equal(JSON.stringify(summary).includes("dana@reedrealty.com"), false);
  // Every preserved field survives the mapping unmodified.
  assert.equal(summary.id, "d1");
  assert.equal(summary.status, "approved");
  assert.equal(summary.createdAt, "2026-01-02 03:04:05");
  assert.equal(summary.demoUrl, "https://lumenosis.com/demo/E5rW-example-existing-token_abc");
});

test("emailDomain handles absent and unusual addresses without throwing", () => {
  assert.equal(emailDomain(""), "");
  assert.equal(emailDomain("no-at-sign"), "");
  assert.equal(emailDomain("Mixed@CASE.Example.COM"), "case.example.com");
  // Only the final @ separates the domain.
  assert.equal(emailDomain("weird@name@host.test"), "host.test");
});

test("listDemos scopes every read to the caller's tenant", async () => {
  const { calls, query } = recorder([[ROW]]);
  const demos = await listDemos("tenant-a", query);

  assert.equal(demos.length, 1);
  assert.equal(calls[0].values[0], "tenant-a");
  // Each joined table is constrained to the same tenant, so a foreign row cannot be
  // reached by id through any of the joins.
  const sql = calls[0].text;
  assert.match(sql, /where d\.client_id = \$1/);
  assert.match(sql, /p\.client_id = d\.client_id/);
  assert.match(sql, /l\.client_id = d\.client_id/);
  assert.match(sql, /o\.client_id = d\.client_id/);
});

test("the tenant id resolves from DEMO_CLIENT_ID, then CLIENT_ID, then a default", () => {
  assert.equal(demoClientId({ DEMO_CLIENT_ID: "a", CLIENT_ID: "b" }), "a");
  assert.equal(demoClientId({ CLIENT_ID: "b" }), "b");
  assert.equal(demoClientId({}), "default");
  // Whitespace-only configuration must not produce an empty tenant predicate.
  assert.equal(demoClientId({ DEMO_CLIENT_ID: "   " }), "default");
});

test("ownership is off unless the flag names postgres exactly", () => {
  assert.equal(demoOwnershipEnabled({}), false);
  assert.equal(demoOwnershipEnabled({ DEMO_DATA_OWNER: "postgres" }), true);
  // Fail closed: anything else leaves the pre-cutover path in charge.
  for (const value of ["POSTGRES", "true", "1", "neon", ""]) {
    assert.equal(
      demoOwnershipEnabled({ DEMO_DATA_OWNER: value }),
      false,
      value,
    );
  }
});

test("approve only transitions a draft and stamps approved_at on that transition", async () => {
  const { calls, query } = recorder([[{ id: "d1" }]]);
  const result = await approveDemo("d1", "tenant-a", query);

  assert.deepEqual(result, { ok: true, approved: true, alreadyApproved: false });
  assert.match(calls[0].text, /status = 'draft'/);
  assert.match(calls[0].text, /approved_at = to_char/);
  assert.deepEqual(calls[0].values, ["d1", "tenant-a"]);
});

test("a replayed approve is idempotent rather than an error", async () => {
  // No row updated (already approved), then the re-read reports 'approved'.
  const { query } = recorder([[], [{ status: "approved" }]]);
  const result = await approveDemo("d1", "tenant-a", query);
  assert.deepEqual(result, { ok: true, approved: true, alreadyApproved: true });
});

test("approving an unknown or foreign-tenant room reports not_found", async () => {
  const { query } = recorder([[], []]);
  assert.deepEqual(await approveDemo("nope", "tenant-a", query), { ok: false, reason: "not_found" });
});

const DRAFT = {
  id: "o1",
  sender_inbox: "iris-demo@agentmail.to",
  recipient: "dana@reedrealty.com",
  subject: "Your listing",
  body: "Hello Dana",
};

test("send claims the draft before contacting the provider, so concurrent sends cannot both win", async () => {
  const { calls, query } = recorder([[DRAFT], [{ id: "o1" }], []]);
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ message_id: "m1" }), { status: 200 })) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  assert.deepEqual(result, { ok: true, alreadySent: false });
  // The claim is a conditional UPDATE: unclaimed draft, approved room, same tenant.
  const claim = calls[0].text;
  assert.match(claim, /set idempotency_key = \$3/);
  assert.match(claim, /o\.status = 'draft'/);
  assert.match(claim, /o\.idempotency_key is null/);
  assert.match(claim, /d\.status = 'approved'/);
  assert.match(claim, /o\.client_id = \$2/);
});

test("a provider failure releases the claim so the draft stays sendable", async () => {
  const { calls, query } = recorder([[DRAFT], []]);
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  assert.deepEqual(result, { ok: false, reason: "provider_failed" });
  // Released by matching the claim token, never marked sent.
  assert.match(calls[1].text, /set idempotency_key = null/);
  assert.deepEqual(calls[1].values, ["o1", "claim-1"]);
  assert.equal(
    calls.some((call) => /status = 'sent'/.test(call.text)),
    false,
    "a failed provider call must not mark the draft sent",
  );
});

test("an ambiguous network failure retains the claim so a retry cannot duplicate delivery", async () => {
  const { calls, query } = recorder([[DRAFT]]);
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED 10.0.0.1:443");
  }) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  assert.deepEqual(result, { ok: false, reason: "delivery_uncertain" });
  assert.equal(calls.length, 1, "an ambiguous delivery must retain its claim");
});

test("retry after an ambiguous delivery does not make a second provider request", async () => {
  const { query } = recorder([
    [DRAFT],
    [],
    [{ status: "draft", idempotency_key: "claim-1" }],
  ]);
  let providerCalls = 0;
  const fetchImpl = (async () => {
    providerCalls += 1;
    throw new Error("ETIMEDOUT");
  }) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const first = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  const retry = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-2");
  delete process.env.AGENTMAIL_API_KEY;

  assert.deepEqual(first, { ok: false, reason: "delivery_uncertain" });
  assert.deepEqual(retry, { ok: false, reason: "delivery_uncertain" });
  assert.equal(providerCalls, 1);
});

test("a missing provider key performs no claim and never reaches the network", async () => {
  const { calls, query } = recorder([]);
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;

  delete process.env.AGENTMAIL_API_KEY;
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");

  assert.deepEqual(result, { ok: false, reason: "not_configured" });
  assert.equal(called, false);
  assert.equal(calls.length, 0);
});

test("an already-sent draft reports alreadySent instead of sending twice", async () => {
  // Claim matches nothing; the re-read shows the draft is already sent.
  const { query } = recorder([[], [{ status: "sent" }]]);
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  assert.deepEqual(result, { ok: true, alreadySent: true });
  assert.equal(called, false, "a replayed send must not contact the provider again");
});

test("an unapproved room cannot be sent", async () => {
  const { query } = recorder([[], [{ status: "draft" }]]);
  const fetchImpl = (async () => new Response("{}")) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("a malformed provider response still marks the send complete", async () => {
  const { calls, query } = recorder([[DRAFT], [{ id: "o1" }], []]);
  const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  const result = await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  // The email did leave; releasing the claim here would risk a duplicate send.
  assert.deepEqual(result, { ok: true, alreadySent: false });
  assert.match(calls[1].text, /status = 'sent'/);
  assert.equal(calls[1].values[2], "", "no provider id recorded when the body is unreadable");
});

test("a successful send marks sent and advances the prospect, both tenant-scoped", async () => {
  const { calls, query } = recorder([[DRAFT], [{ id: "o1" }], []]);
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ message_id: "m1" }), { status: 200 })) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  assert.match(calls[1].text, /status = 'sent'/);
  assert.match(calls[1].text, /provider_message_id = \$3/);
  assert.match(calls[1].text, /idempotency_key = null/);
  assert.equal(calls[1].values[1], "tenant-a");

  assert.match(calls[2].text, /update demo_prospects/);
  assert.match(calls[2].text, /status = 'contacted'/);
  assert.equal(calls[2].values[1], "tenant-a");
});

test("the outbound send body carries the rendered email and an unsubscribe header", async () => {
  const { query } = recorder([[DRAFT], [{ id: "o1" }], []]);
  let sent: { body: string } | null = null;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent = { body: String(init.body) };
    return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;

  process.env.AGENTMAIL_API_KEY = "example-not-a-real-key-placeholder";
  await sendDemoOutreach("d1", "tenant-a", query, fetchImpl, "claim-1");
  delete process.env.AGENTMAIL_API_KEY;

  const payload = JSON.parse(sent!.body);
  assert.equal(payload.to, "dana@reedrealty.com");
  assert.equal(payload.subject, "Your listing");
  assert.match(payload.html, /Hello Dana/);
  assert.equal(payload.text, "Hello Dana");
  assert.match(payload.headers["List-Unsubscribe"], /^<mailto:iris-demo@agentmail\.to/);
});
