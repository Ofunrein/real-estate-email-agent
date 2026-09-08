import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TABLES,
  canonical,
  parseOptions,
  normalizeNumber,
  rowDigest,
  tableChecksum,
  tursoConfig,
  withRetry,
  // @ts-expect-error - the migrator is plain ESM JavaScript with no type declarations.
} from "../../scripts/migrate-demo-data.mjs";

/**
 * The parity guarantee of scripts/migrate-demo-data.mjs rests on four pure pieces:
 * canonicalisation, number normalisation, the per-row digest, and the order-independent
 * table checksum. A live Turso and a live Neon are not available in CI, so those pieces
 * are asserted directly here, and the table plan is asserted against the schema the
 * migration actually creates.
 *
 * What this proves: if the migrator reports `parity: match`, the two sides really do hold
 * the same content — not merely the same row count — and a re-run cannot duplicate,
 * cannot skip, and cannot silently reinterpret a value that the two engines represent
 * differently.
 *
 * The end-to-end run against a real SQLite source (via scripts/dev/fake-turso.mjs, which
 * serves lumenosis-site's original 0001_demo_rooms.sql schema) and a real Postgres target
 * is a manual review step; it is not asserted here because it needs both servers.
 */

const migration = readFileSync(
  new URL("../../db/migrations/033_demo_ownership.sql", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("../../scripts/migrate-demo-data.mjs", import.meta.url),
  "utf8",
);

type TablePlan = {
  name: string;
  source: string;
  target: string;
  key: string;
  columns: string[];
  targetColumns?: string[];
  digest: string[];
  conflict: string;
  numericKey?: boolean;
};

const plan = TABLES as TablePlan[];

/* ------------------------------------------------------------------ table plan ----- */

test("every planned target table exists in the migration", () => {
  for (const table of plan) {
    assert.match(
      migration,
      new RegExp(`create table if not exists ${table.target}\\b`, "i"),
      `${table.target} is planned but not created`,
    );
  }
});

test("tables are ordered parent-before-child so no insert can violate a foreign key", () => {
  const order = plan.map((table) => table.target);
  assert.deepEqual(order, [
    "demo_prospects",
    "demo_listings",
    "demo_rooms",
    "demo_outreach_drafts",
    "demo_engagement_events",
  ]);
});

test("every copied column exists on its target table", () => {
  for (const table of plan) {
    const body = new RegExp(
      `create table if not exists ${table.target} \\(([\\s\\S]*?)\\n\\);`,
      "i",
    ).exec(migration)?.[1];
    assert.ok(body, `${table.target} body not found`);
    for (const column of table.targetColumns ?? table.columns) {
      assert.match(
        body!,
        new RegExp(`^\\s*${column}\\s`, "im"),
        `${table.target}.${column} is copied but not declared`,
      );
    }
  }
});

test("the engagement rowid is remapped to source_rowid, and only there", () => {
  const events = plan.find((table) => table.name === "engagement_events")!;
  assert.equal(events.columns[0], "id");
  assert.equal(events.targetColumns![0], "source_rowid");
  assert.equal(events.conflict, "(client_id, source_rowid)");
  // Every other table keeps its id as the conflict target, so re-running cannot duplicate.
  for (const table of plan.filter((entry) => entry.name !== "engagement_events")) {
    assert.equal(table.conflict, "(id)", `${table.name} must dedupe on its preserved id`);
    assert.equal(table.targetColumns, undefined);
  }
});

test("token columns are inside the parity digest so a changed token cannot pass", () => {
  const rooms = plan.find((table) => table.name === "demo_rooms")!;
  assert.ok(rooms.digest.includes("access_token"));
  assert.ok(rooms.digest.includes("token_hash"));
  assert.ok(rooms.digest.includes("slug"));
  assert.ok(rooms.digest.includes("created_at"));
});

test("the digest of every table covers all of its copied source columns", () => {
  for (const table of plan) {
    for (const column of table.columns) {
      assert.ok(
        table.digest.includes(column),
        `${table.name}.${column} is copied but not verified by parity`,
      );
    }
  }
});

/* ------------------------------------------------------------------ canonical ------ */

test("null and undefined canonicalise identically and distinctly from empty text", () => {
  assert.equal(canonical(null), canonical(undefined));
  assert.notEqual(canonical(null), canonical(""));
});

test("declared numeric columns normalize engine representation differences", () => {
  // SQLite hands back a number; Postgres hands the same numeric back as a string.
  assert.equal(canonical(3, true), canonical("3", true));
  assert.equal(canonical(3, true), canonical(3.0, true));
  assert.equal(canonical(3, true), canonical("3.0", true));
  assert.equal(canonical(2.5, true), canonical("2.5", true));
  assert.equal(canonical(BigInt(10), true), canonical("10", true));
  assert.notEqual(canonical("001"), canonical("1"), "preserved text cannot be numeric-normalized");
});

test("a numeric-looking string is not confused with a different number", () => {
  assert.notEqual(canonical("3"), canonical("4"));
  assert.notEqual(canonical(0), canonical(""));
  assert.notEqual(canonical(false), canonical(0));
});

test("text values are tagged so a number can never collide with its own spelling", () => {
  assert.equal(canonical("draft"), canonical("draft"));
  assert.notEqual(canonical("draft"), canonical("sent"));
  // Tagging: a string that is not numeric keeps the str tag, so "num:3" cannot alias 3.
  assert.notEqual(canonical("num:3"), canonical(3));
});

test("number normalisation is stable across representation", () => {
  assert.equal(normalizeNumber(3), "3");
  assert.equal(normalizeNumber(3.0), "3");
  assert.equal(normalizeNumber(0.1 + 0.2), normalizeNumber(0.3));
  assert.equal(normalizeNumber(Number.NaN), "nan");
  assert.equal(normalizeNumber(Number.POSITIVE_INFINITY), "nan");
});

/* ------------------------------------------------------------------ digests -------- */

test("a row digest depends on every digest column and on their order", () => {
  const columns = ["id", "status"];
  const base = rowDigest({ id: "a", status: "draft" }, columns);
  assert.equal(rowDigest({ id: "a", status: "draft" }, columns), base);
  assert.notEqual(rowDigest({ id: "a", status: "sent" }, columns), base);
  assert.notEqual(rowDigest({ id: "b", status: "draft" }, columns), base);
  // Column order is part of the contract: both sides select in the same declared order.
  assert.notEqual(rowDigest({ id: "a", status: "draft" }, ["status", "id"]), base);
});

test("a digest cannot be forged by shifting content across adjacent columns", () => {
  // Without the tagged separator, {"ab",""} and {"a","b"} would hash identically.
  assert.notEqual(
    rowDigest({ a: "ab", b: "" }, ["a", "b"]),
    rowDigest({ a: "a", b: "b" }, ["a", "b"]),
  );
});

test("a row whose only difference is null vs empty string is detected", () => {
  assert.notEqual(rowDigest({ a: null }, ["a"]), rowDigest({ a: "" }, ["a"]));
});

test("the table checksum ignores row order but not row content", () => {
  const one = rowDigest({ id: "1" }, ["id"]);
  const two = rowDigest({ id: "2" }, ["id"]);
  assert.equal(tableChecksum([one, two]), tableChecksum([two, one]));
  assert.notEqual(tableChecksum([one, two]), tableChecksum([one, one]));
  // A dropped row changes the checksum, so equal checksums imply equal multisets.
  assert.notEqual(tableChecksum([one, two]), tableChecksum([one]));
});

test("an empty table has a stable, non-empty checksum on both sides", () => {
  assert.equal(tableChecksum([]), tableChecksum([]));
  assert.match(tableChecksum([]), /^[0-9a-f]{64}$/);
});

test("checksum input is hashes, so no plaintext token can be reconstructed from it", () => {
  const digest = rowDigest({ access_token: "super-secret-token" }, ["access_token"]);
  assert.ok(!digest.includes("super-secret-token"));
  assert.match(digest, /^[0-9a-f]{64}$/);
});

/* ------------------------------------------------------------------ source cfg ----- */

test("the source config is absent unless both Turso variables are set", () => {
  assert.equal(tursoConfig({} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(
    tursoConfig({ LUMENOSIS_TURSO_DATABASE_URL: "libsql://example.turso.io" } as unknown as NodeJS.ProcessEnv),
    null,
  );
  assert.equal(
    tursoConfig({ LUMENOSIS_TURSO_AUTH_TOKEN: "example-token" } as unknown as NodeJS.ProcessEnv),
    null,
  );
});

test("a libsql:// source URL is normalised to https and de-slashed", () => {
  const config = tursoConfig({
    LUMENOSIS_TURSO_DATABASE_URL: "libsql://example.turso.io/",
    LUMENOSIS_TURSO_AUTH_TOKEN: "example-token",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(config.url, "https://example.turso.io");
  assert.equal(config.token, "example-token");
});

/* ------------------------------------------------------------------ safety --------- */

test("importing the migrator does not connect, migrate, or exit", () => {
  // Asserted by the fact that this module imported successfully above, and structurally
  // by the direct-invocation guard.
  assert.match(script, /const invokedDirectly =/);
  assert.match(script, /if \(invokedDirectly\) \{/);
});

test("every write is idempotent by construction", () => {
  assert.match(script, /on conflict \$\{table\.conflict\} do nothing/);
  // No unconditional destructive statement anywhere in the copy path.
  assert.doesNotMatch(script, /\bdrop\s+table\b/i);
  assert.doesNotMatch(script, /\btruncate\b/i);
  // The only delete is the explicit --reset of the checkpoint ledger, never of data.
  const deletes = script.match(/delete from [a-z_]+/gi) ?? [];
  assert.deepEqual(deletes, ["delete from demo_migration_checkpoints"]);
});

test("resume is strictly forward, so no row is re-read and no gap is skipped", () => {
  assert.match(script, /where \$\{table\.key\} > \?/);
  assert.match(script, /order by \$\{table\.key\} asc/);
});

test("a dry run cannot reach the copy path", () => {
  assert.match(script, /if \(!dryRun && !verifyOnly\) \{\s*\n\s*const result = await copyTable/);
});

test("a parity mismatch is a non-zero exit even in dry-run", () => {
  assert.match(script, /if \(report\.parity !== "match"\) exitCode = 2;/);
});

test("only transient failures retry", () => {
  assert.match(script, /if \(!TRANSIENT\.test\(message\) \|\| attempt === attempts\) throw error;/);
});

test("transient retry is bounded and non-transient failure is immediate", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const result = await withRetry(
    "test",
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("ETIMEDOUT");
      return "ok";
    },
    5,
    async (delay: number) => {
      sleeps.push(delay);
    },
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [200, 400]);

  attempts = 0;
  await assert.rejects(
    withRetry("test", async () => {
      attempts += 1;
      throw new Error("constraint violation");
    }),
  );
  assert.equal(attempts, 1);
});

test("CLI rejects unsafe combinations and invalid batch values", () => {
  assert.throws(() => parseOptions(["--verify", "--reset"], {}), /INCOMPATIBLE_ARGUMENTS/);
  assert.throws(() => parseOptions(["--unknown"], {}), /INVALID_ARGUMENT/);
  assert.throws(
    () => parseOptions([], { DEMO_MIGRATION_BATCH: "1.5" }),
    /INVALID_BATCH_SIZE/,
  );
});

test("nothing sensitive is printed: no row bodies, tokens, or connection strings", () => {
  // Logs contain aggregate counts and a one-way client fingerprint, never row identity.
  assert.doesNotMatch(script, /console\.log\([^)]*\brow\b[^)]*\)/);
  assert.doesNotMatch(script, /console\.log\([^)]*access_token/);
  assert.doesNotMatch(script, /console\.error\(error\.stack/);
  assert.doesNotMatch(script, /resumed after key/);
  assert.match(script, /demo migration failed: \$\{failureCode\(error\)\}/);
});
