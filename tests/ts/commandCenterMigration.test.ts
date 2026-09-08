import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../db/migrations/031_admin_command_center.sql", import.meta.url),
  "utf8",
);

test("command-center migration creates tenant-scoped immutable usage ledger", () => {
  assert.match(migration, /create table if not exists usage_cost_ledger/i);
  assert.match(migration, /client_id text not null references clients\(id\)/i);
  assert.match(migration, /unique \(client_id, attempt_id\)/i);
  assert.match(migration, /before update or delete on usage_cost_ledger/i);
  assert.match(migration, /raise exception 'usage_cost_ledger is append-only'/i);
  assert.match(migration, /usage_cost_ledger_client_time_idx/i);
  assert.match(migration, /usage_cost_ledger_correlation_idx/i);
});

test("usage ledger schema has no customer-content or PII columns", () => {
  const table = migration.match(/create table if not exists usage_cost_ledger \(([\s\S]*?)\n\);/i)?.[1] || "";
  assert.doesNotMatch(
    table,
    /\b(message|body|content|prompt|completion|transcript|email|phone|address|lead_name|auth_token|secret)\b/i,
  );
});
