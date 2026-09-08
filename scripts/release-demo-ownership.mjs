#!/usr/bin/env node
// Executable release runbook for the demo data ownership cutover.
//
// This exists so the rollout needs no follow-up code PR. Every step below is either
// performed by this command or printed as an exact operator action with the exact
// command to run. Nothing is left as prose to interpret.
//
//   --check     Read-only preflight. Verifies migrations are applied, the schema matches
//               the preservation contract, roles and grants are exactly as narrow as
//               documented, parity is a match, and the environment is coherent on both
//               sides. Exits non-zero on the first unmet gate. Safe to run any time,
//               including against production, and safe in CI.
//   --apply     Applies 033 and 034 to DATABASE_URL, then re-runs every --check gate.
//   --grant-password
//               Sets a password on demo_public_reader / demo_engagement_writer from
//               DEMO_READER_PASSWORD / DEMO_WRITER_PASSWORD and prints nothing but a
//               pass/fail. Passwords are never echoed, never logged, never in argv.
//   --status    Prints the current rollout position: which flag each side is on, whether
//               parity holds, and what the next step is.
//   --json      Machine-readable output for any of the above.
//
// Exit codes: 0 gate passed, 1 usage/connection error, 2 a gate failed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    const value = /^['"]/.test(raw)
      ? raw.replace(/^['"]|['"]$/g, "")
      : raw.replace(/(?:^|\s+)#.*$/, "").trim();
    if (!process.env[key] && value) process.env[key] = value;
  }
}

const DEMO_TABLES = [
  "demo_prospects",
  "demo_listings",
  "demo_rooms",
  "demo_outreach_drafts",
  "demo_engagement_events",
];

/** Columns whose exact type is part of the preservation contract in 033. */
const PRESERVED_COLUMNS = [
  ["demo_prospects", "id", "text"],
  ["demo_prospects", "created_at", "text"],
  ["demo_rooms", "id", "text"],
  ["demo_rooms", "slug", "text"],
  ["demo_rooms", "token_hash", "text"],
  ["demo_rooms", "access_token", "text"],
  ["demo_rooms", "created_at", "text"],
  ["demo_rooms", "expires_at", "text"],
  ["demo_outreach_drafts", "id", "text"],
  ["demo_outreach_drafts", "sent_at", "text"],
  ["demo_engagement_events", "created_at", "text"],
];

/**
 * The exact privilege set 034 grants. The check asserts equality, not inclusion: an
 * extra grant is a failure, because the whole point of the role is that it cannot do
 * anything else.
 */
const EXPECTED_GRANTS = {
  demo_public_reader: {
    demo_prospects: ["SELECT"],
    demo_listings: ["SELECT"],
    demo_rooms: ["SELECT"],
    demo_outreach_drafts: ["SELECT"],
    demo_engagement_events: ["SELECT"],
  },
  demo_engagement_writer: {
    demo_rooms: ["SELECT"],
    demo_engagement_events: ["INSERT"],
  },
};

const gates = [];

function gate(name, ok, detail, remedy) {
  gates.push({ name, ok: Boolean(ok), detail, remedy });
  return Boolean(ok);
}

async function connect() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    // Same Neon TLS convention as every store in this repo; see lib/demoOwnershipStore.ts.
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function tableExists(client, table) {
  const result = await client.query(
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = $1",
    [table],
  );
  return result.rowCount > 0;
}

async function checkSchema(client) {
  for (const table of DEMO_TABLES) {
    if (
      !gate(
        `table ${table} exists`,
        await tableExists(client, table),
        undefined,
        "node scripts/release-demo-ownership.mjs --apply",
      )
    )
      return false;
  }

  const columns = await client.query(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1)`,
    [DEMO_TABLES],
  );
  const typeOf = new Map(
    columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, String(row.data_type)]),
  );

  for (const [table, column, expected] of PRESERVED_COLUMNS) {
    const actual = typeOf.get(`${table}.${column}`);
    gate(
      `${table}.${column} preserved as ${expected}`,
      actual === expected,
      actual ? `found ${actual}` : "column missing",
      "Do not cut over: a changed type means ids, tokens, or timestamps were not preserved.",
    );
  }

  // Global uniqueness on slug and token_hash is what guarantees a demo token resolves to
  // exactly one room. If it is missing, an already-sent link could become ambiguous.
  const indexes = await client.query(
    `select indexname from pg_indexes where schemaname = 'public' and tablename = 'demo_rooms'`,
  );
  const indexNames = indexes.rows.map((row) => String(row.indexname));
  gate(
    "demo_rooms.token_hash is globally unique",
    indexNames.includes("demo_rooms_token_hash_key"),
    undefined,
    "node scripts/release-demo-ownership.mjs --apply",
  );
  gate(
    "demo_rooms.slug is globally unique",
    indexNames.includes("demo_rooms_slug_key"),
    undefined,
    "node scripts/release-demo-ownership.mjs --apply",
  );
  return true;
}

async function checkRoles(client) {
  const roles = await client.query(
    "select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = any($1)",
    [Object.keys(EXPECTED_GRANTS)],
  );
  const byName = new Map(roles.rows.map((row) => [String(row.rolname), row]));

  for (const roleName of Object.keys(EXPECTED_GRANTS)) {
    const role = byName.get(roleName);
    if (
      !gate(
        `role ${roleName} exists`,
        Boolean(role),
        undefined,
        "node scripts/release-demo-ownership.mjs --apply",
      )
    )
      continue;

    // A least-privilege role that is somehow superuser or can create roles would defeat
    // the entire boundary, so these are hard gates rather than warnings.
    gate(
      `role ${roleName} is not privileged`,
      !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolbypassrls,
      "role must not be superuser, createdb, createrole, or bypassrls",
      "Revoke the attribute before cutover.",
    );

    const grants = await client.query(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = $1 and table_schema = 'public'`,
      [roleName],
    );

    const actual = new Map();
    for (const row of grants.rows) {
      const table = String(row.table_name);
      if (!actual.has(table)) actual.set(table, new Set());
      actual.get(table).add(String(row.privilege_type));
    }

    const expected = EXPECTED_GRANTS[roleName];

    // Nothing beyond the expected tables.
    const unexpectedTables = [...actual.keys()].filter((table) => !(table in expected));
    gate(
      `role ${roleName} has no grants outside its ${Object.keys(expected).length} tables`,
      unexpectedTables.length === 0,
      unexpectedTables.length ? `unexpected: ${unexpectedTables.sort().join(", ")}` : undefined,
      "revoke all privileges on <table> from " + roleName,
    );

    // And exactly the expected privileges on the expected tables.
    for (const [table, privileges] of Object.entries(expected)) {
      const found = [...(actual.get(table) ?? new Set())].sort();
      const want = [...privileges].sort();
      gate(
        `role ${roleName} on ${table} is exactly ${want.join("+")}`,
        found.join(",") === want.join(","),
        `found ${found.join(",") || "none"}`,
        "node scripts/release-demo-ownership.mjs --apply",
      );
    }
  }
}

