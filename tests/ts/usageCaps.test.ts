import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { checkUsageCap, usageCaps } from "@/lib/usageCaps";

function resetUsageEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const prior = { ...process.env };
  delete process.env.DATABASE_URL;
  delete process.env.CLIENT_DAILY_AI_COST_USD_CAP;
  delete process.env.CLIENT_DAILY_SMS_CAP;
  delete process.env.CLIENT_DAILY_VOICE_CALL_CAP;
  delete process.env.USAGE_CAP_FAILURE_MODE;
  Object.assign(process.env, env);
  return prior;
}

function withEnv<T>(env: NodeJS.ProcessEnv, run: () => T): T {
  const prior = resetUsageEnv(env);
  try {
    return run();
  } finally {
    process.env = prior;
  }
}

async function withEnvAsync<T>(env: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T> {
  const prior = resetUsageEnv(env);
  try {
    return await run();
  } finally {
    process.env = prior;
  }
}

test("no cap configured means uncapped, not blocked", async () => {
  // A missing env var must never be read as "limit of zero" — that would take a
  // client's agent offline on a typo.
  const verdict = await withEnvAsync({}, () => checkUsageCap("sms"));
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.limit, 0);
  assert.equal(verdict.reason, "uncapped");
});

test("a zero or negative cap is treated as uncapped", async () => {
  for (const value of ["0", "-5", "not-a-number", ""]) {
    const verdict = await withEnvAsync({ CLIENT_DAILY_SMS_CAP: value }, () => checkUsageCap("sms"));
    assert.equal(verdict.allowed, true, `cap=${value}`);
  }
});

test("configured caps fail closed when the database is unreachable", async () => {
  const verdict = await withEnvAsync(
    { CLIENT_DAILY_SMS_CAP: "10", DATABASE_URL: "postgres://invalid:1/none" },
    () => checkUsageCap("sms"),
  );
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "unavailable");
});

test("an explicit availability-first override may fail open", async () => {
  const verdict = await withEnvAsync(
    {
      CLIENT_DAILY_SMS_CAP: "10",
      DATABASE_URL: "postgres://invalid:1/none",
      USAGE_CAP_FAILURE_MODE: "open",
    },
    () => checkUsageCap("sms"),
  );
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.code, "unavailable");
});

test("usageCaps reports each configured limit", () => {
  const caps = withEnv(
    { CLIENT_DAILY_AI_COST_USD_CAP: "25", CLIENT_DAILY_SMS_CAP: "500", CLIENT_DAILY_VOICE_CALL_CAP: "100" },
    () => usageCaps(),
  );
  assert.deepEqual(caps, { ai: 25, sms: 500, voice: 100 });
});

test("with no database the usage read is zero, so a cap cannot spuriously trip", async () => {
  const verdict = await withEnvAsync({ CLIENT_DAILY_AI_COST_USD_CAP: "25" }, () => checkUsageCap("ai"));
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.used, 0);
  assert.equal(verdict.limit, 25);
});

test("the SMS cap counts provider sends, not every audit row marked \"sent\"", () => {
  // writeTheoMetricAuditEvents marks each successful LLM call outcome "sent"
  // with channel "sms", and the webhook's respond() adds another. Counting
  // those made a 500-message cap trip after roughly 100 real texts — a silent
  // outage for a paying client. The predicate must pin stage = 'send'.
  const source = readFileSync(new URL("../../lib/usageCaps.ts", import.meta.url), "utf8");
  const smsQuery = source.slice(source.indexOf("const channel = kind ==="));
  assert.match(smsQuery, /stage = 'send'/);
  assert.match(smsQuery, /outcome = 'sent'/);
});

test("every send path that a cap counts writes the row the cap reads", () => {
  // The cap and the writer have to agree on stage/channel or the cap reads
  // zero forever. These are the two writers.
  const replySend = readFileSync(new URL("../../lib/inngest/functions/messageReplySend.ts", import.meta.url), "utf8");
  assert.match(replySend, /stage: "send"/);
  assert.match(replySend, /outcome: "sent"/);

  const voice = readFileSync(new URL("../../app/api/aria/outbound/route.ts", import.meta.url), "utf8");
  assert.match(voice, /channel: "voice"/);
  assert.match(voice, /stage: "send"/);
  assert.match(voice, /checkUsageCap\("voice"\)/);
});
