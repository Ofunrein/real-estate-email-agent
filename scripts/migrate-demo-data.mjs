#!/usr/bin/env node
// Turso (SQLite) -> Neon (Postgres) migration for demo/prospect/listing/outreach/
// engagement data. Moves ownership of that corpus into this app's database, where this
// app is the sole writer and lumenosis-site reads through a least-privilege read-only
// role.
//
// Properties, each exercised by tests/ts/demoDataMigration.test.ts:
//
//   Idempotent   Every write is `insert ... on conflict (pk) do nothing`. Re-running a
//                completed migration copies zero rows and reports identical parity.
//                Engagement events, whose SQLite rowids are not stable identifiers, are
//                deduped on (client_id, source_rowid) instead.
//   Resumable    Progress is checkpointed in demo_migration_checkpoints in the TARGET
//                database, after each committed batch. A killed run resumes strictly
//                after the last committed source key; it never restarts from zero and
//                never skips a gap.
//   Verifiable   --dry-run reads only. Every run ends in a deterministic parity report:
//                per-table source and target counts plus a sha256 checksum over a
//                canonical per-row digest stream, computed identically on both sides.
//                Equal checksums mean equal content, not merely equal counts.
//   Retried      Transient Turso/Neon failures retry with bounded exponential backoff.
//                A non-transient failure stops the run with the checkpoint intact.
//   Quiet        No secrets, tokens, access tokens, prospect mailboxes, recipients, or
//                draft bodies are ever printed. Row identity in logs is the primary key
//                only; checksums are over hashes, not plaintext.
//
// Preservation: ids, slugs, token hashes, access tokens, timestamps, statuses, and
// referential relationships are copied byte-for-byte. No token is re-derived or
// re-signed, so every https://lumenosis.com/demo/<token> URL already sent keeps working.
//
// Usage:
//   node scripts/migrate-demo-data.mjs --dry-run     read both sides, report parity, write nothing
//   node scripts/migrate-demo-data.mjs               migrate (resumable), then report parity
//   node scripts/migrate-demo-data.mjs --verify      report parity only, no copying
//   node scripts/migrate-demo-data.mjs --reset       clear checkpoints and re-walk from zero
//   node scripts/migrate-demo-data.mjs --json        machine-readable report on stdout
//
// Checkpoints track the highest source key already copied per table, so an interrupted
// run resumes instead of restarting. Verified: killing a run mid-table and re-running
// copies only the remainder.
//
// Caveat, verified locally: a checkpoint says "I copied up to key K", not "the target is
// intact up to K". If rows are removed from the target BELOW the checkpoint (for example
// deleting parent rooms, which cascades to drafts and events), a plain re-run will not
// notice, because it only walks forward from K. Parity reporting still catches it, and
// the fix is `--reset`, which clears checkpoints and re-walks every table from zero;
// inserts remain ON CONFLICT DO NOTHING, so a reset is safe and non-duplicating. Trust
// `parity: match`, not the absence of errors.
//
// Env: DATABASE_URL (target, required), LUMENOSIS_TURSO_DATABASE_URL and
// LUMENOSIS_TURSO_AUTH_TOKEN (source, required unless --verify-target-only),
// DEMO_CLIENT_ID (default 'default'), DEMO_MIGRATION_BATCH (default 200).

import { createHash } from "node:crypto";
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

/* ------------------------------------------------------------------ table plan ----- */

/**
 * Ordered parent-before-child so a child insert can never violate a foreign key. Each
 * entry declares:
 *   source/target   table names on each side
 *   key             deterministic ordering + resume key column on the source
 *   columns         source column -> target column, in insert order
 *   digest          columns included in the parity digest, in a fixed order
 *   conflict        target conflict target for the idempotent insert
 */
