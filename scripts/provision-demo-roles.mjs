#!/usr/bin/env node
/**
 * Provision the two login identities lumenosis-site uses to reach the demo datastore.
 *
 * Why this is a script and not a migration: it writes passwords. Migrations are committed,
 * so a migration cannot contain a credential. The two privilege-bearing roles
 * (demo_public_reader, demo_engagement_writer) ARE created by
 * db/migrations/034_demo_reader_role.sql and stay nologin forever — they are privilege
 * bundles, not identities. This script creates login users that INHERIT them.
 *
 * The split matters: privileges live in a role that cannot connect, identities can connect
 * but hold no privileges of their own. Rotating a password never touches a grant, and
 * revoking an identity never disturbs the privilege model.
 *
 * Passwords are generated here with crypto.randomBytes and printed once to stdout. They are
 * never written to disk by this script and never committed. Capture them into Vercel env at
 * the moment of the run.
 *
 * Idempotent: re-running rotates the passwords and re-asserts the grants without altering
 * privileges. Safe against a database where the users already exist.
 *
 * Usage:
 *   DATABASE_URL=<owner connection string> node scripts/provision-demo-roles.mjs
 *   DATABASE_URL=... node scripts/provision-demo-roles.mjs --print-urls
 */

import crypto from "node:crypto";
import pg from "pg";

const IDENTITIES = [
  {
    user: "demo_public_api_reader",
    inherits: "demo_public_reader",
    purpose: "public demo room rendering (lookup_room only)",
    envVar: "DEMO_READ_DATABASE_URL",
  },
  {
    user: "demo_public_api_writer",
    inherits: "demo_engagement_writer",
    purpose: "engagement append + email generation reservation",
    envVar: "DEMO_WRITE_DATABASE_URL",
  },
];

/** URL-safe, no shell-hostile or connection-string-hostile characters. */
function generatePassword() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Role DDL cannot be parameterised: CREATE ROLE and friends are utility statements, and
 * wrapping them in a DO block does not help because a DO body is a string literal that
 * cannot itself carry bind parameters (`there is no parameter $1`). So the values are
 * escaped client-side with pg's own escapeIdentifier/escapeLiteral, which implement the
 * server's quoting rules, rather than by string concatenation.
 *
 * The identifiers are hardcoded constants from IDENTITIES and never user input; escaping
 * them is for correctness. The password is generated, and escapeLiteral guarantees a
 * generated value can never terminate the literal early.
 */
async function provision(client, identity, password) {
  const user = pg.Client.prototype.escapeIdentifier(identity.user);
  const inherits = pg.Client.prototype.escapeIdentifier(identity.inherits);
  const secret = pg.Client.prototype.escapeLiteral(password);

  const exists = await client.query("select 1 from pg_roles where rolname = $1", [identity.user]);

  if (exists.rowCount === 0) {
    await client.query(`create role ${user} login inherit password ${secret}`);
  } else {
    await client.query(`alter role ${user} with login inherit password ${secret}`);
  }

  // Privileges arrive only by inheritance. The login user is granted nothing directly.
  await client.query(`grant ${inherits} to ${user}`);

  // Usage on the keyhole schema. Without schema usage the inherited EXECUTE grant on the
  // functions is unreachable. Revoking public keeps the identity out of the main schema.
  await client.query(`grant usage on schema demo_public_api to ${user}`);
  await client.query(`revoke all on schema public from ${user}`);
}

/** Assert the identity really is confined to the keyhole. Fails loudly if not. */
async function verifyConfinement(client, identity) {
  const tablePrivs = await client.query(
    `select count(*)::int as n from information_schema.table_privileges where grantee = $1`,
    [identity.user],
  );

  const superuser = await client.query(
    `select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls as elevated
       from pg_roles where rolname = $1`,
    [identity.user],
  );

  const funcs = await client.query(
    `select p.proname,
            has_function_privilege($1, p.oid, 'execute') as can_execute
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'demo_public_api'
      order by p.proname`,
    [identity.user],
  );

  const problems = [];
  if (tablePrivs.rows[0].n !== 0) {
    problems.push(`${identity.user} holds ${tablePrivs.rows[0].n} direct table privilege(s)`);
  }
  if (superuser.rows[0]?.elevated) {
    problems.push(`${identity.user} has an elevated role attribute`);
  }

  const allowed = identity.inherits === "demo_public_reader"
    ? new Set(["lookup_room"])
    : new Set(["record_engagement", "reserve_email_generation"]);

  for (const row of funcs.rows) {
    const shouldExecute = allowed.has(row.proname);
    if (row.can_execute !== shouldExecute) {
      problems.push(
        `${identity.user} execute on ${row.proname} is ${row.can_execute}, expected ${shouldExecute}`,
      );
    }
  }

  return problems;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (owner connection string)");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const results = [];
  const problems = [];

  try {
    for (const identity of IDENTITIES) {
      const password = generatePassword();
      await provision(client, identity, password);
      const found = await verifyConfinement(client, identity);
      problems.push(...found);
      results.push({ identity, password });
    }
  } finally {
    await client.end();
  }

  if (problems.length) {
    console.error("CONFINEMENT_CHECK_FAILED");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const base = new URL(url);
  console.log("provisioned; confinement verified\n");
  for (const { identity, password } of results) {
    const u = new URL(base.toString());
    u.username = identity.user;
    u.password = password;
    console.log(`# ${identity.purpose}`);
    console.log(`${identity.envVar}=${u.toString()}`);
    console.log("");
  }
}

await main();
