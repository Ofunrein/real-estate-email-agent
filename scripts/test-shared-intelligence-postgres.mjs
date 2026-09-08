#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function bin(name) {
  return path.join(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim(), name);
}
async function port() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "shared-intelligence-postgres-"));
  const data = path.join(temp, "data");
  const pw = path.join(temp, "pw");
  await writeFile(pw, "local-test-password", { mode: 0o600 });
  const listenPort = await port();
  execFileSync(bin("initdb"), ["-D", data, "--username=postgres", "--auth-local=trust", "--auth-host=trust", `--pwfile=${pw}`, "--no-locale"], { stdio: "ignore" });
  const server = spawn(bin("postgres"), ["-D", data, "-h", "127.0.0.1", "-k", temp, "-p", String(listenPort)], { stdio: "ignore" });
  let client;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const candidate = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${listenPort}/postgres`, ssl: false });
      try { await candidate.connect(); client = candidate; break; } catch (error) {
        await candidate.end().catch(() => undefined);
        if (attempt === 59) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await client.query(await readFile(path.join(ROOT, "db/migrations/001_agent_os.sql"), "utf8"));
    await client.query("insert into clients (id, name) values ('tenant-a', 'Tenant A'), ('tenant-b', 'Tenant B')");
    await client.query("insert into properties (client_id, address, price, source, listing_url) values ('tenant-a', '1 Main St', '500000', 'public_listing', 'https://example.invalid/1')");
    const migration = await readFile(path.join(ROOT, "db/migrations/035_shared_intelligence.sql"), "utf8");
    await client.query(migration);
    await client.query(migration);
    const facts = await client.query("select field, source_name, status from property_facts where client_id = 'tenant-a'");
    assert.deepEqual(facts.rows, [{ field: "price", source_name: "public_listing", status: "known" }]);
    await client.query("insert into conversation_states (client_id, subject_key, active_journeys) values ('tenant-a', 'lead:one', array['buyer'])");
    await assert.rejects(client.query("insert into conversation_states (client_id, subject_key) values ('unknown', 'lead:two')"), (error) => error.code === "23503");
    const hash = "a".repeat(64);
    await client.query("insert into scheduling_requests (client_id, idempotency_key, channel, requested_start, requested_end, timezone, contact_hash) values ('tenant-a', $1, 'voice', now(), now() + interval '30 minutes', 'America/Chicago', $1)", [hash]);
    await assert.rejects(client.query("update scheduling_requests set status='confirmed' where idempotency_key=$1", [hash]), (error) => error.code === "23514");
    await client.query("update scheduling_requests set status='confirmed', provider_event_id='evt_1', provider_receipt='{\"readBackVerified\":true}', receipt_verified_at=now() where idempotency_key=$1", [hash]);
    const state = await client.query("select status from scheduling_requests where idempotency_key=$1", [hash]);
    assert.equal(state.rows[0].status, "confirmed");
    console.log("Shared intelligence PostgreSQL integration passed: migration idempotency, fact provenance, tenant isolation, and receipt gate verified");
  } finally {
    await client?.end().catch(() => undefined);
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      if (server.exitCode === null && server.signalCode === null) {
        server.kill("SIGKILL");
        await new Promise((resolve) => server.once("exit", resolve));
      }
    }
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
