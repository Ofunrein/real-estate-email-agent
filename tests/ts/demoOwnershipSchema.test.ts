import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Freezes the preservation contract stated in 033_demo_ownership.sql and the
 * least-privilege boundary stated in 034_demo_reader_role.sql.
 *
 * These are static assertions over the migration text. They are the guard against a
 * later edit quietly changing a preserved column type, widening a status domain, or
 * granting the read-only role something it must never have. The migrations were also
 * applied to a real PostgreSQL 16 instance during review; this test is what keeps them
 * honest afterwards without requiring a database in CI.
 */

const ownership = readFileSync(
  new URL("../../db/migrations/033_demo_ownership.sql", import.meta.url),
  "utf8",
);
const roles = readFileSync(
  new URL("../../db/migrations/034_demo_reader_role.sql", import.meta.url),
  "utf8",
);

const DEMO_TABLES = [
  "demo_prospects",
  "demo_listings",
  "demo_rooms",
  "demo_outreach_drafts",
  "demo_engagement_events",
];

/** Statements only, with `--` comment lines stripped, so prose cannot satisfy or break an assertion. */
function statements(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const ownershipSql = statements(ownership);
const rolesSql = statements(roles);

function tableBody(sql: string, table: string) {
  const match = new RegExp(
    `create table if not exists ${table} \\(([\\s\\S]*?)\\n\\);`,
    "i",
  ).exec(sql);
  assert.ok(match, `${table} not found`);
  return match![1];
}

test("every demo table is created and tenant-scoped to clients(id)", () => {
  for (const table of DEMO_TABLES) {
    const body = tableBody(ownership, table);
    assert.match(
      body,
      /client_id text not null references clients\(id\) on delete restrict/i,
      `${table} must be tenant-scoped`,
    );
  }
});

test("ids stay text and are never regenerated as surrogate keys", () => {
  // demo_engagement_events is the documented exception: SQLite rowids are not stable
  // identifiers, so the original lands in source_rowid instead.
  for (const table of [
    "demo_prospects",
    "demo_listings",
    "demo_rooms",
    "demo_outreach_drafts",
  ]) {
    assert.match(
      tableBody(ownership, table),
      /^\s*id text primary key/im,
      `${table}.id must be text`,
    );
  }
  const events = tableBody(ownership, "demo_engagement_events");
  assert.match(events, /id bigserial primary key/i);
  assert.match(events, /source_rowid bigint/i);
});

test("tokens are stored verbatim as text and never re-derived", () => {
  const rooms = tableBody(ownership, "demo_rooms");
  assert.match(rooms, /token_hash text not null/i);
  assert.match(rooms, /access_token text not null/i);
  // No hashing, encoding, or defaulting may be attached to a token column: the value
  // must be exactly what Turso held, or an already-sent demo link stops resolving.
  assert.doesNotMatch(rooms, /access_token[^,]*default/i);
  assert.doesNotMatch(rooms, /token_hash[^,]*default/i);
  // Executable SQL only: the file header discusses these by name in comments.
  assert.doesNotMatch(ownershipSql, /gen_random_uuid|md5\(|encode\(|digest\(/i);
  // The secret that signs demo tokens is neither read nor rotated by this schema.
  assert.doesNotMatch(ownershipSql, /DEMO_ROOM_SECRET/);
});

test("a demo token resolves to exactly one room, globally, not per tenant", () => {
  assert.match(
    ownership,
    /create unique index if not exists demo_rooms_token_hash_key on demo_rooms \(token_hash\)/i,
  );
  assert.match(
    ownership,
    /create unique index if not exists demo_rooms_slug_key on demo_rooms \(slug\)/i,
  );
});

test("timestamps are preserved as text, not silently cast to timestamptz", () => {
  const preserved: Array<[string, string]> = [
    ["demo_prospects", "created_at"],
    ["demo_rooms", "created_at"],
    ["demo_rooms", "expires_at"],
    ["demo_engagement_events", "created_at"],
  ];
  for (const [table, column] of preserved) {
    assert.match(
      tableBody(ownership, table),
      new RegExp(`${column} text not null`, "i"),
      `${table}.${column} must stay text`,
    );
  }
  // Nullable preserved timestamps.
  assert.match(tableBody(ownership, "demo_rooms"), /approved_at text\b/i);
  assert.match(tableBody(ownership, "demo_outreach_drafts"), /sent_at text\b/i);
});

test("the UTC views expose timestamptz without mutating the preserved columns", () => {
  // Reading is fine; the canonical text column must remain the source of truth.
  assert.match(ownership, /create or replace view demo_rooms_utc/i);
  assert.match(
    ownership,
    /\(created_at \|\| '\+00'\)::timestamptz as created_at_utc/i,
  );
  assert.match(ownership, /create or replace view demo_engagement_events_utc/i);
  // A view cannot write, and no trigger may rewrite a preserved value.
  assert.doesNotMatch(ownershipSql, /create (or replace )?trigger/i);
});

test("status domains are preserved exactly as Turso had them, not widened", () => {
  assert.match(
    tableBody(ownership, "demo_prospects"),
    /check \(status in \('draft', 'contacted'\)\)/i,
  );
  assert.match(
    tableBody(ownership, "demo_rooms"),
    /check \(status in \('draft', 'approved'\)\)/i,
  );
  assert.match(
    tableBody(ownership, "demo_outreach_drafts"),
    /check \(status in \('draft', 'sent'\)\)/i,
  );
});

test("the engagement event vocabulary is closed", () => {
  const events = tableBody(ownership, "demo_engagement_events");
  for (const name of [
    "viewed",
    "email_completed",
    "voice_started",
    "voice_completed",
    "repeat_visit",
    "booking_clicked",
    "email_generation_started",
  ]) {
    assert.ok(events.includes(`'${name}'`), `missing event ${name}`);
  }
});

test("send idempotency is enforced by a unique index, not only by convention", () => {
  assert.match(
    tableBody(ownership, "demo_outreach_drafts"),
    /idempotency_key text/i,
  );
  assert.match(
    ownership,
    /create unique index if not exists demo_outreach_drafts_idempotency_key[\s\S]*?where idempotency_key is not null/i,
  );
});

test("engagement dedupe key is a plain unique index so ON CONFLICT can infer it", () => {
  const index =
    /create unique index if not exists demo_engagement_events_source_rowid_key\s*\n?\s*on demo_engagement_events \(client_id, source_rowid\);/i;
  assert.match(ownership, index);
  // A partial index here would break the migrator's idempotent insert, which infers
  // exactly this constraint. Assert the absence of a WHERE clause on that index.
  const match = index.exec(ownership)![0];
  assert.doesNotMatch(match, /where/i);
});

test("referential cascades are tenant-bound, preventing cross-tenant references", () => {
  assert.match(
    tableBody(ownership, "demo_listings"),
    /foreign key \(client_id, prospect_id\)\s+references demo_prospects\(client_id, id\) on delete cascade/i,
  );
  assert.match(
    tableBody(ownership, "demo_rooms"),
    /foreign key \(client_id, listing_id\)\s+references demo_listings\(client_id, id\) on delete cascade/i,
  );
  assert.match(
    tableBody(ownership, "demo_outreach_drafts"),
    /foreign key \(client_id, demo_room_id\)\s+references demo_rooms\(client_id, id\) on delete cascade/i,
  );
  assert.match(
    tableBody(ownership, "demo_engagement_events"),
    /foreign key \(client_id, demo_room_id\)\s+references demo_rooms\(client_id, id\) on delete cascade/i,
  );
});

test("the migration is additive: it drops, renames, and retypes nothing", () => {
  assert.doesNotMatch(
    ownershipSql,
    /\bdrop\s+(table|column|index|view|constraint)\b/i,
  );
  assert.doesNotMatch(
    ownershipSql,
    /\balter\s+table\b[\s\S]*?\b(rename|type)\b/i,
  );
  assert.doesNotMatch(ownershipSql, /\btruncate\b/i);
  assert.doesNotMatch(ownershipSql, /\bdelete\s+from\b/i);
});

test("migration numbers stay unique and sequential after 032", () => {
  const names = readdirSync(new URL("../../db/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(names.includes("033_demo_ownership.sql"));
  assert.ok(names.includes("034_demo_reader_role.sql"));
  for (const prefix of ["033", "034"]) {
    assert.equal(
      names.filter((name) => name.startsWith(`${prefix}_`)).length,
      1,
      `duplicate ${prefix} migration`,
    );
  }
  assert.ok(
    names.indexOf("033_demo_ownership.sql") <
      names.indexOf("034_demo_reader_role.sql"),
  );
});

/* ---------------------------------------------------------------- 034: roles ----- */

test("site roles have no table access and only the minimal function API", () => {
  assert.match(
    roles,
    /revoke all privileges on all tables in schema public\s+from demo_public_reader, demo_engagement_writer;/i,
  );
  assert.match(
    roles,
    /grant execute on function demo_public_api\.lookup_room\(text\)\s+to demo_public_reader;/i,
  );
  assert.match(
    roles,
    /grant execute on function demo_public_api\.record_engagement\(text, text, integer\)\s+to demo_engagement_writer;/i,
  );
  assert.match(
    roles,
    /grant execute on function demo_public_api\.reserve_email_generation\(text\)\s+to demo_engagement_writer;/i,
  );
  assert.doesNotMatch(rolesSql, /grant (select|insert|update|delete) on demo_/i);
});

test("lookup cannot enumerate rooms or expose tokens, mailboxes, or drafts", () => {
  assert.match(roles, /where r\.token_hash = p_token_hash/i);
  assert.match(roles, /and r\.status = 'approved'/i);
  assert.match(roles, /returns table \(id text, config_json text, expires_at text\)/i);
  const body = /create or replace function demo_public_api\.lookup_room[\s\S]*?\$\$;/i.exec(roles)![0];
  assert.doesNotMatch(body, /access_token|prospect|outreach|recipient|sender_inbox/i);
});

test("neither role may create objects or become privileged from the migration", () => {
  assert.match(roles, /create role demo_public_reader nologin;/i);
  assert.match(roles, /create role demo_engagement_writer nologin;/i);
  assert.match(
    roles,
    /revoke all privileges on schema public\s+from demo_public_reader, demo_engagement_writer;/i,
  );
  assert.match(roles, /nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/i);
});

test("future tables and sequences default to no access for either role", () => {
  assert.match(
    roles,
    /alter default privileges in schema public\s+revoke all on tables from demo_public_reader, demo_engagement_writer;/i,
  );
  assert.match(
    roles,
    /alter default privileges in schema public\s+revoke all on sequences from demo_public_reader, demo_engagement_writer;/i,
  );
});

test("no credential is committed in either migration", () => {
  // Roles are created without a password; the runbook sets one out of band.
  assert.doesNotMatch(rolesSql, /password\s+'[^']+'/i);
  assert.doesNotMatch(rolesSql, /login password/i);
  for (const sql of [ownership, roles]) {
    assert.doesNotMatch(
      sql,
      /postgres(ql)?:\/\/[^\s]*:[^\s]*@/i,
      "connection string in migration",
    );
  }
});
