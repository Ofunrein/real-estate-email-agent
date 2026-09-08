import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Operator scripts stay plain ESM and are loaded through tsx by repository test commands.
// @ts-expect-error no declaration file for operator script
import { canonicalStringify, evaluateReplies, generateManifest, serializeManifest } from "../../scripts/vapi-eval-scenarios.mjs";
// @ts-expect-error no declaration file for operator script
import { assertEvalAccount, readEvalIdentity, resultExitCode, runChatMode } from "../../scripts/vapi-human-call-evals.mjs";

type Scenario = {
  id: string;
  family: string;
  evidence: string;
  turns: string[];
  assertions: { must?: RegExp[]; mustNot?: RegExp[] };
  combinedFrom?: string[];
  skipUnless?: string;
};

const repoRoot = path.resolve(import.meta.dirname, "../..");
const runnerPath = path.join(repoRoot, "scripts/vapi-human-call-evals.mjs");

test("human-call manifest is deterministic, complete, and hashes canonical regex data", () => {
  const a = generateManifest(42);
  const b = generateManifest(42);
  const c = generateManifest(43);
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, c.sha256);
  assert.equal(a.caseCount, a.cases.length);
  assert.ok(a.cases.length >= 60);
  assert.equal(new Set(a.cases.map((item: Scenario) => item.id)).size, a.cases.length);

  const { sha256, ...payload } = a;
  assert.equal(createHash("sha256").update(canonicalStringify(payload)).digest("hex"), sha256);
  assert.notEqual(canonicalStringify({ assertion: /private/i }), canonicalStringify({ assertion: /private/g }));
  const persisted = JSON.parse(serializeManifest(a));
  const asserted = persisted.cases.find((item: Scenario) => item.id === "relative-date-ambiguous");
  assert.deepEqual(asserted.assertions.must[0], { flags: "i", source: "friday|date|time|which" });
  assert.ok(persisted.globalAssertions.mustNot.every((item: { source?: string; flags?: string }) => typeof item.source === "string" && typeof item.flags === "string"));
});

test("combinatorial cases add real stress turns without mutating base cases", () => {
  const manifest = generateManifest(77);
  const combos = manifest.cases.filter((item: Scenario) => item.combinedFrom);
  assert.equal(combos.length, 12);
  for (const combo of combos as Scenario[]) {
    const base = manifest.cases.find((item: Scenario) => item.id === combo.combinedFrom?.[0]) as Scenario;
    assert.ok(base);
    assert.equal(combo.turns.length, base.turns.length + 1);
    assert.deepEqual(combo.turns.slice(0, -1), base.turns);
    assert.notEqual(combo.turns.at(-1), base.turns.at(-1));
    assert.match(combo.id, new RegExp(`${combo.combinedFrom?.[1]}$`));
  }
});

test("audio-dependent cases cannot be represented as chat passes", () => {
  const manifest = generateManifest();
  const audio = manifest.cases.filter((item: Scenario) => item.evidence === "real-audio-telephony");
  assert.ok(audio.length >= 16);
  for (const item of audio as Scenario[]) assert.match(item.skipUnless || "", /implemented phone runner|dedicated|allowlisted/i);
});

test("required risk families are present", () => {
  const families = new Set(generateManifest().cases.map((item: Scenario) => item.family));
  for (const family of ["identity", "privacy", "scheduling", "address", "emotion", "safety", "compliance", "security", "language", "accessibility", "stt", "reliability", "transfer", "context", "audio-speech", "audio-environment", "audio-turn-taking", "telephony", "telephony-latency", "telephony-reliability", "telephony-transfer"]) assert.ok(families.has(family), family);
});

test("reply oracle rejects blank output and inspects every turn for leaks", () => {
  const testCase = { assertions: { mustNot: [/private@example\.com/i] } };
  const blank = evaluateReplies(testCase, [""]);
  assert.equal(blank.status, "fail");
  assert.match(blank.errors.join(" "), /empty-reply/);

  const earlierLeak = evaluateReplies(testCase, ["Dana is private@example.com", "I cannot share private data."]);
  assert.equal(earlierLeak.status, "fail");
  assert.match(earlierLeak.errors.join(" "), /turn-1:forbidden/);

  const globalLeak = evaluateReplies({ assertions: {} }, ["Bearer abcdefghijklmnopqrst", "Safe final answer."]);
  assert.equal(globalLeak.status, "fail");
  assert.match(globalLeak.errors.join(" "), /turn-1:forbidden/);
});