const TABLES = [
  {
    name: "prospects",
    source: "prospects",
    target: "demo_prospects",
    key: "id",
    columns: [
      "id",
      "full_name",
      "first_name",
      "email",
      "business_name",
      "role",
      "sender_inbox",
      "status",
      "created_at",
    ],
    digest: [
      "id",
      "full_name",
      "first_name",
      "email",
      "business_name",
      "role",
      "sender_inbox",
      "status",
      "created_at",
    ],
    conflict: "(id)",
  },
  {
    name: "listings",
    source: "listings",
    target: "demo_listings",
    key: "id",
    columns: [
      "id",
      "prospect_id",
      "address",
      "source_url",
      "status",
      "price",
      "beds",
      "baths",
      "square_feet",
      "acreage",
      "mls",
      "details_json",
      "sources_json",
      "verified_at",
    ],
    digest: [
      "id",
      "prospect_id",
      "address",
      "source_url",
      "status",
      "price",
      "beds",
      "baths",
      "square_feet",
      "acreage",
      "mls",
      "details_json",
      "sources_json",
      "verified_at",
    ],
    conflict: "(id)",
    numericColumns: ["price", "beds", "baths", "square_feet", "acreage"],
  },
  {
    name: "demo_rooms",
    source: "demo_rooms",
    target: "demo_rooms",
    key: "id",
    columns: [
      "id",
      "prospect_id",
      "listing_id",
      "slug",
      "token_hash",
      "access_token",
      "config_json",
      "status",
      "expires_at",
      "approved_at",
      "created_at",
    ],
    // access_token and token_hash ARE part of the digest: a token that changed in
    // transit would break an already-sent link, so parity must prove it did not. The
    // digest is a hash, so the token itself is never printed.
    digest: [
      "id",
      "prospect_id",
      "listing_id",
      "slug",
      "token_hash",
      "access_token",
      "config_json",
      "status",
      "expires_at",
      "approved_at",
      "created_at",
    ],
    conflict: "(id)",
  },
  {
    name: "outreach_drafts",
    source: "outreach_drafts",
    target: "demo_outreach_drafts",
    key: "id",
    columns: [
      "id",
      "demo_room_id",
      "sender_name",
      "sender_inbox",
      "recipient",
      "subject",
      "body",
      "status",
      "sent_at",
      "provider_message_id",
    ],
    digest: [
      "id",
      "demo_room_id",
      "sender_name",
      "sender_inbox",
      "recipient",
      "subject",
      "body",
      "status",
      "sent_at",
      "provider_message_id",
    ],
    conflict: "(id)",
  },
  {
    name: "engagement_events",
    source: "engagement_events",
    target: "demo_engagement_events",
    key: "id",
    // The SQLite rowid lands in source_rowid, not id: see 033_demo_ownership.sql.
    columns: ["id", "demo_room_id", "event", "duration_seconds", "created_at"],
    targetColumns: ["source_rowid", "demo_room_id", "event", "duration_seconds", "created_at"],
    digest: ["id", "demo_room_id", "event", "duration_seconds", "created_at"],
    conflict: "(client_id, source_rowid)",
    numericKey: true,
    numericColumns: ["id", "duration_seconds"],
  },
];

/* ------------------------------------------------------------------ utilities ----- */

const TRANSIENT = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPIPE|socket hang up|timeout|too many connections|503|502|504|429/i;

