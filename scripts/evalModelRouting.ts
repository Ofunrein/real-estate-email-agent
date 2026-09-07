#!/usr/bin/env node --import tsx
/**
 * Offline-first eval harness for docs/audits/2026-09-model-routing/.
 *
 * IMPORTANT, honest scope note: `--offline` (the default and the only mode run by this audit)
 * exercises `resolveModelRoute()` — the deterministic, provider-free routing/safety-gate logic —
 * against the full synthetic corpus. It does NOT invoke any real model. That means this harness
 * CAN fully measure: compliance/sensitive recall, adversarial bypass count, determinism, and
 * latency-budget routing logic — all of which are properties of the router itself. It CANNOT
 * measure classification macro-F1, reply-rubric pass rate, real latency, or real cost, because
 * those require an actual model response, which requires a live provider call. Per the audit's own
 * Step 9.9 rule ("skipping is acceptable, guessing is not"), those cells are reported as
 * "not_measured_offline" rather than fabricated. A `--live` mode exists as a stub entrypoint for a
 * human to wire up under Step 9.9's bounded conditions (non-prod key, <=$2, <=40 calls, opt-in env
 * flag) — it is NOT invoked by this audit.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveModelRoute, type RouteInput, type TaskClass, type Channel } from "../lib/modelRouting";

const CORPUS_DIR = path.resolve(__dirname, "..", "evals", "model-routing", "corpus");
const RESULTS_ROOT = path.resolve(__dirname, "..", "evals", "model-routing", "results");

type CorpusRecord = {
  id: string;
  task: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
  expected: Record<string, unknown>;
  rubric_id: string;
  severity: string;
};

const TASK_TO_TASKCLASS: Record<string, TaskClass> = {
  "email-classification": "email-classification",
  "email-reply": "email-reply",
  "sms-reply": "sms-reply",
  "voice-turn": "voice-turn",
  "sensitive-routing": "email-classification", // sensitive text can arrive on any classification-shaped channel
  adversarial: "email-classification",
};

function textOf(record: CorpusRecord): string {
  const input = record.input as Record<string, unknown>;
  return String(input.body ?? input.transcript ?? "");
}

function channelOf(record: CorpusRecord): Channel {
  const ctx = (record.context ?? {}) as Record<string, unknown>;
  const c = String(ctx.channel ?? "email");
  return (["email", "sms", "rcs", "whatsapp", "voice", "web", "website", "website_chat"].includes(c) ? c : "email") as Channel;
}

function loadCorpus(file: string): CorpusRecord[] {
  return fs
    .readFileSync(path.join(CORPUS_DIR, file), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusRecord);
}

type PerCaseResult = {
  id: string;
  task: string;
  clientProfile: string;
  tier: string;
  modelId: string | null;
  humanReview: boolean;
  expectedHumanReview: boolean | undefined;
  routingReasonHash: string;
  pass: boolean | "not_measured_offline";
  gate: string;
};

function evaluateSafetyCorpus(records: CorpusRecord[], task: string, clientProfile: RouteInput["clientProfile"]): PerCaseResult[] {
  return records.map((record) => {
    const input: RouteInput = {
      taskClass: TASK_TO_TASKCLASS[task],
      channel: channelOf(record),
      text: textOf(record),
      clientProfile,
    };
    const route = resolveModelRoute(input);
    const expectedHumanReview = record.expected.human_review as boolean | undefined;
    const pass = expectedHumanReview === undefined ? "not_measured_offline" : route.humanReview === expectedHumanReview;
    return {
      id: record.id,
      task,
      clientProfile,
      tier: route.tier,
      modelId: route.modelId,
      humanReview: route.humanReview,
      expectedHumanReview,
      routingReasonHash: createHash("sha256").update(route.routingReason).digest("hex").slice(0, 12),
      pass,
      gate: task === "sensitive-routing" ? "compliance_recall" : task === "adversarial" ? "adversarial_bypass" : "routing_only",
    };
  });
}

function main() {
  const offline = !process.argv.includes("--live");
  if (!offline) {
    console.error("Live mode is not implemented by this audit (Step 9.9 bounded conditions were not exercised). Exiting.");
    process.exit(2);
  }

  const timestamp = process.env.EVAL_TIMESTAMP_OVERRIDE || new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(RESULTS_ROOT, timestamp);
  fs.mkdirSync(outDir, { recursive: true });

  const perCase: PerCaseResult[] = [];
  const sensitive = loadCorpus("sensitive-routing.jsonl");
  const adversarial = loadCorpus("adversarial.jsonl");
  const classification = loadCorpus("email-classification.jsonl");
  const voice = loadCorpus("voice-turn.jsonl");

  for (const profile of ["legacy", "candidate"] as const) {
    perCase.push(...evaluateSafetyCorpus(sensitive, "sensitive-routing", profile));
    perCase.push(...evaluateSafetyCorpus(adversarial, "adversarial", profile));
    perCase.push(...evaluateSafetyCorpus(classification, "email-classification", profile));
  }

  // Voice latency-budget routing check (routing-only, not real latency)
  for (const record of voice) {
    const ctx = (record.context ?? {}) as Record<string, unknown>;
    const route = resolveModelRoute({
      taskClass: "voice-turn",
      channel: "voice",
      text: textOf(record),
      clientProfile: "candidate",
      latencyBudgetMs: Number(ctx.latency_budget_ms ?? 3500),
    });
    perCase.push({
      id: record.id,
      task: "voice-turn",
      clientProfile: "candidate",
      tier: route.tier,
      modelId: route.modelId,
      humanReview: route.humanReview,
      expectedHumanReview: false,
      routingReasonHash: createHash("sha256").update(route.routingReason).digest("hex").slice(0, 12),
      pass: route.tier === "routine_low",
      gate: "voice_latency_tier",
    });
  }

  fs.writeFileSync(path.join(outDir, "per-case.jsonl"), perCase.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  function gateStats(gate: string, profile?: string) {
    const rows = perCase.filter((r) => r.gate === gate && (profile ? r.clientProfile === profile : true) && r.pass !== "not_measured_offline");
    const total = rows.length;
    const passed = rows.filter((r) => r.pass === true).length;
    return { total, passed, rate: total === 0 ? null : passed / total };
  }

  const summary = {
    generated_at: timestamp,
    mode: "offline",
    scope_note:
      "Offline mode measures router safety-gate behavior only. classification_macro_f1 and " +
      "reply_quality_rubric_pass_rate are NOT measured here (require a live model call, not run " +
      "in this session) and are reported as not_measured_offline in the decision doc.",
    gates: {
      compliance_recall_legacy: gateStats("compliance_recall", "legacy"),
      compliance_recall_candidate: gateStats("compliance_recall", "candidate"),
      adversarial_bypass_legacy: gateStats("adversarial_bypass", "legacy"),
      adversarial_bypass_candidate: gateStats("adversarial_bypass", "candidate"),
      voice_latency_tier_candidate: gateStats("voice_latency_tier"),
    },
    total_cases: perCase.length,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const md = [
    `# Model Routing Eval Summary (offline) — ${timestamp}`,
    "",
    summary.scope_note,
    "",
    "| Gate | Profile | Total | Passed | Rate |",
    "|------|---------|-------|--------|------|",
    ...Object.entries(summary.gates).map(([key, stats]) => {
      const [gate, profile] = key.split(/_(legacy|candidate)$/).filter(Boolean);
      return `| ${gate} | ${profile ?? "candidate"} | ${stats.total} | ${stats.passed} | ${stats.rate === null ? "n/a" : stats.rate.toFixed(4)} |`;
    }),
    "",
    `Total corpus cases exercised: ${summary.total_cases}`,
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "summary.md"), md, "utf8");

  console.log(`Wrote results to ${outDir}`);
  console.log(md);

  // Exit non-zero if any measured gate failed (compliance recall < 1.00 or adversarial bypass > 0).
  const compliancePass = (summary.gates.compliance_recall_candidate.rate ?? 1) === 1;
  const adversarialPass = (summary.gates.adversarial_bypass_candidate.rate ?? 1) === 1;
  if (!compliancePass || !adversarialPass) {
    console.error("FROZEN THRESHOLD VIOLATION: compliance recall or adversarial gate failed.");
    process.exit(1);
  }
}

main();
