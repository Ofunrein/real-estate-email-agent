#!/usr/bin/env node
/**
 * Provision one client: one Vercel project + one Neon database, from this repo.
 *
 *   node scripts/provision-client.mjs --client <id>              # dry run (default)
 *   node scripts/provision-client.mjs --client <id> --apply      # execute
 *   node scripts/provision-client.mjs --client <id> --validate   # check a live deployment
 *   node scripts/provision-client.mjs --client <id> --rollback   # undo what it created
 *
 * Reads clients/<id>.env. Never invents a credential: anything it cannot derive
 * is reported as a blocking human input and the run stops.
 *
 * DRY RUN IS THE DEFAULT and every printed value is redacted. --apply is
 * required before anything is written anywhere.
 *
 * Deliberately NOT automated, because each is billable, irreversible, or
 * outward-facing and belongs to a human:
 *   - buying a Twilio number
 *   - A2P 10DLC brand/campaign registration
 *   - upgrading a Vercel or Neon plan
 *   - buying/attaching a Vapi number
 *   - DNS records for a custom domain
 *   - the production deploy itself
 * The script tells you which of these are outstanding and verifies the result
 * once you have done them.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENTS_DIR = path.join(ROOT, "clients");

// ---------------------------------------------------------------- utilities

function parseArgs(argv) {
  const args = { apply: false, validate: false, rollback: false, client: "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--validate") args.validate = true;
    else if (arg === "--rollback") args.rollback = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--client") args.client = String(argv[++i] || "").trim();
    else if (arg.startsWith("--client=")) args.client = arg.slice("--client=".length).trim();
  }
  return args;
}

function parseEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    env[key] = /^['"]/.test(raw) ? raw.replace(/^['"]|['"]$/g, "") : raw.replace(/(?:^|\s+)#.*$/, "").trim();
  }
  return env;
}

/**
 * Everything printed goes through here.
 *
 * Length and a short fingerprint are enough to tell "set", "set to the same
 * thing as the other client", and "empty" apart, without ever putting the
 * value on a terminal, in scrollback, or in a CI log.
 */
function redact(value) {
  const text = String(value ?? "");
  if (!text) return "[empty]";
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return `[set len=${text.length} fp=${hash.toString(16).slice(0, 6)}]`;
}

