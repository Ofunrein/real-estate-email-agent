#!/usr/bin/env node

/**
 * Executable release gate for the Turso -> Neon demo ownership cutover.
 *
 * This command never changes an application cutover flag. --apply writes only the two
 * additive, ledgered migrations. --grant-password changes only the two fixed demo roles.
 * All other modes are read-only. No command prints URLs, passwords, tokens, or row data.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { tursoConfig, verifyParity } from "./migrate-demo-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = ["033_demo_ownership.sql", "034_demo_reader_role.sql"];
const TABLES = [
  "demo_prospects",
  "demo_listings",
  "demo_rooms",
  "demo_outreach_drafts",
  "demo_engagement_events",
];
const EXPECTED_FUNCTION_GRANTS = new Set([
  "demo_public_reader:lookup_room",
  "demo_engagement_writer:record_engagement",
  "demo_engagement_writer:reserve_email_generation",
]);

function loadDotEnv() {
  try {
    const text = readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      process.env[match[1]] = value;
    }
  } catch {
    // .env is optional in CI and operator environments.
  }
}

function usage() {
  console.log(
    [
      "Demo ownership release gate (never changes cutover flags).",
      "",
      "Usage:",
      "  node scripts/release-demo-ownership.mjs --status",
      "  node scripts/release-demo-ownership.mjs --check",
      "  node scripts/release-demo-ownership.mjs --apply",
      "  node scripts/release-demo-ownership.mjs --grant-password",
      "  append --json for machine-readable output",
      "",
      "--status: target schema/ledger summary only (read-only)",
      "--check:  strict schema, migration checksum, role, and live source/target parity gate",
      "--apply:  atomically applies only 033/034 through schema_migrations; never baselines",
      "--grant-password: enables LOGIN with operator-supplied DEMO_READER_PASSWORD and",
      "                  DEMO_WRITER_PASSWORD (minimum 24 chars; values never printed)",
    ].join("\n"),
  );
}

function parseOptions(argv = process.argv.slice(2)) {
  const allowed = new Set(["--status", "--check", "--apply", "--grant-password", "--json", "--help", "-h"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length) throw new Error("INVALID_ARGUMENT");
  const actions = ["--status", "--check", "--apply", "--grant-password"].filter((flag) => argv.includes(flag));
  const help = argv.includes("--help") || argv.includes("-h");
  if (!help && actions.length !== 1) throw new Error("EXACTLY_ONE_ACTION_REQUIRED");
  return { action: actions[0], asJson: argv.includes("--json"), help };
}

function sslConfig() {
  return process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true };
}

async function migrationMetadata(name) {
  const sql = await readFile(path.join(ROOT, "db", "migrations", name), "utf8");
  return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

async function readLedger(client) {
  const exists = await client.query("select to_regclass('public.schema_migrations') is not null as present");
  if (!exists.rows[0]?.present) return { present: false, rows: new Map() };
  const result = await client.query("select name, checksum from schema_migrations order by name");
  return { present: true, rows: new Map(result.rows.map((row) => [String(row.name), String(row.checksum)])) };
}

async function assertLedgerReady(client) {
  const ledger = await readLedger(client);
  if (!ledger.present) throw new Error("MIGRATION_LEDGER_REQUIRED");
  const names = (await readdir(path.join(ROOT, "db", "migrations")))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const name of names.filter((name) => name < MIGRATIONS[0])) {
    const metadata = await migrationMetadata(name);
    if (!ledger.rows.has(name)) throw new Error("PRIOR_MIGRATION_NOT_LEDGERED");
    if (ledger.rows.get(name) !== metadata.checksum) throw new Error("MIGRATION_CHECKSUM_MISMATCH");
  }
  for (const name of MIGRATIONS) {
    const recorded = ledger.rows.get(name);
    if (recorded && recorded !== (await migrationMetadata(name)).checksum) {
      throw new Error("MIGRATION_CHECKSUM_MISMATCH");
    }
  }
  return ledger;
}

async function applyMigrations(client) {
  const ledger = await assertLedgerReady(client);
  const applied = [];
  const skipped = [];
  for (const name of MIGRATIONS) {
    const migration = await migrationMetadata(name);
    if (ledger.rows.get(name) === migration.checksum) {
      skipped.push(name);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(migration.sql);
      await client.query(
        "insert into schema_migrations (name, checksum) values ($1, $2)",
        [migration.name, migration.checksum],
      );
      await client.query("commit");
      applied.push(name);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }
  return { applied, skipped };
}

async function checkSchema(client) {
  const columns = await client.query(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])`,
    [TABLES],
  );
  const byColumn = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  const preservation = {
    room_id_text: byColumn.get("demo_rooms.id") === "text",
    room_token_hash_text: byColumn.get("demo_rooms.token_hash") === "text",
    room_access_token_text: byColumn.get("demo_rooms.access_token") === "text",
    room_created_at_text: byColumn.get("demo_rooms.created_at") === "text",
    room_expires_at_text: byColumn.get("demo_rooms.expires_at") === "text",
    outreach_sent_at_text: byColumn.get("demo_outreach_drafts.sent_at") === "text",
  };

  const constraints = await client.query(
    `select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as definition
       from pg_constraint
      where connamespace = 'public'::regnamespace
        and conrelid = any($1::regclass[])`,
    [TABLES],
  );
  const definitions = constraints.rows.map((row) => `${row.table_name}:${row.definition}`);
  const boundary = {
    listing_tenant_fk: definitions.some((value) => /demo_listings:FOREIGN KEY \(client_id, prospect_id\)/i.test(value)),
    room_tenant_fk: definitions.some((value) => /demo_rooms:FOREIGN KEY \(client_id, prospect_id\)/i.test(value)),
    outreach_tenant_fk: definitions.some((value) => /demo_outreach_drafts:FOREIGN KEY \(client_id, demo_room_id\)/i.test(value)),
    engagement_tenant_fk: definitions.some((value) => /demo_engagement_events:FOREIGN KEY \(client_id, demo_room_id\)/i.test(value)),
    prospect_status_parity: definitions.some((value) => /demo_prospects:CHECK.*draft.*contacted/i.test(value)),
    email_generation_event_parity: definitions.some((value) => /demo_engagement_events:CHECK.*email_generation_started/i.test(value)),
  };

  const routines = await client.query(
    `select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'demo_public_api'
        and p.proname = any($1::text[])`,
    [["lookup_room", "record_engagement", "reserve_email_generation"]],
  );
  const functions = new Set(routines.rows.map((row) => String(row.proname)));
  const functionApi = {
    lookup_room: functions.has("lookup_room"),
    record_engagement: functions.has("record_engagement"),
    reserve_email_generation: functions.has("reserve_email_generation"),
  };
  return {
    tables_present: TABLES.every((table) => columns.rows.some((row) => row.table_name === table)),
    preservation,
    tenant_boundaries: boundary,
    function_api: functionApi,
    ok:
      TABLES.every((table) => columns.rows.some((row) => row.table_name === table)) &&
      Object.values(preservation).every(Boolean) &&
      Object.values(boundary).every(Boolean) &&
      Object.values(functionApi).every(Boolean),
  };
}

async function checkRoles(client) {
  const roleResult = await client.query(
    `select rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolinherit, rolbypassrls
       from pg_roles where rolname = any($1::text[]) order by rolname`,
    [["demo_public_reader", "demo_engagement_writer"]],
  );
  const roles = roleResult.rows.map((role) => ({
    name: role.rolname,
    restricted:
      !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolreplication &&
      !role.rolinherit && !role.rolbypassrls,
  }));
  const tableGrants = await client.query(
    `select grantee, table_name, privilege_type
       from information_schema.table_privileges
      where grantee = any($1::text[])`,
    [["demo_public_reader", "demo_engagement_writer"]],
  );
  const routineGrants = await client.query(
    `select grantee, routine_name
       from information_schema.routine_privileges
      where specific_schema = 'demo_public_api'
        and grantee = any($1::text[])`,
    [["demo_public_reader", "demo_engagement_writer"]],
  );
  const actual = new Set(routineGrants.rows.map((row) => `${row.grantee}:${row.routine_name}`));
  const grantsExact =
    actual.size === EXPECTED_FUNCTION_GRANTS.size &&
    [...EXPECTED_FUNCTION_GRANTS].every((grant) => actual.has(grant));
  const memberships = await client.query(
    `select 1 from pg_auth_members m
      join pg_roles member on member.oid = m.member
      where member.rolname = any($1::text[]) limit 1`,
    [["demo_public_reader", "demo_engagement_writer"]],
  );
  return {
    roles,
    direct_table_grants: tableGrants.rows.length,
    function_grants_exact: grantsExact,
    inherited_memberships: memberships.rows.length,
    ok:
      roles.length === 2 && roles.every((role) => role.restricted) &&
      tableGrants.rows.length === 0 && grantsExact && memberships.rows.length === 0,
  };
}

async function checkLedger(client) {
  const ledger = await assertLedgerReady(client);
  const current = [];
  for (const name of MIGRATIONS) {
    const expected = (await migrationMetadata(name)).checksum;
    current.push({ name, applied: ledger.rows.get(name) === expected });
  }
  return { migrations: current, ok: current.every((entry) => entry.applied) };
}

async function grantPasswords(client) {
  const reader = process.env.DEMO_READER_PASSWORD || "";
  const writer = process.env.DEMO_WRITER_PASSWORD || "";
  if (reader.length < 24 || writer.length < 24) throw new Error("ROLE_PASSWORD_TOO_SHORT");
  if (reader === writer) throw new Error("ROLE_PASSWORDS_MUST_DIFFER");
  for (const [role, password] of [
    ["demo_public_reader", reader],
    ["demo_engagement_writer", writer],
  ]) {
    // PostgreSQL utility statements do not accept bind placeholders. Ask PostgreSQL to
    // quote both values, then execute the generated fixed-shape command without logging it.
    const formatted = await client.query(
      "select format('alter role %I login password %L', $1::text, $2::text) as command",
      [role, password],
    );
    await client.query(String(formatted.rows[0].command));
  }
  return { roles_enabled: 2 };
}

async function status(client) {
  const schema = await checkSchema(client).catch(() => ({ ok: false }));
  const roles = await checkRoles(client).catch(() => ({ ok: false }));
  const ledger = await readLedger(client);
  return {
    schema_ready: schema.ok,
    roles_ready: roles.ok,
    migration_ledger_present: ledger.present,
    recorded_release_migrations: MIGRATIONS.filter((name) => ledger.rows.has(name)).length,
  };
}

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  const safe = /^(INVALID_ARGUMENT|EXACTLY_ONE_ACTION_REQUIRED|DATABASE_URL_REQUIRED|SOURCE_DATABASE_CONFIG_REQUIRED|MIGRATION_LEDGER_REQUIRED|PRIOR_MIGRATION_NOT_LEDGERED|MIGRATION_CHECKSUM_MISMATCH|ROLE_PASSWORD_TOO_SHORT|ROLE_PASSWORDS_MUST_DIFFER)$/;
  return safe.test(message) ? message : "RELEASE_GATE_FAILED";
}

async function main() {
  loadDotEnv();
  const options = parseOptions();
  if (options.help) {
    usage();
    return 0;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: sslConfig() });
  await client.connect();
  let output;
  let exitCode = 0;
  try {
    if (options.action === "--apply") {
      output = await applyMigrations(client);
    } else if (options.action === "--grant-password") {
      await checkLedger(client);
      output = await grantPasswords(client);
    } else if (options.action === "--status") {
      output = await status(client);
    } else {
      const source = tursoConfig();
      if (!source) throw new Error("SOURCE_DATABASE_CONFIG_REQUIRED");
      const clientId = (process.env.DEMO_CLIENT_ID || process.env.CLIENT_ID || "default").trim();
      if (!clientId || clientId.length > 256) throw new Error("INVALID_CLIENT_ID");
      const [schema, roles, ledger, parity] = await Promise.all([
        checkSchema(client),
        checkRoles(client),
        checkLedger(client),
        verifyParity(client, source, clientId),
      ]);
      output = {
        schema,
        roles,
        ledger,
        parity,
        gate: schema.ok && roles.ok && ledger.ok && parity.parity === "match" ? "pass" : "fail",
      };
      if (output.gate !== "pass") exitCode = 2;
    }
  } finally {
    await client.end();
  }

  if (options.asJson) console.log(JSON.stringify(output, null, 2));
  else if (options.action === "--check") console.log(`release gate: ${output.gate}`);
  else console.log(JSON.stringify(output));
  return exitCode;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`demo release failed: ${failureCode(error)}`);
      process.exitCode = 1;
    });
}

export {
  EXPECTED_FUNCTION_GRANTS,
  MIGRATIONS,
  applyMigrations,
  checkRoles,
  checkSchema,
  parseOptions,
};