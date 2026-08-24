#!/usr/bin/env node
// Apply db/migrations/*.sql against DATABASE_URL, once each, in filename order.
//
// Replaces the `for f in db/migrations/*.sql; do psql -f "$f"; done` loop that
// setup-neon.sh and the docs used. Three things that loop got wrong:
//
//   1. No ledger. Every provision re-ran all 28 files. They happen to be
//      individually re-runnable today, but that is a property nobody enforces
//      and one non-idempotent statement breaks every future provision.
//   2. No ON_ERROR_STOP. `psql -f` continues past a failed statement and still
//      exits 0, so a half-applied schema reported as a clean provision.
//   3. No clients row. ~45 tables carry
//      `client_id ... references clients(id)`, and no migration seeds it, so a
//      freshly migrated database rejects every write until something inserts
//      it. sync:sheets happened to do that — only if Sheets was configured.
//
// Usage:
//   node scripts/migrate.mjs                  apply pending migrations
//   node scripts/migrate.mjs --dry-run        list what would run, touch nothing
//   node scripts/migrate.mjs --status         show applied/pending and exit
//   node scripts/migrate.mjs --baseline       record all files as applied, run none
//
// --baseline is for the pre-existing production database, which has all
// migrations applied but no ledger (the ledger did not exist when they ran).
// Without it the first run re-applies all of them.
//
// The DDL is all `if not exists` and safe to re-run, but migration 011 is NOT
// safe: it flips draft_first=false and every auto_send_* to true on any row
// where all seven flags are currently off — and "all off" is exactly the state
// an operator creates when they deliberately pause the agent. Re-applying it
// would silently turn a paused client's auto-send back on, including email,
// which DEFAULT_INBOX_SETTINGS keeps off on purpose.
//
// So: on the existing production database, run --baseline, never a plain
// apply. Check with --status first.
//
// Env: DATABASE_URL (required), CLIENT_ID, CLIENT_NAME.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    const value = /^['"]/.test(raw) ? raw.replace(/^['"]|['"]$/g, "") : raw.replace(/(?:^|\s+)#.*$/, "").trim();
    if (!process.env[key] && value) process.env[key] = value;
  }
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"),
    }))
    .map((file) => ({ ...file, checksum: createHash("sha256").update(file.sql).digest("hex") }));
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedMigrations(client) {
  const result = await client.query("select name, checksum from schema_migrations");
  return new Map(result.rows.map((row) => [String(row.name), String(row.checksum)]));
}

/**
 * Every tenant table FKs to clients(id) and no migration seeds it, so without
 * this the schema exists but rejects all writes.
 */
async function seedClientRow(client, clientId, clientName) {
  await client.query(
    `insert into clients (id, name) values ($1, $2) on conflict (id) do nothing`,
    [clientId, clientName],
  );
}

async function main() {
  loadDotEnv();
  const dryRun = process.argv.includes("--dry-run");
  const statusOnly = process.argv.includes("--status");
  const baseline = process.argv.includes("--baseline");
  const clientId = (process.env.CLIENT_ID || "default").trim();
  const clientName = (process.env.CLIENT_NAME || clientId).trim();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const files = migrationFiles();
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await ensureLedger(client);
    const applied = await appliedMigrations(client);

    const pending = files.filter((file) => !applied.has(file.name));
    const changed = files.filter((file) => applied.has(file.name) && applied.get(file.name) !== file.checksum);

    if (changed.length) {
      // An already-applied file whose contents changed means the schema in this
      // database no longer matches the repo. Editing a shipped migration is the
      // mistake; the fix is a new numbered file, not a silent re-apply.
      console.error("Applied migrations were modified after the fact:");
      for (const file of changed) console.error(`  ${file.name}`);
      console.error("Add a new migration instead of editing a shipped one.");
      process.exit(1);
    }

    if (statusOnly || dryRun) {
      console.log(JSON.stringify({
        dry_run: dryRun,
        client_id: clientId,
        total: files.length,
        applied: files.length - pending.length,
        pending: pending.map((file) => file.name),
      }, null, 2));
      return;
    }

    if (baseline) {
      // Record without executing. Only correct when the schema already matches
      // the repo — --status first.
      for (const file of pending) {
        await client.query(
          "insert into schema_migrations (name, checksum) values ($1, $2) on conflict (name) do nothing",
          [file.name, file.checksum],
        );
      }
      await seedClientRow(client, clientId, clientName);
      console.log(JSON.stringify({ ok: true, baselined: pending.map((file) => file.name) }, null, 2));
      return;
    }

    // Guard the one migration that is not safe to re-run. Its WHERE clause
    // matches a live "operator paused every channel" row, so re-applying it
    // would turn a paused client's auto-send back on.
    const replays011 = pending.some((file) => file.name.startsWith("011_"));
    if (replays011 && applied.size === 0) {
      const populated = await client.query(
        "select to_regclass('public.inbox_settings') is not null as exists",
      );
      if (populated.rows[0]?.exists) {
        const rows = await client.query("select count(*)::int as count from inbox_settings");
        if (Number(rows.rows[0]?.count || 0) > 0) {
          console.error(
            "Refusing to apply: this database already has inbox_settings rows but no migration ledger.\n"
            + "Re-running 011 would flip auto_send_* back on for any client whose channels are all off.\n"
            + "Run `npm run migrate -- --baseline` instead (verify with --status first).",
          );
          process.exit(1);
        }
      }
    }

    for (const file of pending) {
      // One transaction per migration: a failure rolls that file back whole and
      // leaves the ledger untouched, so a retry restarts it cleanly.
      await client.query("begin");
      try {
        await client.query(file.sql);
        await client.query(
          "insert into schema_migrations (name, checksum) values ($1, $2)",
          [file.name, file.checksum],
        );
        await client.query("commit");
        console.log(`applied ${file.name}`);
      } catch (error) {
        await client.query("rollback");
        console.error(`FAILED ${file.name}: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    }

    await seedClientRow(client, clientId, clientName);
    console.log(JSON.stringify({
      ok: true,
      client_id: clientId,
      applied_now: pending.length,
      total: files.length,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
