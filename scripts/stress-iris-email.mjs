import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHtmlEmailReply,
  classifyIrisEmailText,
  decideIrisEmailExecution,
  generateIrisEmailReply,
  isIrisEligibleEmail,
  IRIS_REVIEW_MARKER,
} from "../lib/irisEmail.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outPath = outFlag === -1 ? null : args[outFlag + 1];
const positional = args.filter((arg, index) => index !== outFlag && index !== outFlag + 1);
const scenarioPath = positional[0] || path.join(root, "tests/fixtures/iris-email-stress-scenarios.json");
const scenarios = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));

function emailForScenario(scenario) {
  return {
    id: scenario.id,
    threadId: `stress-${scenario.id}`,
    from: scenario.from,
    subject: scenario.subject,
    body: scenario.body,
  };
}

function assertTextIncludes(errors, label, text, values = []) {
  for (const value of values) {
    if (!text.toLowerCase().includes(String(value).toLowerCase())) {
      errors.push(`${label} missing "${value}"`);
    }
  }
}

function assertTextExcludes(errors, label, text, values = []) {
  for (const value of values) {
    if (text.toLowerCase().includes(String(value).toLowerCase())) {
      errors.push(`${label} unexpectedly included "${value}"`);
    }
  }
}

const rows = [];
let failed = 0;
const familyStats = new Map();

function recordFamily(family, ok) {
  const key = family || "unlabelled";
  const stat = familyStats.get(key) || { family: key, total: 0, passed: 0 };
  stat.total += 1;
  if (ok) stat.passed += 1;
  familyStats.set(key, stat);
}

for (const scenario of scenarios) {
  const message = emailForScenario(scenario);
  const eligible = isIrisEligibleEmail(message);
  const errors = [];

  if (scenario.expectIgnored) {
    if (eligible) errors.push("expected ignored, but message was eligible");
    rows.push({ id: scenario.id, family: scenario.family, eligible, intent: "ignored", autoReply: false, errors });
    if (errors.length) failed += 1;
    recordFamily(scenario.family, errors.length === 0);
    continue;
  }

  if (!eligible) errors.push("expected eligible, but message was ignored");
  const classification = classifyIrisEmailText(message);
  const execution = decideIrisEmailExecution(classification);
  const plain = generateIrisEmailReply(message, classification) || "";
  const htmlReply = buildHtmlEmailReply(plain, [], classification);
  const output = `${plain}\n${htmlReply.text || ""}\n${htmlReply.html || ""}`;

  if (scenario.expectIntent && classification.intent !== scenario.expectIntent) {
    errors.push(`intent ${classification.intent}, expected ${scenario.expectIntent}`);
  }
  if (typeof scenario.expectAutoReply === "boolean" && execution.canReply !== scenario.expectAutoReply) {
    errors.push(`autoReply ${execution.canReply}, expected ${scenario.expectAutoReply}`);
  }
  for (const flag of scenario.expectFlags || []) {
    if (!classification.compliance_flags.includes(flag)) {
      errors.push(`missing compliance flag "${flag}" (got ${classification.compliance_flags.join(",") || "none"})`);
    }
  }
  if (scenario.expectHandoffReason && classification.human_handoff_reason !== scenario.expectHandoffReason) {
    errors.push(`handoffReason ${classification.human_handoff_reason}, expected ${scenario.expectHandoffReason}`);
  }
  if (scenario.expectNoReply && plain) {
    errors.push("expected no reply body, but one was generated");
  }
  if (scenario.expectReviewDraft) {
    // A review draft must be a real, send-ready email: substantive body plus exactly one
    // marked line for the human. A draft whose only content is "the team will review" is a
    // failure, not a safe default.
    if (!plain) errors.push("expected a review draft, got none");
    if (plain && !plain.includes(IRIS_REVIEW_MARKER)) errors.push("review draft is missing the review marker");
    const body = plain.split(IRIS_REVIEW_MARKER)[0] || "";
    const substance = body
      .replace(/^Hello,|Best,|Iris/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (substance.length < 140) errors.push(`review draft body too thin (${substance.length} chars of substance)`);
    if (/^\W*thanks for the question[\s\S]{0,80}flagged this for the team/i.test(substance)) {
      errors.push("review draft is a bare handoff notice");
    }
  }
  assertTextIncludes(errors, "reply", output, scenario.mustInclude || []);
  assertTextExcludes(errors, "reply", output, scenario.mustNotInclude || []);

  rows.push({
    id: scenario.id,
    family: scenario.family,
    eligible,
    intent: classification.intent,
    action: classification.recommended_next_action,
    autoReply: execution.canReply,
    labels: execution.labels.join(","),
    errors,
  });
  if (errors.length) failed += 1;
  recordFamily(scenario.family, errors.length === 0);
}

console.table(rows.map((row) => ({
  id: row.id,
  family: row.family || "",
  eligible: row.eligible,
  intent: row.intent,
  action: row.action || "",
  autoReply: row.autoReply,
  labels: row.labels || "",
  errors: row.errors.join("; "),
})));

const autonomous = rows.filter((row) => row.autoReply).length;
const escalated = rows.filter((row) => !row.autoReply && row.intent !== "ignored").length;
// Half this corpus is deliberately unsafe input, so a raw auto-reply rate says nothing.
// The number that matters is how much ORDINARY lead mail Iris answers without a human.
// trick_question and listing_hallucination are counted separately: they are ordinary-looking
// mail that legitimately contains compliance triggers, so their escalations are correct.
const ORDINARY = new Set(["baseline", "confusion", "low_confidence", "missing_property_context"]);
const PROBING = new Set(["trick_question", "listing_hallucination"]);
const ordinary = rows.filter((row) => ORDINARY.has(row.family) && row.intent !== "ignored");
const probing = rows.filter((row) => PROBING.has(row.family) && row.intent !== "ignored");
const rate = (subset) => subset.length
  ? `${subset.filter((row) => row.autoReply).length}/${subset.length} (${Math.round((subset.filter((row) => row.autoReply).length / subset.length) * 100)}%)`
  : "n/a";
const summary = {
  ok: failed === 0,
  total: scenarios.length,
  failed,
  autonomous,
  escalated,
  ordinaryAutonomyRate: rate(ordinary),
  probingAutonomyRate: rate(probing),
  families: [...familyStats.values()]
    .sort((a, b) => a.family.localeCompare(b.family))
    .map((stat) => ({ ...stat, score: `${stat.passed}/${stat.total}` })),
};
console.log(JSON.stringify(summary, null, 2));

if (outPath) {
  // Deliberately timestamp-free so the committed artifact is byte-stable and CI
  // can fail when it drifts from the current classifier behavior.
  const header = ["id", "family", "eligible", "intent", "action", "autoReply", "labels", "errors"];
  const cells = rows.map((row) => [
    row.id,
    row.family || "",
    String(row.eligible),
    row.intent,
    row.action || "",
    String(row.autoReply),
    row.labels || "",
    row.errors.join("; ") || "-",
  ]);
  const markdown = [
    "# Iris email scenario run (recorded output)",
    "",
    `Generated by \`npm run proof\` from \`${path.relative(root, scenarioPath)}\`.`,
    "Offline and deterministic: no network, no API keys, no customer data.",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...cells.map((cell) => `| ${cell.join(" | ")} |`),
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown);
  console.log(`wrote ${outPath}`);
}

if (failed) process.exit(1);
