import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const root = process.cwd();

async function source(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

async function migration() {
  return readFile(`${root}/../db/migrations/035_demo_voice_session_cap.sql`, "utf8");
}

// The bug this guards: the voice route's only cap was an in-process Map, so on Vercel the
// "3 sessions per day" limit was really "3 per serverless instance per day" and each paid Vapi
// session is real money. These assertions pin the durable path, not the wording of the SQL.

test("voice route reserves a durable session before handing out Vapi credentials", async () => {
  const route = await source("app/api/demo/[token]/voice/route.ts");
  expect(route).toContain("reservePostgresVoiceSession(");
  expect(route).toContain("demoPostgresEnabled()");

  // The reservation must happen BEFORE the response that contains publicKey/assistantId,
  // otherwise a caller can start a call without ever being counted.
  const reserveAt = route.indexOf("reservePostgresVoiceSession(");
  const publicKeyAt = route.indexOf("process.env.VAPI_PUBLIC_KEY");
  expect(reserveAt).toBeGreaterThan(-1);
  expect(reserveAt).toBeLessThan(publicKeyAt);

  // A database failure must not degrade into unlimited paid minutes.
  expect(route).toMatch(/catch[\s\S]{0,200}status:\s*503/);
  expect(route).toMatch(/reserved[\s\S]{0,200}status:\s*429/);
});

test("voice reservation goes through the least-privilege function, never a raw table write", async () => {
  const postgres = await source("lib/demo-postgres.ts");
  expect(postgres).toContain("select demo_public_api.reserve_voice_session($1) as accepted");
  expect(postgres).toContain("tokenHash(token)");
  // Same boundary the email cap already respects: no direct table access from the site.
  expect(postgres).not.toMatch(/\binsert\s+into\s+demo_engagement_events\b/i);
  expect(postgres).not.toMatch(/\bfrom\s+demo_rooms\b/i);
});

test("in-memory limiter is not documented as a spend cap", async () => {
  const limiter = await source("lib/demo-rate-limit.ts");
  // Stops a future reader from reintroducing money-bounded limits in the Map.
  expect(limiter).toContain("reserve_voice_session");
  expect(limiter).not.toContain("replace with shared KV");
});

test("migration 035 enforces the cap atomically and stays least-privilege", async () => {
  const sql = await migration();

  // security definer + a lock is what makes the count-then-insert race-free.
  expect(sql).toContain("security definer");
  expect(sql).toContain("set search_path = pg_catalog");
  expect(sql).toContain("for update");
  expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");

  // Only approved rooms may reserve, and the function must not distinguish unknown from over-cap.
  expect(sql).toMatch(/status\s*=\s*'approved'/);

  // Both ceilings present: per-room and client-wide.
  expect(sql).toMatch(/>=\s*3\s+then\s+return\s+false/i);
  expect(sql).toMatch(/>=\s*40\s+then\s+return\s+false/i);
  expect(sql).toContain("voice_session_started");

  // Grants: revoked from the world, executable only by the writer role.
  expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+demo_public_api\.reserve_voice_session/i);
  expect(sql).toMatch(/to\s+demo_engagement_writer/i);
  expect(sql).not.toMatch(/grant[\s\S]{0,80}\bto\s+public\b/i);

  // Idempotent so re-application is safe.
  expect(sql).toContain("create or replace function");
});
