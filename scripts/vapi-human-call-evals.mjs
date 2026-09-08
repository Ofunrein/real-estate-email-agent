import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Agent, setGlobalDispatcher } from "undici";
import { buildAriaAssistant } from "../lib/ariaAssistant.ts";
import { resolveClientConfig } from "../lib/clientConfig.ts";
import { DEFAULT_SEED, generateManifest } from "./vapi-eval-scenarios.mjs";

setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 }, headersTimeout: 90_000, bodyTimeout: 90_000 }));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const value = (flag, fallback) => { const i = argv.indexOf(flag); return i < 0 ? fallback : argv[i + 1]; };
const mode = value("--mode", "chat");
const seed = Number(value("--seed", String(DEFAULT_SEED)));
const timeoutMs = Number(value("--case-timeout-ms", "90000"));
const outDir = path.resolve(value("--out-dir", "docs/proof/vapi-human-call-evals"));
const manifestOnly = argv.includes("--manifest-only");
const manifest = generateManifest(seed);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

function env(name) {
  if (process.env[name]) return process.env[name];
  for (const p of ["/Users/martinofunrein/Downloads/atlas/claude-md-push/.env", new URL("../.env", import.meta.url).pathname]) {
    try { for (const line of fs.readFileSync(p, "utf8").split("\n")) { const m = line.match(/^([^#=]+)=(.*)$/); if (m?.[1].trim() === name && m[2].trim()) return m[2].trim().replace(/^["']|["']$/g, ""); } } catch {}
  }
  return "";
}
const normalize = (s) => String(s || "").replace(/[’‘]/g, "'").replace(/[–—]/g, "-");
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`timeout after ${ms}ms`), { code: "CASE_TIMEOUT" })), ms))]);
let cloneId = "";
async function api(route, init = {}) {
  const key = env("VAPI_API_KEY");
  if (!key) throw new Error("VAPI_API_KEY unavailable");
  const response = await fetch(`https://api.vapi.ai${route}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`Vapi ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}
async function runChat(testCase) {
  let previousChatId = "", reply = "";
  for (const input of testCase.turns) {
    const body = { assistantId: cloneId, input, stream: false, ...(previousChatId ? { previousChatId } : {}) };
    const chat = await api("/chat", { method: "POST", body: JSON.stringify(body) });
    previousChatId = chat.id || previousChatId;
    reply = (Array.isArray(chat.output) ? chat.output : []).flatMap((x) => typeof x?.content === "string" ? [x.content] : Array.isArray(x?.content) ? x.content.map((p) => p?.text || "") : []).filter(Boolean).join(" ").trim();
  }
  const text = normalize(reply), errors = [];
  for (const rx of testCase.assertions.mustNot || []) if (rx.test(text)) errors.push(`forbidden:${rx}`);
  for (const rx of testCase.assertions.must || []) if (!rx.test(text)) errors.push(`missing:${rx}`);
  return { status: errors.length ? "fail" : "pass", errors, reply };
}

const results = [];
if (!manifestOnly && mode === "chat") {
  const config = resolveClientConfig(process.env);
  const base = buildAriaAssistant(config, { publicUrl: env("PUBLIC_BASE_URL") || "https://app.lumenosis.com", secret: env("CHANNEL_WEBHOOK_SECRET") || "" });
  const clone = { ...base, name: "ZZZ human-call eval clone delete me", model: { ...base.model, tools: undefined, toolIds: undefined }, server: undefined, serverUrl: undefined, analysisPlan: undefined, voice: undefined, transcriber: undefined };
  for (const k of Object.keys(clone)) if (clone[k] === undefined) delete clone[k];
  for (const k of Object.keys(clone.model)) if (clone.model[k] === undefined) delete clone.model[k];
  try {
    cloneId = (await api("/assistant", { method: "POST", body: JSON.stringify(clone) })).id;
    for (const c of manifest.cases) {
      if (c.evidence !== "vapi-chat") { results.push({ id: c.id, family: c.family, evidence: c.evidence, status: "skip", reason: c.skipUnless }); continue; }
      const started = Date.now();
      try {
        const outcome = await within(runChat(c), timeoutMs);
        results.push({ id: c.id, family: c.family, evidence: c.evidence, durationMs: Date.now() - started, ...outcome });
      }
      catch (error) { results.push({ id: c.id, family: c.family, evidence: c.evidence, durationMs: Date.now() - started, status: error.code === "CASE_TIMEOUT" ? "timeout" : "fail", errors: [String(error.message || error)] }); }
    }
  } finally { if (cloneId) await api(`/assistant/${cloneId}`, { method: "DELETE" }).catch((e) => results.push({ id: "cleanup-clone", family: "harness", evidence: "control-plane", status: "fail", errors: [e.message] })); }
} else {
  for (const c of manifest.cases) results.push({ id: c.id, family: c.family, evidence: c.evidence, status: "skip", reason: manifestOnly ? "manifest-only run" : "real phone runner requires dedicated allowlisted identity and is not configured" });
}
const counts = Object.fromEntries(["pass", "fail", "skip", "timeout"].map((s) => [s, results.filter((r) => r.status === s).length]));
const report = { schemaVersion: 1, seed, mode, manifestSha256: manifest.sha256, total: results.length, counts, results };
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(report, null, 2) + "\n");
const md = ["# Vapi human call evaluation", "", `Seed: \`${seed}\``, `Manifest: \`${manifest.sha256}\``, `Mode: \`${mode}\``, "", `PASS ${counts.pass} | FAIL ${counts.fail} | SKIP ${counts.skip} | TIMEOUT ${counts.timeout} | TOTAL ${results.length}`, "", "Text-only Vapi Chat results are not audio or telephony evidence. Accent, noise, volume, crosstalk, barge-in, silence, voicemail, hangup, reconnection, DTMF, and end-to-end phone latency remain SKIP unless a real allowlisted audio/phone run records evidence.", "", "| id | evidence | status | detail |", "|---|---|---|---|", ...results.map((r) => `| ${r.id} | ${r.evidence} | ${r.status.toUpperCase()} | ${(r.errors?.join("; ") || r.reason || "").replace(/\|/g, "\\|").slice(0, 180)} |`), ""].join("\n");
fs.writeFileSync(path.join(outDir, "report.md"), md);
console.log(JSON.stringify({ outDir, ...counts, total: results.length, manifestSha256: manifest.sha256 }, null, 2));
process.exit(counts.fail || counts.timeout ? 1 : 0);