async function withRetry(
  label,
  fn,
  attempts = 5,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // Only transient classes retry. A constraint violation or a bad column is a real
      // defect and must surface immediately rather than after five identical failures.
      if (!TRANSIENT.test(message) || attempt === attempts) throw error;
      const delay = Math.min(200 * 2 ** (attempt - 1), 5_000);
      // Label only. The message may embed a connection string, so it is never printed.
      process.stderr.write(`retry ${label} attempt ${attempt}/${attempts} in ${delay}ms\n`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Canonical scalar form, identical on both sides. SQLite and Postgres disagree on how
 * they hand back numbers and nulls, so everything is normalized to a tagged string
 * before hashing; otherwise a float returned as 3 vs "3.0" would look like drift.
 */
function canonical(value, numeric = false) {
  if (value === null || value === undefined) return "\u0000null";
  if (typeof value === "boolean") return `\u0000bool:${value ? 1 : 0}`;
  if (numeric) return `\u0000num:${normalizeNumber(value)}`;
  // Text remains text even when it looks numeric. IDs, tokens and timestamp strings are
  // preservation fields: "001" must never compare equal to "1".
  return `\u0000str:${String(value)}`;
}

function normalizeNumber(value) {
  const text = String(value);
  if (/^[+-]?\d+$/.test(text)) return BigInt(text).toString();
  const number = Number(value);
  if (!Number.isFinite(number)) return "nan";
  if (Number.isInteger(number)) return number.toFixed(0);
  // Fixed precision so 0.1+0.2 style representation differences cannot diverge.
  return number.toPrecision(15).replace(/0+$/, "").replace(/\.$/, "");
}

function rowDigest(row, columns, numericColumns = []) {
  const hash = createHash("sha256");
  const numeric = new Set(numericColumns);
  for (const column of columns) {
    const encoded = canonical(row[column], numeric.has(column));
    // Length-prefix every field so adjacent values cannot be shifted into a collision.
    hash.update(`${Buffer.byteLength(encoded, "utf8")}:`);
    hash.update(encoded);
  }
  return hash.digest("hex");
}

/**
 * Order-independent, content-sensitive table checksum: sort the per-row digests, then
 * hash the sorted stream. Order independence matters because the two engines do not
 * guarantee the same tie-breaking, and sorting hex digests is deterministic.
 */
function tableChecksum(digests) {
  const hash = createHash("sha256");
  for (const digest of [...digests].sort()) hash.update(digest);
  return hash.digest("hex");
}

/* ------------------------------------------------------------------ source (Turso) - */

function tursoConfig(env = process.env) {
  const rawUrl = env.LUMENOSIS_TURSO_DATABASE_URL;
  const token = env.LUMENOSIS_TURSO_AUTH_TOKEN;
  if (!rawUrl || !token) return null;
  return { url: rawUrl.replace(/^libsql:/, "https:").replace(/\/$/, ""), token };
}

function tursoArg(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  return { type: "text", value: String(value) };
}

/** Same HTTP pipeline shape lumenosis-site lib/turso.ts uses. */
async function tursoSql(config, query, args = []) {
  return withRetry("turso", async () => {
    const response = await fetch(`${config.url}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          { type: "execute", stmt: { sql: query, args: args.map(tursoArg) } },
          { type: "close" },
        ],
      }),
      cache: "no-store",
    });
    // Status only — the body can echo SQL that embeds row data.
    if (!response.ok) throw new Error(`Turso request failed: ${response.status}`);
    const payload = await response.json();
    const result = payload.results?.[0]?.response?.result;
    if (!result) {
      const error = payload.results?.[0]?.error?.message;
      if (error) throw new Error(`Turso error: ${error}`);
      return [];
    }
    const columns = (result.cols ?? []).map((column) => column.name);
    return (result.rows ?? []).map((row) =>
      Object.fromEntries(
        columns.map((column, index) => [
          column,
          row[index]?.type === "null" ? null : (row[index]?.value ?? null),
        ]),
      ),
    );
  });
}

async function sourceTableExists(config, table) {
  const rows = await tursoSql(
    config,
    "select name from sqlite_master where type = 'table' and name = ? limit 1",
    [table],
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------------ checkpoints ---- */

async function assertTargetSchema(client) {
  const required = [...TABLES.map((table) => table.target), "demo_migration_checkpoints"];
  const result = await withRetry("neon schema check", () =>
    client.query(
      `select name, to_regclass('public.' || name) is not null as present
         from unnest($1::text[]) as names(name)`,
      [required],
    ),
  );
  const missing = result.rows.filter((row) => !row.present).map((row) => String(row.name));
  if (missing.length) throw new Error("TARGET_SCHEMA_MISSING");
}

async function readCheckpoints(client, clientId) {
  const result = await withRetry("neon checkpoints", () =>
    client.query(
      "select table_name, last_source_key, rows_scanned, completed_at from demo_migration_checkpoints where client_id = $1",
      [clientId],
    ),
  );
  return new Map(result.rows.map((row) => [String(row.table_name), row]));
}

/* ------------------------------------------------------------------ copy ----------- */

async function copyTable({
  table,
  source,
  client,
  clientId,
  checkpoint,
  batchSize,
  sourceQuery = tursoSql,
}) {
  const targetColumns = table.targetColumns ?? table.columns;
  let lastKey = checkpoint ? String(checkpoint.last_source_key ?? "") : "";
  let copied = 0;
  let scanned = 0;

  for (;;) {
    // Strict `>` on the ordering key is what makes resume exact: the last committed row
    // is never re-read and no row between it and the next batch can be skipped.
    const where = lastKey === "" ? "" : `where ${table.key} > ?`;
    const args = lastKey === "" ? [] : [table.numericKey ? Number(lastKey) : lastKey];
    const rows = await sourceQuery(
      source,
      `select ${table.columns.join(", ")} from ${table.source} ${where} order by ${table.key} asc limit ${batchSize}`,
      args,
    );
    if (!rows.length) break;

    // One transaction per batch. A failure rolls the batch back whole and leaves the
    // checkpoint pointing at the last row that actually committed.
    const batchResult = await withRetry(`neon ${table.name} batch`, async () => {
      await client.query("begin");
      try {
        let inserted = 0;
        for (const row of rows) {
          const values = [clientId, ...table.columns.map((column) => row[column])];
          const placeholders = targetColumns.map((_column, index) => `$${index + 2}`);
          const result = await client.query(
            `insert into ${table.target} (client_id, ${targetColumns.join(", ")})
               values ($1, ${placeholders.join(", ")})
               on conflict ${table.conflict} do nothing`,
            values,
          );
          inserted += Number(result.rowCount ?? 0);
        }
        const batchLastKey = String(rows[rows.length - 1][table.key]);
        await client.query(
          `insert into demo_migration_checkpoints (client_id, table_name, last_source_key, rows_scanned, updated_at)
             values ($1, $2, $3, $4, now())
             on conflict (client_id, table_name) do update
               set last_source_key = excluded.last_source_key,
                   rows_scanned = demo_migration_checkpoints.rows_scanned + excluded.rows_scanned,
                   completed_at = null,
                   updated_at = now()`,
          [clientId, table.name, batchLastKey, rows.length],
        );
        await client.query("commit");
        return { inserted, batchLastKey };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    });
    lastKey = batchResult.batchLastKey;
    copied += batchResult.inserted;
    scanned += rows.length;

    if (rows.length < batchSize) break;
  }

  await withRetry("neon checkpoint completion", () =>
    client.query(
      `insert into demo_migration_checkpoints
         (client_id, table_name, last_source_key, rows_scanned, completed_at, updated_at)
       values ($1, $2, $3, 0, now(), now())
       on conflict (client_id, table_name) do update
         set completed_at = now(), updated_at = now()`,
      [clientId, table.name, lastKey],
    ),
  );

  return { copied, scanned, lastKey };
}

/* ------------------------------------------------------------------ parity -------- */

async function sourceParity(source, table) {
  const digests = [];
  let lastKey = "";
  for (;;) {
    const where = lastKey === "" ? "" : `where ${table.key} > ?`;
    const args = lastKey === "" ? [] : [table.numericKey ? Number(lastKey) : lastKey];
    const rows = await tursoSql(
      source,
      `select ${table.digest.join(", ")} from ${table.source} ${where} order by ${table.key} asc limit 500`,
      args,
    );
    if (!rows.length) break;
    for (const row of rows) {
      digests.push(rowDigest(row, table.digest, table.numericColumns));
    }
    lastKey = String(rows[rows.length - 1][table.key]);
    if (rows.length < 500) break;
  }
  return { count: digests.length, checksum: tableChecksum(digests) };
}

async function targetParity(client, table, clientId) {
  // Select the SOURCE digest column names, aliasing target names back to them, so the
  // digest input is positionally and nominally identical to the source side.
  const targetColumns = table.targetColumns ?? table.columns;
  const select = table.digest
    .map((column) => {
      const index = table.columns.indexOf(column);
      const targetColumn = index === -1 ? column : targetColumns[index];
      return targetColumn === column ? column : `${targetColumn} as ${column}`;
    })
    .join(", ");
  const result = await withRetry(`neon ${table.name} parity`, () =>
    client.query(
      `select ${select} from ${table.target} where client_id = $1`,
      [clientId],
    ),
  );
  const digests = result.rows.map((row) =>
    rowDigest(row, table.digest, table.numericColumns),
  );
  return { count: digests.length, checksum: tableChecksum(digests) };
}

async function verifyParity(client, source, clientId) {
  const tables = [];
  for (const table of TABLES) {
    const sourcePresent = await sourceTableExists(source, table.source);
    const sourceResult = sourcePresent
      ? await sourceParity(source, table)
      : { count: 0, checksum: tableChecksum([]) };
    const targetResult = await targetParity(client, table, clientId);
    tables.push({
      table: table.name,
      source_present: sourcePresent,
      source: sourceResult,
      target: targetResult,
      match:
        sourceResult.count === targetResult.count &&
        sourceResult.checksum === targetResult.checksum,
    });
  }
  return { tables, parity: tables.every((entry) => entry.match) ? "match" : "mismatch" };
}

/* ------------------------------------------------------------------ main ---------- */

function printUsage() {
  console.log(
    [
      "Migrate demo/prospect/listing/outreach/engagement data from Turso into Neon.",
      "",
      "Usage:",
      "  node scripts/migrate-demo-data.mjs --dry-run   read both sides, report parity, write nothing",
      "  node scripts/migrate-demo-data.mjs             migrate (resumable), then report parity",
      "  node scripts/migrate-demo-data.mjs --verify    report parity only, no copying",
      "  node scripts/migrate-demo-data.mjs --reset     clear checkpoints and re-walk from zero",
      "  node scripts/migrate-demo-data.mjs --json      machine-readable report on stdout",
      "  node scripts/migrate-demo-data.mjs --help      this message",
      "",
      "Env: DATABASE_URL (target, required), LUMENOSIS_TURSO_DATABASE_URL and",
      "     LUMENOSIS_TURSO_AUTH_TOKEN (source), DEMO_CLIENT_ID (default 'default'),",
      "     DEMO_MIGRATION_BATCH (default 200).",
      "",
      "Idempotent and resumable. Checkpoints record the highest source key copied per",
      "table; a re-run copies only the remainder. If target rows were deleted BELOW a",
      "checkpoint, a plain re-run will not repair them -- parity still reports the gap,",
      "and --reset re-walks from zero (inserts are ON CONFLICT DO NOTHING, so this is",
      "safe and non-duplicating). Trust 'parity: match', not the absence of errors.",
      "",
      "No secrets, tokens, mailboxes, or draft bodies are ever printed.",
    ].join("\n"),
  );
}

function parseOptions(argv = process.argv.slice(2), env = process.env) {
  const allowed = new Set(["--dry-run", "--verify", "--reset", "--json", "--help", "-h"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length) throw new Error("INVALID_ARGUMENT");
  const dryRun = argv.includes("--dry-run");
  const verifyOnly = argv.includes("--verify");
  const reset = argv.includes("--reset");
  if ([dryRun, verifyOnly, reset].filter(Boolean).length > 1) {
    throw new Error("INCOMPATIBLE_ARGUMENTS");
  }
  const clientId = (env.DEMO_CLIENT_ID || env.CLIENT_ID || "default").trim();
  if (!clientId || clientId.length > 256) throw new Error("INVALID_CLIENT_ID");
  const batchSize = Number(env.DEMO_MIGRATION_BATCH || 200);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("INVALID_BATCH_SIZE");
  }
  return {
    dryRun,
    verifyOnly,
    reset,
    asJson: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
    clientId,
    batchSize,
  };
}

function failureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^(INVALID_|INCOMPATIBLE_|TARGET_SCHEMA_MISSING)/.test(message)) return message;
  if (TRANSIENT.test(message)) return "TRANSIENT_DEPENDENCY_FAILURE";
  return "MIGRATION_FAILED";
}

async function main() {
  loadDotEnv();
  const options = parseOptions();
  if (options.help) {
    printUsage();
    return 0;
  }
  const { dryRun, verifyOnly, reset, asJson, clientId, batchSize } = options;

  if (!process.env.DATABASE_URL) {
    throw new Error("TARGET_DATABASE_URL_REQUIRED");
  }
  const source = tursoConfig();
  if (!source) {
    throw new Error("SOURCE_DATABASE_CONFIG_REQUIRED");
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
  });
  await withRetry("connect", () => client.connect());

  const report = {
    mode: dryRun ? "dry-run" : verifyOnly ? "verify" : "migrate",
    client_fingerprint: createHash("sha256").update(clientId).digest("hex").slice(0, 12),
    batch_size: batchSize,
    tables: [],
    parity: "unknown",
  };
  let exitCode = 0;

  try {
    await assertTargetSchema(client);

    if (reset && !dryRun && !verifyOnly) {
      await withRetry("neon checkpoint reset", () =>
        client.query("delete from demo_migration_checkpoints where client_id = $1", [clientId]),
      );
    }

    const checkpoints = await readCheckpoints(client, clientId);

    for (const table of TABLES) {
      const entry = {
        table: table.name,
        target: table.target,
        source_present: await sourceTableExists(source, table.source),
        resumed: Boolean(checkpoints.get(table.name)?.last_source_key),
        copied: 0,
      };

      if (!entry.source_present) {
        // A source table absent in Turso is not an error: there is nothing to move. It is
        // reported explicitly so the operator sees it rather than inferring it from a zero.
        entry.note = "source table absent — nothing to migrate";
        if (!dryRun && !verifyOnly) {
          await withRetry("neon checkpoint completion", () =>
            client.query(
              `insert into demo_migration_checkpoints
                 (client_id, table_name, last_source_key, rows_scanned, completed_at, updated_at)
               values ($1, $2, '', 0, now(), now())
               on conflict (client_id, table_name) do update
                 set completed_at = now(), updated_at = now()`,
              [clientId, table.name],
            ),
          );
        }
        entry.source = { count: 0, checksum: tableChecksum([]) };
        entry.target = await targetParity(client, table, clientId);
        entry.match = entry.target.count === 0;
        report.tables.push(entry);
        continue;
      }

      if (!dryRun && !verifyOnly) {
        const result = await copyTable({
          table,
          source,
          client,
          clientId,
          checkpoint: checkpoints.get(table.name),
          batchSize,
        });
        entry.copied = result.copied;
      }

      entry.source = await sourceParity(source, table);
      entry.target = await targetParity(client, table, clientId);
      entry.match =
        entry.source.count === entry.target.count && entry.source.checksum === entry.target.checksum;
      report.tables.push(entry);
    }

    report.parity = report.tables.every((entry) => entry.match) ? "match" : "mismatch";

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`mode: ${report.mode}   client: ${report.client_fingerprint}`);
      for (const entry of report.tables) {
        const flag = entry.match ? "OK  " : "DIFF";
        console.log(
          `${flag} ${entry.table.padEnd(18)} source=${String(entry.source.count).padStart(6)} target=${String(entry.target.count).padStart(6)} copied=${String(entry.copied).padStart(6)}`,
        );
        console.log(`       source checksum ${entry.source.checksum}`);
        console.log(`       target checksum ${entry.target.checksum}`);
        if (entry.note) console.log(`       note: ${entry.note}`);
        if (entry.resumed) console.log("       resumed from checkpoint");
      }
      console.log(`parity: ${report.parity}`);
    }

    // A mismatch is a failure exit even in dry-run: it is the signal the cutover gate
    // reads, and a green exit on unequal data would be the worst possible outcome.
    if (report.parity !== "match") exitCode = 2;
  } finally {
    await client.end();
  }
  return exitCode;
}

// Only run when invoked as a command. Importing the module (as the tests do) must not
// open a connection or exit the process.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      // Fixed classifications only: provider errors can contain source URLs or tokens.
      console.error(`demo migration failed: ${failureCode(error)}`);
      process.exitCode = 1;
    });
}

// Exported for tests/ts/demoDataMigration.test.ts. These are the pure pieces the parity
// guarantee rests on, so they are asserted directly rather than only through a live run.
export {
  TABLES,
  canonical,
  copyTable,
  normalizeNumber,
  parseOptions,
  rowDigest,
  tableChecksum,
  tursoConfig,
  verifyParity,
  withRetry,
};