test("reply oracle requires verified turn-specific receipts for completed-action claims", () => {
  const testCase = { assertions: {} };
  for (const [reply, action] of [
    ["Your showing is confirmed.", "scheduling"],
    ["You're now connected to the agent.", "transfer"],
    ["I have sent the email.", "message"],
  ]) {
    const rejected = evaluateReplies(testCase, [reply]);
    assert.equal(rejected.status, "fail");
    assert.match(rejected.errors.join(" "), new RegExp(`unverified-action:${action}`));
    assert.equal(evaluateReplies(testCase, [reply], [{ turn: 1, action, verified: true }]).status, "fail");
    const accepted = evaluateReplies(testCase, [reply], [{ turn: 1, action, verified: true, receiptId: "receipt-1" }]);
    assert.equal(accepted.status, "pass");
  }
});

test("generic Vapi credentials cannot satisfy dedicated eval identity", () => {
  assert.throws(() => readEvalIdentity({ VAPI_API_KEY: "production", VAPI_ASSISTANT_ID: "production" }), /VAPI_EVAL_API_KEY/);
  assert.deepEqual(readEvalIdentity({ VAPI_EVAL_API_KEY: "eval-key", VAPI_EVAL_ACCOUNT_ID: "eval-account" }), { apiKey: "eval-key", accountId: "eval-account" });
  assert.throws(() => assertEvalAccount([{ orgId: "wrong-account" }], "eval-account"), /does not match/);
  assert.doesNotThrow(() => assertEvalAccount([{ orgId: "eval-account" }], "eval-account"));
});

test("clone cleanup failure is a failing harness result", async () => {
  const calls: string[] = [];
  const api = async (route: string, init: { method?: string } = {}) => {
    calls.push(`${init.method || "GET"} ${route}`);
    if (route === "/assistant" && !init.method) return [{ orgId: "eval-account" }];
    if (route === "/assistant" && init.method === "POST") return { id: "clone-1", orgId: "eval-account" };
    if (route === "/chat") return { id: "chat-1", output: [{ content: "I can help with that." }] };
    if (route === "/assistant/clone-1" && init.method === "DELETE") throw new Error("cleanup denied");
    throw new Error(`unexpected ${route}`);
  };
  const results = await runChatMode({
    manifest: { cases: [{ id: "one", family: "test", evidence: "vapi-chat", turns: ["hello"], assertions: {} }] },
    timeoutMs: 1_000,
    api,
    accountId: "eval-account",
    clone: { name: "test" },
  });
  assert.equal(results[0].status, "pass");
  assert.equal(results.at(-1).id, "cleanup-clone");
  assert.equal(results.at(-1).status, "fail");
  assert.equal(resultExitCode(results), 1);
  assert.ok(calls.includes("DELETE /assistant/clone-1"));
});

test("manifest-only writes only manifest and preserves executed evidence", () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "vapi-manifest-only-"));
  try {
    writeFileSync(path.join(outDir, "results.json"), "executed-results\n");
    writeFileSync(path.join(outDir, "report.md"), "executed-report\n");
    const run = spawnSync(process.execPath, ["--import", "tsx", runnerPath, "--manifest-only", "--out-dir", outDir], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(outDir, "results.json"), "utf8"), "executed-results\n");
    assert.equal(readFileSync(path.join(outDir, "report.md"), "utf8"), "executed-report\n");
    assert.equal(JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf8")).caseCount, 60);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("unimplemented phone mode fails closed without all-skip success artifacts", () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "vapi-phone-mode-"));
  try {
    const run = spawnSync(process.execPath, ["--import", "tsx", runnerPath, "--mode", "phone", "--out-dir", outDir], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stderr, /not implemented|no phone calls/i);
    assert.throws(() => readFileSync(path.join(outDir, "results.json"), "utf8"));
    assert.throws(() => readFileSync(path.join(outDir, "report.md"), "utf8"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
