import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHtmlEmailReply,
  classifyIrisEmailText,
  decideIrisEmailExecution,
  generateIrisEmailReply,
  isIrisEligibleEmail,
} from "../lib/irisEmail.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenarioPath = process.argv[2] || path.join(root, "tests/fixtures/iris-email-stress-scenarios.json");
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

for (const scenario of scenarios) {
  const message = emailForScenario(scenario);
  const eligible = isIrisEligibleEmail(message);
  const errors = [];

  if (scenario.expectIgnored) {
    if (eligible) errors.push("expected ignored, but message was eligible");
    rows.push({ id: scenario.id, eligible, intent: "ignored", autoReply: false, errors });
    if (errors.length) failed += 1;
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
  assertTextIncludes(errors, "reply", output, scenario.mustInclude || []);
  assertTextExcludes(errors, "reply", output, scenario.mustNotInclude || []);

  rows.push({
    id: scenario.id,
    eligible,
    intent: classification.intent,
    action: classification.recommended_next_action,
    autoReply: execution.canReply,
    labels: execution.labels.join(","),
    errors,
  });
  if (errors.length) failed += 1;
}

console.table(rows.map((row) => ({
  id: row.id,
  eligible: row.eligible,
  intent: row.intent,
  action: row.action || "",
  autoReply: row.autoReply,
  labels: row.labels || "",
  errors: row.errors.join("; "),
})));

const summary = { ok: failed === 0, total: scenarios.length, failed };
console.log(JSON.stringify(summary, null, 2));
if (failed) process.exit(1);