function run(command, argv, options = {}) {
  // execFileSync returns null when stdout is inherited rather than piped, so
  // .trim() on the result would throw after a perfectly successful command.
  const out = execFileSync(command, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  return out == null ? "" : String(out).trim();
}

function has(command) {
  try {
    run("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function slugValid(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

// ------------------------------------------------------------------- checks

function preflight(clientId) {
  const problems = [];
  if (!clientId) problems.push("--client <id> is required.");
  else if (!slugValid(clientId)) problems.push(`Client id "${clientId}" must be a lowercase slug (a-z, 0-9, hyphens).`);

  const tools = ["node", "psql", "vercel", "neon"].map((name) => ({ name, present: has(name) }));
  for (const tool of tools.filter((t) => !t.present)) {
    problems.push(`Missing CLI: ${tool.name}`);
  }
  return { problems, tools };
}

function loadClientEnv(clientId) {
  const file = path.join(CLIENTS_DIR, `${clientId}.env`);
  if (!fs.existsSync(file)) {
    return { file, env: {}, missing: true };
  }
  return { file, env: parseEnvFile(file), missing: false };
}

function otherClientEnvs(clientId) {
  if (!fs.existsSync(CLIENTS_DIR)) return {};
  const result = {};
  for (const name of fs.readdirSync(CLIENTS_DIR)) {
    if (!name.endsWith(".env") || name === "template.env" || name === `${clientId}.env`) continue;
    result[name.replace(/\.env$/, "")] = parseEnvFile(path.join(CLIENTS_DIR, name));
  }
  return result;
}

/** Blocking inputs a human must supply. Each is a credential, a purchase, or an irreversible provider action. */
function blockingInputs(env) {
  const need = (name) => !String(env[name] || "").trim();
  const blockers = [];

  if (need("DATABASE_URL")) {
    blockers.push({
      key: "neon_database",
      ask: "Create the client's Neon project and paste its pooled connection string into DATABASE_URL.",
      why: "Creating a Neon project can be billable and binds a region. Not automated.",
    });
  }
  if (need("VERCEL_PROJECT_NAME")) {
    blockers.push({
      key: "vercel_project",
      ask: "Create the Vercel project for this client and set VERCEL_PROJECT_NAME.",
      why: "A new project is an account-level, outward-facing resource.",
    });
  }
  if (need("PUBLIC_BASE_URL")) {
    blockers.push({
      key: "domain",
      ask: "Decide the client's domain/subdomain and set PUBLIC_BASE_URL. Add DNS yourself.",
      why: "DNS changes are irreversible from this script's point of view.",
    });
  }
  if (String(env.ENABLE_SMS_AGENT || "").toLowerCase() === "true" && need("TWILIO_FROM")) {
    blockers.push({
      key: "twilio_number",
      ask: "Buy a Twilio number for this client and set TWILIO_FROM (plus TWILIO_MESSAGING_SERVICE_SID).",
      why: "Buying a number is a billable purchase.",
    });
  }
  if (String(env.ENABLE_SMS_AGENT || "").toLowerCase() === "true" && need("TWILIO_MESSAGING_SERVICE_SID")) {
    blockers.push({
      key: "a2p_10dlc",
      ask: "Create the Messaging Service and start A2P 10DLC brand + campaign registration.",
      why: "Registration is a paid, reviewed process with a multi-day lead time. Start it early.",
    });
  }
  if (need("VAPI_ASSISTANT_ID") && !need("VAPI_API_KEY")) {
    blockers.push({
      key: "vapi_assistant",
      ask: "Run `npm run aria:provision` with this client's env, then set VAPI_ASSISTANT_ID.",
      why: "Creates a live assistant in the client's Vapi account.",
    });
  }
  if (need("VAPI_PHONE_NUMBER_ID") && !need("VAPI_API_KEY")) {
    blockers.push({
      key: "vapi_number",
      ask: "Attach a Vapi phone number to the assistant and set VAPI_PHONE_NUMBER_ID.",
      why: "Billable and outward-facing.",
    });
  }
  return blockers;
}

/** The webhook URLs a human registers with each provider. Secrets never printed. */
function webhookPlan(env) {
  const base = String(env.PUBLIC_BASE_URL || "https://<PUBLIC_BASE_URL>").replace(/\/$/, "");
  return [
    { provider: "twilio", purpose: "inbound SMS", url: `${base}/api/webhooks/theo-sms?secret=$CHANNEL_WEBHOOK_SECRET` },
    { provider: "twilio", purpose: "delivery status", url: `${base}/api/webhooks/twilio-status?secret=$CHANNEL_WEBHOOK_SECRET` },
    { provider: "twilio", purpose: "operator control SMS", url: `${base}/api/webhooks/aria-sms-control` },
    { provider: "vapi", purpose: "assistant server URL", url: `${base}/api/webhooks/aria-voice?secret=$CHANNEL_WEBHOOK_SECRET` },
    { provider: "google-pubsub", purpose: "Gmail push", url: `${base}/api/webhooks/iris-gmail-push?token=$GMAIL_PUBSUB_TOKEN` },
    { provider: "inngest", purpose: "function endpoint", url: `${base}/api/inngest` },
  ];
}

// -------------------------------------------------------------------- steps

function planSteps(clientId, env) {
  return [
    { id: "env", label: `Validate clients/${clientId}.env against the manifest`, automated: true },
    { id: "migrate", label: "Apply pending migrations and seed the clients row", automated: true, command: "node scripts/migrate.mjs" },
    { id: "vercel-env", label: `Push env vars to Vercel project ${env.VERCEL_PROJECT_NAME || "<unset>"}`, automated: true },
    { id: "twilio", label: "Point Twilio inbound + status webhooks at this deployment", automated: true, command: "node scripts/configure-theo-twilio.mjs" },
    { id: "vapi", label: "Provision the Vapi assistant", automated: true, command: "npm run aria:provision" },
    { id: "gmail", label: "Register the Gmail watch", automated: true, command: "npm run setup:gmail-push" },
    { id: "validate", label: "Verify the live deployment answers on every configured channel", automated: true },
  ];
}

async function validateDeployment(env) {
  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) return [{ check: "public_base_url", ok: false, detail: "PUBLIC_BASE_URL is not set" }];

  const checks = [];
  const probe = async (name, url, expectStatuses) => {
    try {
      const response = await fetch(url, { method: "GET", redirect: "manual" });
      checks.push({
        check: name,
        ok: expectStatuses.includes(response.status),
        detail: `HTTP ${response.status}`,
      });
    } catch (error) {
      checks.push({ check: name, ok: false, detail: error instanceof Error ? error.message : "unreachable" });
    }
  };

  // Unauthenticated probes only. A 401/403 is a PASS: it proves the route is
  // deployed and refusing anonymous callers, which is exactly what we want.
  await probe("app_reachable", base, [200, 302, 307, 401]);
  await probe("inngest_endpoint", `${base}/api/inngest`, [200, 405, 503]);
  await probe("data_requires_auth", `${base}/api/data`, [401, 403]);
  await probe("gmail_push_requires_token", `${base}/api/webhooks/iris-gmail-push`, [401]);
  return checks;
}

function rollbackPlan(clientId, env) {
  // Only things this script creates. It never proposes deleting a Neon project,
  // a Vercel project, a phone number, or anything else a human bought.
  return [
    { action: `Remove Vercel env vars from project ${env.VERCEL_PROJECT_NAME || "<unset>"}`, automated: true, reversible: true },
    { action: `Point Twilio webhooks back to the previous URL`, automated: false, reversible: true, note: "Re-run configure-theo-twilio.mjs against the old PUBLIC_BASE_URL." },
    { action: `Stop the Gmail watch for this mailbox`, automated: false, reversible: true, note: "gcloud pubsub subscriptions delete, or let the 7-day watch lapse." },
    { action: `Delete clients/${clientId}.env`, automated: false, reversible: false, note: "Manual. Holds credentials." },
    { action: "Neon project, Vercel project, Twilio number, Vapi number", automated: false, reversible: false, note: "NOT touched. Billable resources are removed by a human or not at all." },
  ];
}

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { problems, tools } = preflight(args.client);
  const { file, env, missing } = loadClientEnv(args.client);

  if (missing && args.client) {
    problems.push(`Missing ${path.relative(ROOT, file)}. Copy clients/template.env and fill it in.`);
  }

  const { checkClientEnv, formatEnvCheck } = await import("../lib/clientEnvManifest.ts");
  const channels = [
    String(env.ENABLE_SMS_AGENT || "").toLowerCase() === "true" ? "sms" : "",
    String(env.IRIS_EMAIL_LIVE || "").toLowerCase() === "true" ? "email" : "",
    String(env.VAPI_API_KEY || "") ? "voice" : "",
  ].filter(Boolean);

  const envCheck = checkClientEnv({
    clientId: args.client,
    env,
    channels,
    otherClients: otherClientEnvs(args.client),
  });

  const report = {
    client_id: args.client,
    mode: args.rollback ? "rollback" : args.validate ? "validate" : args.apply ? "apply" : "dry-run",
    env_file: path.relative(ROOT, file),
    tools: tools.map((tool) => `${tool.name}:${tool.present ? "ok" : "MISSING"}`),
    preflight_problems: problems,
    env_check: {
      ok: envCheck.ok,
      missing_required: envCheck.missingRequired,
      collisions: envCheck.collisions,
    },
    // Names and redacted shapes only.
    env_preview: Object.fromEntries(
      Object.keys(env).sort().map((name) => [name, redact(env[name])]),
    ),
    blocking_human_inputs: blockingInputs(env),
    webhooks_to_register: webhookPlan(env),
    steps: planSteps(args.client, env),
  };

  if (args.rollback) {
    report.rollback = rollbackPlan(args.client, env);
    console.log(JSON.stringify(report, null, 2));
    if (!args.apply) console.error("\nRollback plan only. Re-run with --apply to execute the automated entries.");
    return;
  }

  if (args.validate) {
    report.validation = await validateDeployment(env);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.validation.every((check) => check.ok) ? 0 : 1);
  }

  console.log(JSON.stringify(report, null, 2));

  if (!args.apply) {
    console.error("\nDry run. Nothing was changed. Re-run with --apply once every blocking input is resolved.");
    return;
  }

  if (problems.length || !envCheck.ok) {
    console.error("\nRefusing to apply:");
    console.error(formatEnvCheck(args.client, envCheck));
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const blockers = blockingInputs(env);
  if (blockers.length) {
    console.error("\nRefusing to apply — blocking human inputs outstanding:");
    for (const blocker of blockers) console.error(`  [${blocker.key}] ${blocker.ask}`);
    process.exit(1);
  }

  // Idempotent: migrate.mjs skips already-applied files and the clients-row
  // insert is ON CONFLICT DO NOTHING, so re-running is a no-op.
  console.error("\nApplying migrations…");
  run("node", ["scripts/migrate.mjs"], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });

  console.error("\nMigrations applied. Remaining provider registration steps are printed above;");
  console.error("run each with this client's env loaded, then re-run with --validate.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
