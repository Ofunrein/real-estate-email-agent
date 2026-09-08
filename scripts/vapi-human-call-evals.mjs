import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import { buildAriaAssistant } from "../lib/ariaAssistant.ts";
import { resolveClientConfig } from "../lib/clientConfig.ts";
import {
  DEFAULT_SEED,
  evaluateReplies,
  generateManifest,
  serializeManifest,
} from "./vapi-eval-scenarios.mjs";

const VAPI_BASE = "https://api.vapi.ai";

function value(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  return index < 0 ? fallback : argv[index + 1];
}

export function readEvalIdentity(environment = process.env) {
  const apiKey = String(environment.VAPI_EVAL_API_KEY || "").trim();
  const accountId = String(environment.VAPI_EVAL_ACCOUNT_ID || "").trim();
  if (!apiKey || !accountId) {
    throw new Error("chat eval requires dedicated VAPI_EVAL_API_KEY and VAPI_EVAL_ACCOUNT_ID; generic or production Vapi credentials are never loaded");
  }
  return { apiKey, accountId };
}

function within(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`timeout after ${milliseconds}ms`), { code: "CASE_TIMEOUT" })), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function extractReply(output) {
  return (Array.isArray(output) ? output : [])
    .flatMap((item) => {
      if (typeof item?.content === "string") return [item.content];
      if (Array.isArray(item?.content)) return item.content.map((part) => part?.text || "");
      return [];
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function runChat(testCase, cloneId, api) {
  let previousChatId = "";
  const replies = [];
  for (const input of testCase.turns) {
    const body = { assistantId: cloneId, input, stream: false, ...(previousChatId ? { previousChatId } : {}) };
    const chat = await api("/chat", { method: "POST", body: JSON.stringify(body) });
    previousChatId = chat.id || previousChatId;
    replies.push(extractReply(chat.output));
  }
  // Eval clone has no tools. Any completed-action claim therefore has no possible receipt and
  // evaluateReplies rejects it. If tool-backed evals are added, pass verified receipts explicitly.
  return evaluateReplies(testCase, replies, []);
}

function accountRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function assertEvalAccount(payload, expectedAccountId) {
  const records = accountRecords(payload);
  if (!records.length) throw new Error("Vapi eval account identity could not be verified before assistant creation");
  const ids = records.map((record) => record?.orgId || record?.organizationId || "");
  if (ids.some((id) => !id) || ids.some((id) => id !== expectedAccountId)) {
    throw new Error("Vapi credential account does not match VAPI_EVAL_ACCOUNT_ID");
  }
}

export async function runChatMode({ manifest, timeoutMs, api, accountId, clone }) {
  const results = [];
  let cloneId = "";

  assertEvalAccount(await api("/assistant"), accountId);
  try {
    const created = await api("/assistant", { method: "POST", body: JSON.stringify(clone) });
    cloneId = String(created?.id || "");
    const createdAccountId = created?.orgId || created?.organizationId || "";
    if (!cloneId || createdAccountId !== accountId) {
      throw new Error("created eval assistant identity does not match VAPI_EVAL_ACCOUNT_ID");
    }

    for (const testCase of manifest.cases) {
      if (testCase.evidence !== "vapi-chat") {
        results.push({ id: testCase.id, family: testCase.family, evidence: testCase.evidence, status: "skip", reason: testCase.skipUnless });
        continue;
      }
      const started = Date.now();
      try {
        const outcome = await within(runChat(testCase, cloneId, api), timeoutMs);
        results.push({ id: testCase.id, family: testCase.family, evidence: testCase.evidence, durationMs: Date.now() - started, ...outcome });
      } catch (error) {
        results.push({
          id: testCase.id,
          family: testCase.family,
          evidence: testCase.evidence,
          durationMs: Date.now() - started,
          status: error?.code === "CASE_TIMEOUT" ? "timeout" : "fail",
          errors: [String(error?.message || error)],
        });
      }
    }
  } finally {
    if (cloneId) {
      try {
        await api(`/assistant/${cloneId}`, { method: "DELETE" });
      } catch (error) {
        results.push({ id: "cleanup-clone", family: "harness", evidence: "control-plane", status: "fail", errors: [String(error?.message || error)] });
      }
    }
  }
  return results;
}

function createApi(fetchImpl, apiKey) {
  return async (route, init = {}) => {
    const response = await fetchImpl(`${VAPI_BASE}${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    if (!response.ok) throw new Error(`Vapi ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  };
}

function buildToollessClone(environment, accountId) {
  const config = resolveClientConfig(environment);
  const base = buildAriaAssistant(config, {
    publicUrl: environment.VAPI_EVAL_PUBLIC_BASE_URL || "https://eval.invalid",
    secret: "",
  });
  const clone = {
    ...base,
    name: `ZZZ eval clone ${accountId} delete me`,
    model: { ...base.model, tools: undefined, toolIds: undefined },
    server: undefined,
    serverUrl: undefined,
    analysisPlan: undefined,
    voice: undefined,
    transcriber: undefined,
  };
  for (const key of Object.keys(clone)) if (clone[key] === undefined) delete clone[key];
  for (const key of Object.keys(clone.model)) if (clone.model[key] === undefined) delete clone.model[key];
  return clone;
}

function countsFor(results) {
  return Object.fromEntries(["pass", "fail", "skip", "timeout"].map((status) => [status, results.filter((result) => result.status === status).length]));
}

export function resultExitCode(results) {
  const counts = countsFor(results);
  return counts.fail || counts.timeout || counts.pass === 0 ? 1 : 0;
}

function writeResults(outDir, seed, mode, manifest, results) {
  const counts = countsFor(results);
  const report = { schemaVersion: 2, seed, mode, manifestSha256: manifest.sha256, total: results.length, counts, results };
  fs.writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    "# Vapi human call evaluation",
    "",
    `Seed: \`${seed}\``,
    `Manifest: \`${manifest.sha256}\``,
    `Mode: \`${mode}\``,
    "",
    `PASS ${counts.pass} | FAIL ${counts.fail} | SKIP ${counts.skip} | TIMEOUT ${counts.timeout} | TOTAL ${results.length}`,
    "",
    "Text-only Vapi Chat results are not audio or telephony evidence. Phone mode is unimplemented and exits nonzero; it cannot produce an all-SKIP success report.",
    "",
    "| id | evidence | status | detail |",
    "|---|---|---|---|",
    ...results.map((result) => `| ${result.id} | ${result.evidence} | ${result.status.toUpperCase()} | ${(result.errors?.join("; ") || result.reason || "").replace(/\|/g, "\\|").slice(0, 180)} |`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "report.md"), markdown);
  return counts;
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const environment = runtime.env || process.env;
  const stdout = runtime.stdout || console.log;
  const stderr = runtime.stderr || console.error;
  const mode = value(argv, "--mode", "chat");
  const seed = Number(value(argv, "--seed", String(DEFAULT_SEED)));
  const timeoutMs = Number(value(argv, "--case-timeout-ms", "90000"));
  const outDir = path.resolve(value(argv, "--out-dir", "docs/proof/vapi-human-call-evals"));
  const manifestOnly = argv.includes("--manifest-only");
  const manifest = generateManifest(seed);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "manifest.json"), serializeManifest(manifest));
  if (manifestOnly) {
    stdout(JSON.stringify({ outDir, manifestSha256: manifest.sha256, caseCount: manifest.caseCount }, null, 2));
    return 0;
  }
  if (mode !== "chat") {
    stderr(`mode '${mode}' is not implemented; no phone calls were placed and no results report was written`);
    return 2;
  }

  let identity;
  try {
    identity = readEvalIdentity(environment);
  } catch (error) {
    stderr(String(error?.message || error));
    return 2;
  }

  if (runtime.configureNetwork !== false) {
    setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 }, headersTimeout: 90_000, bodyTimeout: 90_000 }));
  }
  const api = runtime.api || createApi(runtime.fetchImpl || fetch, identity.apiKey);
  let results;
  try {
    results = await runChatMode({
      manifest,
      timeoutMs,
      api,
      accountId: identity.accountId,
      clone: buildToollessClone(environment, identity.accountId),
    });
  } catch (error) {
    results = [{ id: "harness", family: "harness", evidence: "control-plane", status: "fail", errors: [String(error?.message || error)] }];
  }
  const counts = writeResults(outDir, seed, mode, manifest, results);
  stdout(JSON.stringify({ outDir, ...counts, total: results.length, manifestSha256: manifest.sha256 }, null, 2));
  return resultExitCode(results);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
