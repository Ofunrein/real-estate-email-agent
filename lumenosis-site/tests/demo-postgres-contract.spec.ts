import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const root = process.cwd();

async function source(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

test("Postgres cutover uses the exact PR #7 function contract", async () => {
  const postgres = await source("lib/demo-postgres.ts");
  expect(postgres).toContain(
    "select id, config_json, expires_at from demo_public_api.lookup_room($1)",
  );
  expect(postgres).toContain("select demo_public_api.record_engagement($1, $2, $3) as accepted");
  expect(postgres).toContain("select demo_public_api.reserve_email_generation($1) as accepted");
  expect(postgres).not.toMatch(/\bfrom\s+demo_rooms\b/i);
  expect(postgres).not.toMatch(/\binsert\s+into\s+demo_engagement_events\b/i);
});

test("only exact postgres selects direct Neon and missing URLs fail closed", async () => {
  const postgres = await source("lib/demo-postgres.ts");
  const room = await source("lib/demo-room.ts");
  expect(postgres).toContain('env.DEMO_DATA_SOURCE === "postgres"');
  expect(postgres).toContain("is required when DEMO_DATA_SOURCE=postgres");
  expect(room.indexOf("if (demoPostgresEnabled())")).toBeLessThan(
    room.indexOf("if (tursoConfigured())"),
  );
  const branch = room.match(/if \(demoPostgresEnabled\(\)\) \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
  expect(branch).toContain("if (!row) return null");
  expect(branch).not.toContain("turso");
  expect(branch).not.toContain("demoRooms.find");
});

test("site receives only least-privilege URLs and verifies Neon TLS", async () => {
  const postgres = await source("lib/demo-postgres.ts");
  const env = await source("lib/env.ts");
  const example = await source(".env.example");
  for (const name of ["DEMO_DATA_SOURCE", "DEMO_READ_DATABASE_URL", "DEMO_WRITE_DATABASE_URL"]) {
    expect(env).toContain(name);
    expect(example).toContain(`${name}=`);
  }
  expect(postgres).toContain("rejectUnauthorized: true");
  expect(postgres).not.toContain("process.env.DATABASE_URL");
  expect(example).not.toMatch(/^DATABASE_URL=/m);
});

test("event and generation writes switch with the same exact source flag", async () => {
  const event = await source("app/api/demo/[token]/event/route.ts");
  const budget = await source("lib/demo-budget.ts");
  expect(event).toContain("if (demoPostgresEnabled())");
  expect(event).toContain("recordPostgresDemoEngagement(");
  expect(event).toContain("} else if (tursoConfigured()");
  expect(budget).toContain("if (demoPostgresEnabled())");
  expect(budget).toContain("reservePostgresDemoGeneration(");
});

test("token remains the lookup input and is never re-derived from a slug", async () => {
  const postgres = await source("lib/demo-postgres.ts");
  const room = await source("lib/demo-room.ts");
  expect(postgres).toContain("tokenHash(token)");
  expect(room).toContain("postgresDemoRoomForToken(token)");
  expect(postgres).not.toContain("tokenForDemoRoom");
  expect(postgres).not.toContain("DEMO_ROOM_SECRET");
});