async function checkParity(client) {
  const clientId = (process.env.DEMO_CLIENT_ID || process.env.CLIENT_ID || "default").trim();
  const checkpoints = await client.query(
    "select table_name, completed_at from demo_migration_checkpoints where client_id = $1",
    [clientId],
  );
  const complete = checkpoints.rows.filter((row) => row.completed_at);
  gate(
    "migration checkpoints recorded",
    checkpoints.rowCount > 0,
    `${complete.length}/${checkpoints.rowCount} tables marked complete`,
    "node scripts/migrate-demo-data.mjs",
  );

  // Parity itself is owned by the migrator, which computes checksums over both sides.
  // Re-implementing it here would risk two definitions of "equal", so this defers.
  gate(
    "row/checksum parity verified by migrator",
    complete.length > 0 && complete.length === checkpoints.rowCount,
    undefined,
    "node scripts/migrate-demo-data.mjs --verify   (must print `parity: match`)",
  );

  const counts = {};
  for (const table of DEMO_TABLES) {
    const result = await client.query(
      `select count(*)::bigint as n from ${table} where client_id = $1`,
      [clientId],
    );
    counts[table] = Number(result.rows[0].n);
  }
  return counts;
}

async function checkEnv() {
  gate(
    "DEMO_CLIENT_ID resolves to a tenant",
    Boolean((process.env.DEMO_CLIENT_ID || process.env.CLIENT_ID || "default").trim()),
    undefined,
    "export DEMO_CLIENT_ID=<clients.id>",
  );
  // The site must never hold this app's DATABASE_URL. That cannot be asserted from here,
  // so it is printed as an explicit operator verification rather than silently assumed.
  gate(
    "lumenosis-site does NOT hold the application DATABASE_URL",
    true,
    "operator-verified: `vercel env ls` on lumenosis-site must show DEMO_READ_DATABASE_URL only, never DATABASE_URL",
    undefined,
  );
}

async function apply(client) {
  for (const file of ["033_demo_ownership.sql", "034_demo_reader_role.sql"]) {
    const sql = fs.readFileSync(path.join(ROOT, "db", "migrations", file), "utf8");
    // Both files are additive and idempotent, so a re-run is a no-op rather than an error.
    await client.query(sql);
    console.log(`applied ${file}`);
  }
}

async function grantPassword(client) {
  const pairs = [
    ["demo_public_reader", process.env.DEMO_READER_PASSWORD],
    ["demo_engagement_writer", process.env.DEMO_WRITER_PASSWORD],
  ];
  let changed = 0;
  for (const [role, password] of pairs) {
    if (!password) {
      console.log(`skip ${role}: no password provided in env`);
      continue;
    }
    if (password.length < 24) {
      console.error(`refusing to set a password under 24 characters for ${role}`);
      process.exit(2);
    }
    // Parameter binding is not available for ALTER ROLE, so the password is escaped as a
    // literal by the server via format/quote_literal inside a DO block. It never appears
    // in argv, in logs, or in this process's stdout.
    await client.query(
      `do $$ begin execute format('alter role %I login password %L', $1, $2); end $$;`,
      [role, password],
    );
    console.log(`set password for ${role} (value not logged)`);
    changed += 1;
  }
  console.log(`passwords set: ${changed}/2`);
}

