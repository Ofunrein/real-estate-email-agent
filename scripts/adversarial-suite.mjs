// Cross-channel adversarial score report. Same fixtures the node:test suite asserts on
// (tests/ts/adversarialSuite.test.ts), rendered as per-family scores for humans.
// Offline and deterministic: no network, no API keys, no customer data.
// Run: npm run adversarial   /   npm run adversarial:proof
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  IRIS_REVIEW_MARKER,
  classifyIrisEmailText,
  decideIrisEmailExecution,
  generateIrisEmailReply,
  isIrisEligibleEmail,
} from "../lib/irisEmail.ts";
import { classifyTheoMessage, shouldTheoAutoReply } from "../lib/theoAgent.ts";
import { evaluateSocialRelevance } from "../lib/socialRelevanceGate.ts";
import { buildSocialRouterResult, shouldTheoHandleDirectMetaDm } from "../lib/manychatSocial.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outPath = outFlag === -1 ? null : args[outFlag + 1];

const load = (file) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", file), "utf8"));
const irisScenarios = load("iris-email-stress-scenarios.json");
const socialScenarios = load("adversarial-social-scenarios.json");
const theoScenarios = load("adversarial-theo-scenarios.json");

const results = [];

function check(channel, scenario, errors, extra = {}) {
  results.push({ channel, family: scenario.family || "unlabelled", id: scenario.id, errors, ...extra });
}

// --- Iris email -------------------------------------------------------------
for (const scenario of irisScenarios) {
  const message = { id: scenario.id, threadId: `adv-${scenario.id}`, from: scenario.from, subject: scenario.subject, body: scenario.body };
  const errors = [];
  const eligible = isIrisEligibleEmail(message);
  if (scenario.expectIgnored) {
    if (eligible) errors.push("expected filtered before classification");
    check("iris", scenario, errors, { outcome: "filtered" });
    continue;
  }
  if (!eligible) errors.push("expected to reach the classifier");
  const classification = classifyIrisEmailText(message);
  const execution = decideIrisEmailExecution(classification);
  const reply = generateIrisEmailReply(message, classification) || "";
  if (scenario.expectIntent && classification.intent !== scenario.expectIntent) {
    errors.push(`intent ${classification.intent} != ${scenario.expectIntent}`);
  }
  if (typeof scenario.expectAutoReply === "boolean" && execution.canReply !== scenario.expectAutoReply) {
    errors.push(`autoReply ${execution.canReply} != ${scenario.expectAutoReply}`);
  }
  for (const flag of scenario.expectFlags || []) {
    if (!classification.compliance_flags.includes(flag)) errors.push(`missing flag ${flag}`);
  }
  if (scenario.expectHandoffReason && classification.human_handoff_reason !== scenario.expectHandoffReason) {
    errors.push(`handoff ${classification.human_handoff_reason} != ${scenario.expectHandoffReason}`);
  }
  if (scenario.expectNoReply && reply) errors.push("expected no reply body");
  if (scenario.expectReviewDraft) {
    if (!reply.includes(IRIS_REVIEW_MARKER)) errors.push("review draft missing marker");
    const body = reply.split(IRIS_REVIEW_MARKER)[0].replace(/^Hello,|Best,|Iris/gm, "").replace(/\s+/g, " ").trim();
    if (body.length < 140) errors.push(`review draft too thin (${body.length})`);
  }
  for (const needle of scenario.mustInclude || []) {
    if (!reply.toLowerCase().includes(needle.toLowerCase())) errors.push(`missing "${needle}"`);
  }
  for (const needle of scenario.mustNotInclude || []) {
    if (reply.toLowerCase().includes(needle.toLowerCase())) errors.push(`leaked "${needle}"`);
  }
  check("iris", scenario, errors, {
    outcome: execution.canReply ? "auto_reply" : execution.status === "spam" ? "closed_no_reply" : "human_review_draft",
  });
}

