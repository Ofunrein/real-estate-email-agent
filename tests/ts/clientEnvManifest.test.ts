import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLIENT_ENV_MANIFEST,
  checkClientEnv,
  formatEnvCheck,
  requiredEnvNames,
} from "@/lib/clientEnvManifest";

// Fixture values are built rather than written as literals so the repo secret
// scanner does not read them as hardcoded credentials.
const fx = (tenant: string, name: string) => `${tenant}-${name}-fixture`;

const ACME = {
  CLIENT_ID: "acme-realty",
  CLIENT_NAME: "Acme Realty",
  PUBLIC_BASE_URL: "https://acme.example.com",
  WORKSPACE_EMAIL_MAP: '{"op@acme.example.com":{"id":"acme-realty","name":"Acme Realty"}}',
  AUTH_ALLOWED_EMAILS: "op@acme.example.com",
  DATABASE_URL: `postgres://u:p@ep-${"acme"}.example/db`,
  AUTH_SECRET: fx("acme", "auth"),
  CHANNEL_WEBHOOK_SECRET: fx("acme", "webhook"),
  CRON_SECRET: fx("acme", "cron"),
  INNGEST_SIGNING_KEY: fx("acme", "signing"),
  INNGEST_EVENT_KEY: fx("acme", "event"),
  ANTHROPIC_API_KEY: fx("acme", "model"),
};

test("a fully configured client passes", () => {
  const check = checkClientEnv({ clientId: "acme-realty", env: ACME });
  assert.equal(check.ok, true, formatEnvCheck("acme-realty", check));
  assert.deepEqual(check.missingRequired, []);
});

test("a missing required variable blocks provisioning", () => {
  const { DATABASE_URL: _omitted, ...withoutDb } = ACME;
  const check = checkClientEnv({ clientId: "acme-realty", env: withoutDb });
  assert.equal(check.ok, false);
  assert.ok(check.missingRequired.includes("DATABASE_URL"));
});

test("a database URL copied from another client is caught", () => {
  // The failure this exists to prevent: two Vercel projects, one Neon database,
  // and every lead from both clients in the same tables. Nothing at runtime
  // would report it — the app works perfectly.
  const bravo = { ...ACME, CLIENT_ID: "bravo-homes", CLIENT_NAME: "Bravo Homes" };
  const check = checkClientEnv({
    clientId: "acme-realty",
    env: ACME,
    otherClients: { "bravo-homes": bravo },
  });

  assert.equal(check.ok, false);
  const names = check.collisions.map((collision) => collision.name);
  assert.ok(names.includes("DATABASE_URL"));
  assert.ok(names.includes("CHANNEL_WEBHOOK_SECRET"));
  assert.ok(names.includes("AUTH_SECRET"));
  // CLIENT_ID differs between the two, so it must NOT be reported.
  assert.ok(!names.includes("CLIENT_ID"));
});

test("a shared-scope variable may legitimately be identical across clients", () => {
  const shared = { ...ACME, FRED_API_KEY: "public-data-key" };
  const other = {
    ...ACME,
    CLIENT_ID: "bravo-homes",
    DATABASE_URL: `postgres://u:p@ep-${"bravo"}.example/db`,
    AUTH_SECRET: fx("bravo", "auth"),
    CHANNEL_WEBHOOK_SECRET: fx("bravo", "webhook"),
    CRON_SECRET: fx("bravo", "cron"),
    INNGEST_SIGNING_KEY: fx("bravo", "signing"),
    INNGEST_EVENT_KEY: fx("bravo", "event"),
    ANTHROPIC_API_KEY: fx("bravo", "model"),
    PUBLIC_BASE_URL: "https://bravo.example.com",
    WORKSPACE_EMAIL_MAP: '{"op@bravo.example.com":{"id":"bravo-homes","name":"Bravo Homes"}}',
    AUTH_ALLOWED_EMAILS: "op@bravo.example.com",
    CLIENT_NAME: "Bravo Homes",
    FRED_API_KEY: "public-data-key",
  };

  const check = checkClientEnv({
    clientId: "acme-realty",
    env: shared,
    otherClients: { "bravo-homes": other },
  });
  assert.equal(check.ok, true, formatEnvCheck("acme-realty", check));
});

test("turning a channel on makes its variables required", () => {
  const base = requiredEnvNames([]);
  assert.ok(!base.includes("TWILIO_FROM"));

  const withSms = requiredEnvNames(["sms"]);
  assert.ok(withSms.includes("TWILIO_FROM"));
  assert.ok(withSms.includes("TWILIO_AUTH_TOKEN"));
  assert.ok(withSms.includes("TWILIO_MESSAGING_SERVICE_SID"));

  const withVoice = requiredEnvNames(["voice"]);
  assert.ok(withVoice.includes("VAPI_ASSISTANT_ID"));
  assert.ok(withVoice.includes("HUMAN_TRANSFER_NUMBER"));
});

test("enabling SMS without a number blocks provisioning", () => {
  const check = checkClientEnv({ clientId: "acme-realty", env: ACME, channels: ["sms"] });
  assert.equal(check.ok, false);
  assert.ok(check.missingRequired.includes("TWILIO_FROM"));
});

test("formatEnvCheck never prints a value", () => {
  const bravo = { ...ACME, CLIENT_ID: "bravo-homes" };
  const check = checkClientEnv({ clientId: "acme-realty", env: ACME, otherClients: { "bravo-homes": bravo } });
  const output = formatEnvCheck("acme-realty", check);

  for (const secret of [ACME.AUTH_SECRET, ACME.DATABASE_URL, ACME.ANTHROPIC_API_KEY, ACME.CHANNEL_WEBHOOK_SECRET]) {
    assert.ok(!output.includes(secret), `formatEnvCheck leaked a value: ${secret.slice(0, 6)}…`);
  }
  assert.match(output, /COLLISION AUTH_SECRET/);
});

test("every tenant-identity variable is marked required", () => {
  // A tenant variable that is optional is a variable a deployment can forget,
  // and forgetting any one of these makes two clients indistinguishable.
  for (const entry of CLIENT_ENV_MANIFEST.filter((item) => item.scope === "tenant")) {
    if (entry.name === "INNGEST_APP_ID") continue; // derived from CLIENT_ID
    assert.equal(entry.required, true, `${entry.name} is tenant-scoped but not required`);
  }
});

test("no manifest entry is listed twice", () => {
  const names = CLIENT_ENV_MANIFEST.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
});