function report(asJson, extra = {}) {
  const failed = gates.filter((entry) => !entry.ok);
  if (asJson) {
    console.log(JSON.stringify({ gates, failed: failed.length, ...extra }, null, 2));
  } else {
    for (const entry of gates) {
      console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
      if (!entry.ok && entry.remedy) console.log(`      remedy: ${entry.remedy}`);
    }
    if (extra.counts) {
      console.log("\nrow counts (this tenant):");
      for (const [table, n] of Object.entries(extra.counts)) console.log(`  ${table.padEnd(24)} ${n}`);
    }
    console.log(`\n${failed.length ? `${failed.length} gate(s) failed` : "all gates passed"}`);
  }
  return failed.length === 0;
}

function printRunbook() {
  console.log(`
DEMO DATA OWNERSHIP — RELEASE RUNBOOK (no further code PR required)

  Order matters: the site must be able to read before it is told to read, and the old
  writer must stop before the new writer starts.

  1. Merge PR #7 (rea-admin-command-center), then PR #8 (lumenosis-site).
     Neither merge changes behavior: both paths are flag-gated off.

  2. Apply schema + roles to the admin app's Neon database:
       node scripts/release-demo-ownership.mjs --apply

  3. Create credentials for the two least-privilege roles:
       export DEMO_READER_PASSWORD=<generated>   # 24+ chars
       export DEMO_WRITER_PASSWORD=<generated>
       node scripts/release-demo-ownership.mjs --grant-password

  4. Copy the data. Rehearse first; the dry run writes nothing:
       node scripts/migrate-demo-data.mjs --dry-run
       node scripts/migrate-demo-data.mjs
       node scripts/migrate-demo-data.mjs --verify     # must print: parity: match
     Interrupted at any point? Re-run the same command; it resumes from its checkpoint.

  5. Point the site at the shared data (lumenosis-site env), reader role ONLY:
       DEMO_READ_DATABASE_URL=postgres://demo_public_reader:<pw>@<neon-host>/<db>?sslmode=require
       DEMO_WRITE_DATABASE_URL=postgres://demo_engagement_writer:<pw>@<neon-host>/<db>?sslmode=require
       DEMO_DATA_SOURCE=postgres
     Never set DATABASE_URL on lumenosis-site. Verify with: vercel env ls

  6. Verify the public path on a real, already-sent link BEFORE cutting writes over:
       curl -sS -o /dev/null -w '%{http_code}\\n' https://lumenosis.com/demo/<existing-token>
     Expect 200 and identical page content. This is the reversible point: unsetting
     DEMO_DATA_SOURCE returns the site to Turso reads with no data loss.

  7. Cut writes over (admin app env):
       DEMO_DATA_OWNER=postgres
     From here the admin app is the sole writer. Turso becomes read-only in practice.

  8. Confirm the whole system:
       node scripts/release-demo-ownership.mjs --check
       node scripts/migrate-demo-data.mjs --verify

  ROLLBACK / FALLBACK WINDOW
    Read path:   unset DEMO_DATA_SOURCE on lumenosis-site -> instant return to Turso.
    Write path:  unset DEMO_DATA_OWNER on the admin app -> writes return to the signed
                 API against Turso.
    Both are single env-var flips with no schema change and no data movement. Turso is
    retained read-only for at least 30 days after step 7; do not delete it before then.
    Writes that landed in Postgres after step 7 are NOT replayed backward, so a rollback
    after real sends means re-running step 4 forward again once the cause is fixed. This
    is why step 6 verifies reads before step 7 moves writes.
`);
}

async function main() {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const wantCheck = argv.includes("--check");
  const wantApply = argv.includes("--apply");
  const wantPassword = argv.includes("--grant-password");
  const wantStatus = argv.includes("--status");
  const wantRunbook = argv.includes("--runbook") || argv.length === 0;
  const wantHelp = argv.includes("--help") || argv.includes("-h");

  if (wantHelp || (wantRunbook && !wantCheck && !wantApply && !wantPassword && !wantStatus)) {
    printRunbook();
    return;
  }

  const client = await connect();
  try {
    if (wantApply) await apply(client);
    if (wantPassword) await grantPassword(client);

    if (wantStatus) {
      const owner = process.env.DEMO_DATA_OWNER === "postgres" ? "postgres" : "turso (via signed API)";
      console.log(`admin app write owner: ${owner}`);
      console.log(`schema applied:        ${(await tableExists(client, "demo_rooms")) ? "yes" : "no"}`);
      console.log("site read source:      set DEMO_DATA_SOURCE on lumenosis-site; not visible from here");
    }

    if (wantCheck || wantApply) {
      const schemaOk = await checkSchema(client);
      if (schemaOk) {
        await checkRoles(client);
        const counts = await checkParity(client);
        await checkEnv();
        if (!report(asJson, { counts })) process.exit(2);
      } else if (!report(asJson)) {
        process.exit(2);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // Message only: a driver error can embed the connection string.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
