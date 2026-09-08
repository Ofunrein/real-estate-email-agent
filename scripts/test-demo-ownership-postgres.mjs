#!/usr/bin/env node

/**
 * Disposable local-Postgres integration test for migrations 033/034 and the release CLI.
 * It always creates a fresh temporary cluster and refuses every caller-supplied database URL.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, "scripts", "release-demo-ownership.mjs");
const MIGRATOR = path.join(ROOT, "scripts", "migrate-demo-data.mjs");
const FAKE_TURSO = path.join(ROOT, "scripts", "dev", "fake-turso.mjs");

function postgresBin(name) {
  const bindir = execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  return path.join(bindir, name);
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForPostgres(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new pg.Client({ connectionString: url, ssl: false });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function runRelease(url, args, extraEnv = {}) {
  return execFileSync(process.execPath, [RELEASE, ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_SSL: "false",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runMigrator(url, sourceUrl, args = []) {
  return JSON.parse(
    execFileSync(process.execPath, [MIGRATOR, ...args, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: url,
        DATABASE_SSL: "false",
        DEMO_CLIENT_ID: "tenant-migrate",
        DEMO_MIGRATION_BATCH: "1",
        LUMENOSIS_TURSO_DATABASE_URL: sourceUrl,
        LUMENOSIS_TURSO_AUTH_TOKEN: "local-test-placeholder",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function createSourceDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    create table prospects (id text primary key, full_name text, first_name text, email text,
      business_name text, role text, sender_inbox text, status text, created_at text);
    create table listings (id text primary key, prospect_id text, address text, source_url text,
      status text, price real, beds integer, baths real, square_feet integer, acreage real,
      mls text, details_json text, sources_json text, verified_at text);
    create table demo_rooms (id text primary key, prospect_id text, listing_id text, slug text,
      token_hash text, access_token text, config_json text, status text, expires_at text,
      approved_at text, created_at text);
    create table outreach_drafts (id text primary key, demo_room_id text, sender_name text,
      sender_inbox text, recipient text, subject text, body text, status text, sent_at text,
      provider_message_id text);
    create table engagement_events (id integer primary key, demo_room_id text, event text,
      duration_seconds integer, created_at text);
    insert into prospects values ('001', 'Migration Example', 'Migration',
      'migration@example.invalid', 'Example', 'agent', 'sender@example.invalid', 'draft',
      '2026-01-02 00:00:00');
    insert into listings values ('002', '001', 'Migration address', 'https://example.invalid',
      'verified', 3.0, 2, 1.5, 900, 0.25, 'MLS-002', '{}', '[]', '2026-01-02 00:00:00');
    insert into demo_rooms values ('003', '001', '002', 'migration-room', 'opaque-hash-003',
      'opaque-token-003', '{}', 'approved', '2099-01-02 00:00:00',
      '2026-01-02 00:00:00', '2026-01-02 00:00:00');
    insert into outreach_drafts values ('004', '003', 'Example', 'sender@example.invalid',
      'recipient@example.invalid', 'Example subject', 'Example body', 'draft', null, null);
    insert into engagement_events values (1, '003', 'viewed', 3, '2026-01-02 00:00:00');
  `);
  db.close();
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST", body: "{}" });
      if (response.ok) return;
    } catch {
      // Process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("local source did not start");
}

async function seedLedger(client) {
  await client.query(`
    create table clients (id text primary key);
    create table schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
    insert into clients (id) values ('tenant-a'), ('tenant-b');
  `);
  const directory = path.join(ROOT, "db", "migrations");
  const names = (await readdir(directory))
    .filter((name) => /^\d+_.+\.sql$/.test(name) && name < "033_demo_ownership.sql")
    .sort();
  for (const name of names) {
    const sql = await readFile(path.join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
      name,
      checksum,
    ]);
  }
}

async function expectDenied(action) {
  await assert.rejects(action, (error) => error && error.code === "42501");
}

function connectionUrl(user, password, port) {
  const url = new URL(`postgresql://${user}@127.0.0.1:${port}/postgres`);
  url.password = password;
  return url.toString();
}

async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "demo-ownership-postgres-"));
  const data = path.join(temp, "data");
  const passwordFile = path.join(temp, "pw");
  const superPassword = randomBytes(24).toString("hex");
  const readerPassword = randomBytes(24).toString("hex");
  const writerPassword = randomBytes(24).toString("hex");
  const port = await availablePort();
  await writeFile(passwordFile, superPassword, { mode: 0o600 });

  execFileSync(postgresBin("initdb"), [
    "-D",
    data,
    "--username=postgres",
    "--auth-host=scram-sha-256",
    "--auth-local=trust",
    `--pwfile=${passwordFile}`,
    "--no-locale",
  ], { stdio: "ignore" });

  const server = spawn(postgresBin("postgres"), ["-D", data, "-h", "127.0.0.1", "-p", String(port)], {
    stdio: "ignore",
    detached: false,
  });
  const adminUrl = connectionUrl("postgres", superPassword, port);
  let admin;
  let reader;
  let writer;
  let sourceServer;
  try {
    admin = await waitForPostgres(adminUrl);
    await seedLedger(admin);

    const first = JSON.parse(runRelease(adminUrl, ["--apply"]));
    assert.deepEqual(first.applied, ["033_demo_ownership.sql", "034_demo_reader_role.sql"]);
    const second = JSON.parse(runRelease(adminUrl, ["--apply"]));
    assert.deepEqual(second.skipped, ["033_demo_ownership.sql", "034_demo_reader_role.sql"]);

    const grant = JSON.parse(
      runRelease(adminUrl, ["--grant-password"], {
        DEMO_READER_PASSWORD: readerPassword,
        DEMO_WRITER_PASSWORD: writerPassword,
      }),
    );
    assert.equal(grant.roles_enabled, 2);

    await admin.query(`
      insert into demo_prospects
        (client_id, id, full_name, first_name, email, business_name, role, sender_inbox, status, created_at)
      values
        ('tenant-a', 'p-a', 'Example A', 'Example', 'a@example.invalid', 'A', 'agent', 'sender@example.invalid', 'draft', '2026-01-01 00:00:00'),
        ('tenant-b', 'p-b', 'Example B', 'Example', 'b@example.invalid', 'B', 'agent', 'sender@example.invalid', 'draft', '2026-01-01 00:00:00');
      insert into demo_listings
        (client_id, id, prospect_id, address, source_url, status, price, beds, baths, square_feet, acreage, mls, details_json, sources_json, verified_at)
      values
        ('tenant-a', 'l-a', 'p-a', 'Example address', 'https://example.invalid', 'verified', 1, 1, 1, 1, 1, 'MLS-A', '{}', '[]', '2026-01-01 00:00:00');
      insert into demo_rooms
        (client_id, id, prospect_id, listing_id, slug, token_hash, access_token, config_json, status, expires_at, approved_at, created_at)
      values
        ('tenant-a', 'r-a', 'p-a', 'l-a', 'room-a', 'opaque-hash-a', 'opaque-token-a', '{}', 'approved', '2099-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
    `);
    await assert.rejects(
      admin.query(
        "insert into demo_rooms (client_id, id, prospect_id, listing_id, slug, token_hash, access_token, config_json, status, expires_at, created_at) values ('tenant-b', 'bad', 'p-a', 'l-a', 'bad', 'bad', 'bad', '{}', 'draft', '2099-01-01 00:00:00', '2026-01-01 00:00:00')",
      ),
      (error) => error && error.code === "23503",
    );

    reader = new pg.Client({
      connectionString: connectionUrl("demo_public_reader", readerPassword, port),
      ssl: false,
    });
    await reader.connect();
    const lookup = await reader.query(
      "select id, config_json, expires_at from demo_public_api.lookup_room($1)",
      ["opaque-hash-a"],
    );
    assert.deepEqual(lookup.rows, [{ id: "r-a", config_json: "{}", expires_at: "2099-01-01 00:00:00" }]);
    assert.equal((await reader.query("select * from demo_public_api.lookup_room($1)", ["missing"])).rowCount, 0);
    await expectDenied(reader.query("select * from demo_rooms"));

    writer = new pg.Client({
      connectionString: connectionUrl("demo_engagement_writer", writerPassword, port),
      ssl: false,
    });
    await writer.connect();
    assert.equal(
      (await writer.query("select demo_public_api.record_engagement($1, $2, $3) as accepted", ["opaque-hash-a", "viewed", 3])).rows[0].accepted,
      true,
    );
    for (let attempt = 0; attempt < 12; attempt += 1) {
      assert.equal(
        (await writer.query("select demo_public_api.reserve_email_generation($1) as accepted", ["opaque-hash-a"])).rows[0].accepted,
        true,
      );
    }
    assert.equal(
      (await writer.query("select demo_public_api.reserve_email_generation($1) as accepted", ["opaque-hash-a"])).rows[0].accepted,
      false,
    );
    await expectDenied(writer.query("select * from demo_rooms"));
    await expectDenied(
      writer.query(
        "insert into demo_engagement_events (client_id, demo_room_id, event, created_at) values ('tenant-a', 'r-a', 'viewed', '2026-01-01 00:00:00')",
      ),
    );

    const rows = await admin.query("select count(*)::int as count from demo_engagement_events where client_id = 'tenant-a'");
    assert.equal(rows.rows[0].count, 13);

    const sourceFile = path.join(temp, "source.sqlite");
    const sourcePort = await availablePort();
    const sourceUrl = `http://127.0.0.1:${sourcePort}`;
    createSourceDatabase(sourceFile);
    await admin.query("insert into clients (id) values ('tenant-migrate')");
    sourceServer = spawn(
      process.execPath,
      [FAKE_TURSO, sourceFile, String(sourcePort), "--fail-every=3"],
      { stdio: "ignore", detached: false },
    );
    await waitForHttp(`${sourceUrl}/v2/pipeline`);

    const migrated = runMigrator(adminUrl, sourceUrl);
    assert.equal(migrated.parity, "match");
    assert.ok(migrated.tables.every((table) => table.copied === 1));
    const replayed = runMigrator(adminUrl, sourceUrl);
    assert.equal(replayed.parity, "match");
    assert.ok(replayed.tables.every((table) => table.copied === 0));
    assert.equal(runMigrator(adminUrl, sourceUrl, ["--verify"]).parity, "match");

    const releaseGate = JSON.parse(
      runRelease(adminUrl, ["--check"], {
        DEMO_CLIENT_ID: "tenant-migrate",
        LUMENOSIS_TURSO_DATABASE_URL: sourceUrl,
        LUMENOSIS_TURSO_AUTH_TOKEN: "local-test-placeholder",
      }),
    );
    assert.equal(releaseGate.gate, "pass");
    console.log("demo ownership Postgres integration: pass");
  } finally {
    await Promise.all([
      reader?.end().catch(() => undefined),
      writer?.end().catch(() => undefined),
      admin?.end().catch(() => undefined),
    ]);
    if (sourceServer) {
      sourceServer.kill("SIGTERM");
      await new Promise((resolve) => sourceServer.once("exit", resolve));
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error("demo ownership Postgres integration: fail");
  process.exitCode = 1;
});
