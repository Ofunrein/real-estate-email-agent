import { expect, test } from "@playwright/test";
import {
  approveDemoRoom,
  type DemoRow,
  demoUrlForToken,
  emailDomain,
  listDemoRows,
  sendDemoOutreach,
  toDemoSummary,
} from "../lib/demo-admin-service";

const TOKEN = "a".repeat(43);

const row: DemoRow = {
  id: "room-1",
  full_name: "Enrique Sold",
  business_name: "Mr. Sold",
  email: "Enrique@MrSold.com",
  address: "123 Main St, Austin, TX",
  status: "draft",
  access_token: TOKEN,
  subject: "I built you an AI agent to try for free",
  body: "Hi Enrique,",
  outreach_status: "draft",
  created_at: "2026-09-08T00:00:00.000Z",
};

/** Minimal Turso stub: matches on a query fragment, records calls. */
function stubSql(handlers: Array<[RegExp, Record<string, string | number | null>[]]>) {
  const calls: Array<{ query: string; args: unknown[] }> = [];
  const exec = (async (query: string, args: (string | number | null)[] = []) => {
    calls.push({ query, args });
    for (const [pattern, rows] of handlers) if (pattern.test(query)) return rows;
    return [];
  }) as unknown as typeof listDemoRows extends (exec: infer E) => unknown ? E : never;
  return { exec, calls };
}

test("demo urls keep the exact already-sent lumenosis.com shape", () => {
  expect(demoUrlForToken(TOKEN)).toBe(`https://lumenosis.com/demo/${TOKEN}`);
  expect(demoUrlForToken(TOKEN)).not.toContain("trylumenosis");
});

test("the list summary exposes an email domain, never the prospect mailbox", () => {
  const summary = toDemoSummary(row);
  expect(summary.emailDomain).toBe("mrsold.com");
  expect(JSON.stringify(summary)).not.toContain("Enrique@");
  expect(JSON.stringify(summary)).not.toContain("enrique@");
  expect(summary).not.toHaveProperty("body");
  expect(summary).not.toHaveProperty("access_token");
  expect(summary.demoUrl).toBe(`https://lumenosis.com/demo/${TOKEN}`);
  expect(emailDomain("no-at-sign")).toBe("");
});

test("list uses one joined read of the existing schema", async () => {
  const { exec, calls } = stubSql([[/FROM demo_rooms/, [row as never]]]);
  const rows = await listDemoRows(exec as never);
  expect(rows).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(calls[0].query).toContain("ORDER BY d.created_at DESC");
});

test("approve is idempotent: an already-approved room still returns ok", async () => {
  const { exec, calls } = stubSql([
    [/SELECT status, approved_at/, [{ status: "approved", approved_at: "t" }]],
  ]);
  expect(await approveDemoRoom("room-1", exec as never)).toEqual({
    ok: true,
    approved: true,
    alreadyApproved: false,
  });
  expect(calls[0].query).toContain("AND status = 'draft'");

  const second = stubSql([
    [/SELECT status, approved_at/, [{ status: "approved", approved_at: "t" }]],
  ]);
  expect(await approveDemoRoom("room-1", second.exec as never)).toEqual({
    ok: true,
    approved: true,
    alreadyApproved: false,
  });
});

test("approve reports not_found for a missing room", async () => {
  const { exec } = stubSql([]);
  expect(await approveDemoRoom("nope", exec as never)).toEqual({ ok: false, reason: "not_found" });
});

test("send does not double-send an already-sent draft", async () => {
  const { exec, calls } = stubSql([[/SELECT status FROM outreach_drafts/, [{ status: "sent" }]]]);
  let fetched = 0;
  const result = await sendDemoOutreach(
    "room-1",
    exec as never,
    (async () => {
      fetched += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  );
  expect(result).toEqual({ ok: true, alreadySent: true });
  expect(fetched).toBe(0);
  expect(calls[0].query).toContain("o.status = 'draft'");
  expect(calls[0].query).toContain("d.status = 'approved'");
});

test("send reports not_found when there is no draft at all", async () => {
  const { exec } = stubSql([]);
  const result = await sendDemoOutreach(
    "room-1",
    exec as never,
    (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch,
  );
  expect(result).toEqual({ ok: false, reason: "not_found" });
});

test("send requires an approved draft and marks it sent exactly once", async () => {
  process.env.AGENTMAIL_API_KEY = ["agentmail", "test-key-000000"].join("-");
  const { exec, calls } = stubSql([
    [
      /FROM outreach_drafts o/,
      [
        {
          id: "draft-1",
          sender_inbox: "iris-demo@agentmail.to",
          recipient: "enrique@mrsold.com",
          subject: "s",
          body: "Hi Enrique,",
        },
      ],
    ],
  ]);
  const result = await sendDemoOutreach(
    "room-1",
    exec as never,
    (async () =>
      new Response(JSON.stringify({ message_id: "m-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  );
  expect(result).toEqual({ ok: true, alreadySent: false });
  const update = calls.find((call) => call.query.includes("SET status = 'sent'"));
  expect(update?.query).toContain("AND status = 'draft'");
  expect(update?.args).toContain("m-1");
  process.env.AGENTMAIL_API_KEY = "";
});

test("a provider failure never marks a draft sent", async () => {
  process.env.AGENTMAIL_API_KEY = ["agentmail", "test-key-000000"].join("-");
  const { exec, calls } = stubSql([
    [
      /FROM outreach_drafts o/,
      [
        {
          id: "draft-1",
          sender_inbox: "iris-demo@agentmail.to",
          recipient: "enrique@mrsold.com",
          subject: "s",
          body: "Hi Enrique,",
        },
      ],
    ],
  ]);
  const result = await sendDemoOutreach(
    "room-1",
    exec as never,
    (async () => new Response("", { status: 502 })) as unknown as typeof fetch,
  );
  expect(result).toEqual({ ok: false, reason: "provider_failed" });
  expect(calls.some((call) => call.query.includes("SET status = 'sent'"))).toBe(false);
  process.env.AGENTMAIL_API_KEY = "";
});

test("send is not_configured without an AgentMail key", async () => {
  process.env.AGENTMAIL_API_KEY = "";
  const { exec } = stubSql([
    [
      /FROM outreach_drafts o/,
      [
        {
          id: "draft-1",
          sender_inbox: "iris-demo@agentmail.to",
          recipient: "enrique@mrsold.com",
          subject: "s",
          body: "b",
        },
      ],
    ],
  ]);
  const result = await sendDemoOutreach(
    "room-1",
    exec as never,
    (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch,
  );
  expect(result).toEqual({ ok: false, reason: "not_configured" });
});