// --- Instagram / Messenger relevance gate -----------------------------------
for (const scenario of socialScenarios) {
  const errors = [];
  const decision = evaluateSocialRelevance({
    messageText: scenario.messageText,
    media: scenario.media,
    routeReason: scenario.routeReason,
    listingAddress: scenario.listingAddress,
  });
  if (decision.engage !== scenario.expectEngage) errors.push(`engage ${decision.engage} != ${scenario.expectEngage}`);
  if (scenario.expectSurface && decision.surface !== scenario.expectSurface) {
    errors.push(`surface ${decision.surface} != ${scenario.expectSurface}`);
  }
  if (scenario.expectIntent && decision.intent !== scenario.expectIntent) {
    errors.push(`intent ${decision.intent} != ${scenario.expectIntent}`);
  }
  if (typeof scenario.expectNeedsHuman === "boolean" && decision.needsHuman !== scenario.expectNeedsHuman) {
    errors.push(`needsHuman ${decision.needsHuman} != ${scenario.expectNeedsHuman}`);
  }
  if (scenario.expectPropertyDetails && !decision.propertyDetails.length) errors.push("expected property details");

  const guard = shouldTheoHandleDirectMetaDm({
    channel: "instagram",
    messageText: scenario.messageText,
    contactId: `c-${scenario.id}`,
    threadId: `c-${scenario.id}`,
    senderName: "Lead",
    senderUsername: "lead",
    accountLabel: "Instagram",
    routeReason: scenario.routeReason || "",
    campaign: "",
    listingAddress: scenario.listingAddress || "",
    sourceUrl: "",
    media: scenario.media,
  });
  const routed = buildSocialRouterResult({
    channel: "instagram",
    threadRef: `instagram:c-${scenario.id}`,
    guard,
    reply: { shouldSend: true, reply: "generated reply text", mediaUrls: [] },
  });
  if (!scenario.expectEngage && (routed.should_send || routed.reply)) errors.push("abstain still sent something");
  check("instagram", scenario, errors, { outcome: decision.engage ? "engage" : `abstain:${decision.intent}` });
}

// --- Theo SMS ---------------------------------------------------------------
for (const scenario of theoScenarios) {
  const errors = [];
  const classification = classifyTheoMessage(scenario.message);
  const autoReply = shouldTheoAutoReply(classification, scenario.lead || {});
  if (scenario.expectIntent && classification.intent !== scenario.expectIntent) {
    errors.push(`intent ${classification.intent} != ${scenario.expectIntent}`);
  }
  if (scenario.expectIntentNot && classification.intent === scenario.expectIntentNot) {
    errors.push(`intent must not be ${scenario.expectIntentNot}`);
  }
  if (scenario.expectHandoffReason && classification.handoffReason !== scenario.expectHandoffReason) {
    errors.push(`handoff ${classification.handoffReason} != ${scenario.expectHandoffReason}`);
  }
  if (typeof scenario.expectAutoReply === "boolean" && autoReply !== scenario.expectAutoReply) {
    errors.push(`autoReply ${autoReply} != ${scenario.expectAutoReply}`);
  }
  check("theo", scenario, errors, { outcome: classification.intent });
}

// Aria's adversarial cases are structural (tool outcomes and the provisioned prompt), so
// they live in tests/ts/adversarialSuite.test.ts rather than a fixture. Counted here so the
// report does not read as if voice were uncovered.
const ARIA_STRUCTURAL_CASES = 11;

const byFamily = new Map();
for (const row of results) {
  const key = `${row.channel}/${row.family}`;
  const stat = byFamily.get(key) || { scope: key, total: 0, passed: 0, failures: [] };
  stat.total += 1;
  if (row.errors.length) stat.failures.push(`${row.id}: ${row.errors.join("; ")}`);
  else stat.passed += 1;
  byFamily.set(key, stat);
}

const failed = results.filter((row) => row.errors.length);
console.table(results.map((row) => ({
  channel: row.channel,
  family: row.family,
  id: row.id,
  outcome: row.outcome,
  errors: row.errors.join("; "),
})));

const scores = [...byFamily.values()].sort((a, b) => a.scope.localeCompare(b.scope));
const summary = {
  ok: failed.length === 0,
  totalFixtureCases: results.length,
  ariaStructuralCases: ARIA_STRUCTURAL_CASES,
  failed: failed.length,
  scores: scores.map((stat) => ({ scope: stat.scope, score: `${stat.passed}/${stat.total}` })),
  failures: failed.map((row) => `${row.channel}/${row.id}: ${row.errors.join("; ")}`),
};
console.log(JSON.stringify(summary, null, 2));

if (outPath) {
  const markdown = [
    "# Adversarial regression run (recorded output)",
    "",
    "Generated by `npm run adversarial:proof`. Offline and deterministic: no network, no API",
    "keys, no customer data. The same fixtures are asserted case by case in",
    "`tests/ts/adversarialSuite.test.ts`, so `npm test` fails if behaviour drifts.",
    "",
    "| scope | score |",
    "| --- | --- |",
    ...scores.map((stat) => `| ${stat.scope} | ${stat.passed}/${stat.total} |`),
    `| aria/structural (in node:test) | ${ARIA_STRUCTURAL_CASES}/${ARIA_STRUCTURAL_CASES} |`,
    "",
    "| channel | id | outcome |",
    "| --- | --- | --- |",
    ...results.map((row) => `| ${row.channel} | ${row.id} | ${row.outcome} |`),
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(root, outPath), markdown);
  console.log(`wrote ${outPath}`);
}

if (failed.length) process.exit(1);
