// AI-as-judge evaluation of how Iris/Theo text replies READ in Apple Messages.
//
// Each corpus case is run through the REAL reply path (lib/theoAgent -> generateTheoReply,
// the same entry point lib/irisTextAgent and the theo-sms webhook use), then the deterministic
// Messages checks in lib/smsFormatting run, then the (inbound, reply, criteria) triple goes to
// an INDEPENDENT judge on the Anthropic API. The judge does not see the deterministic result,
// so it cannot be anchored by it.
//
// Threshold: mean >= 4.0 across all criteria AND no single criterion below 3.
//
// Run:
//   node --import tsx scripts/imessage-reply-evals.mjs
//   node --import tsx scripts/imessage-reply-evals.mjs --out docs/proof/imessage-reply-evals.json
//   node --import tsx scripts/imessage-reply-evals.mjs --offline   (deterministic checks only)
//   node --import tsx scripts/imessage-reply-evals.mjs --case single_property_details
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateTheoReply } from "../lib/theoAgent.ts";
import { checkMessagesFormatting } from "../lib/smsFormatting.ts";
import { appendLeadProfileCaptureAsk, decideLeadProfileCapture } from "../lib/leadProfileCapture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const outPath = flag("--out");
const onlyCase = flag("--case");
const offline = args.includes("--offline");
// Every messaging channel funnels through generateTheoReply, so the same judged corpus is run
// per channel to prove the rendering invariants hold on each one, not just on SMS.
// olivia-website posts source "form"; meta social posts the platform name.
const source = flag("--source") || "sms";
const CAPTURE_CHANNEL = { sms: "sms", form: "website", whatsapp: "whatsapp", instagram: "instagram", messenger: "instagram" };

const JUDGE_MODEL = "claude-sonnet-4-6";
const PASS_MEAN = 4.0;
const PASS_FLOOR = 3;

const CRITERIA = [
  ["formatting", "No Markdown artifacts, no label-colon dumps, no robotic prefixes. Structure is native to Apple Messages."],
  ["readability", "Scannable at a glance on a phone. No wall of text. The eye can find the important facts."],
  ["spacing", "Blank lines are used deliberately between logical blocks only. Not too many, not zero, none leading or trailing."],
  ["messageLength", "Length matches the kind of answer. A short acknowledgement is one line; a listing roundup is longer but never padded."],
  ["naturalness", "Reads like a skilled human agent typing, not a template or a system printout. Not stiff, not gushing."],
  ["contextRetention", "Uses the prior turns and lead memory. Does not re-ask what it already knows or resend what it already sent."],
  ["specificity", "Concrete and grounded in the property/lead facts provided. No vague filler, no invented facts."],
  ["usefulNextStep", "Moves the conversation forward with one clear, answerable next step (or correctly declines to)."],
  ["brokerageVoice", "Sounds like Austin Realty: professional, warm, direct, compliant. No hype, no emoji, no AI self-reference."],
  ["seamlessExtension", "Would pass as a message from a skilled human real estate agent on this team, with no tell that it was generated."],
];

// --- corpus -----------------------------------------------------------------

const corpus = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/imessage-reply-evals.json"), "utf8"));
const cases = onlyCase ? corpus.cases.filter((item) => item.id === onlyCase) : corpus.cases;
if (!cases.length) {
  console.error(`no cases matched ${onlyCase || "(all)"}`);
  process.exit(2);
}

// --- api key: repo .env first, then the canonical master env ----------------
// Never printed, never written to the artifact.

function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return "";
  const line = fs.readFileSync(file, "utf8")
    .split("\n")
    .find((row) => new RegExp(`^\\s*${key}\\s*=`).test(row));
  if (!line) return "";
  return line.replace(new RegExp(`^\\s*${key}\\s*=`), "").trim().replace(/^["']|["']$/g, "");
}

// The canonical master env is checked FIRST: the repo .env has carried a stale short key
// that returns 401. Values are only ever compared and sent, never logged or written out.
function anthropicKey() {
  const candidates = [
    process.env.ANTHROPIC_API_KEY || "",
    readEnvValue("/Users/martinofunrein/Downloads/atlas/claude-md-push/.env", "ANTHROPIC_API_KEY"),
    readEnvValue(path.join(root, ".env"), "ANTHROPIC_API_KEY"),
  ];
  // A real Anthropic key is long; the stale 45-char one is not usable.
  return candidates.find((value) => value.startsWith("sk-ant-") && value.length >= 90)
    || candidates.find(Boolean)
    || "";
}

// --- reply generation through the real path ---------------------------------

function propertiesFor(testCase) {
  return (testCase.propertyKeys || []).map((key) => {
    const row = corpus.properties[key];
    if (!row) throw new Error(`case ${testCase.id} references unknown property ${key}`);
    return { ...row };
  });
}

async function generate(testCase) {
  const properties = propertiesFor(testCase);
  const recentEvents = (testCase.recentEvents || []).map((event) => ({ ...event }));
  // Multi-turn cases replay earlier inbound turns into thread context, then generate a
  // reply to the LAST inbound message - the same way the webhook sees a live thread.
  const inbound = testCase.inbound;
  for (const earlier of inbound.slice(0, -1)) {
    if (!recentEvents.some((event) => event.message_text === earlier)) {
      recentEvents.unshift({ direction: "inbound", message_text: earlier });
    }
  }
  const message = inbound[inbound.length - 1];
  const result = await generateTheoReply({
    message,
    source,
    lead: testCase.lead || {},
    properties,
    recentEvents,
  });

  // Mirror the webhook's post-processing so we grade the text that is ACTUALLY delivered.
  // app/api/webhooks/theo-sms/route.ts runs appendLeadProfileCaptureAsk over every reply,
  // and that step is where the "every SMS is one line" bug lived.
  if (result.reply) {
    const profileDecision = decideLeadProfileCapture({
      channel: CAPTURE_CHANNEL[source] || "sms",
      message,
      lead: testCase.lead || {},
      classification: result.classification,
    });
    result.reply = appendLeadProfileCaptureAsk(
      result.reply,
      profileDecision,
      result.mediaUrls.length ? 1200 : 520,
    );
  }
  return { result, properties, recentEvents };
}

// --- judge ------------------------------------------------------------------

function judgePrompt(testCase, reply, properties, recentEvents) {
  const thread = recentEvents.length
    ? recentEvents.map((event) => `${event.direction === "outbound" ? "Iris" : "Lead"}: ${event.message_text}`).join("\n")
    : "(no prior messages)";
  const rows = properties.length
    // Every column the agent can legitimately quote must appear here. Omitting year_built and
    // property_type made the judge score real facts ("Built 2018, condo") as invented.
    ? properties.map((row, index) => `${index + 1}. ${row.address} | ${row.price} | ${row.beds}bd/${row.baths}ba | ${row.sqft} sqft | ${row.neighborhood} | built=${row.year_built || "unknown"} | type=${row.property_type || "unknown"} | status=${row.status || "unknown"} | features=${row.features || "none"} | ${row.listing_url}`).join("\n")
    : "(no property rows were available to the agent)";

  return `You are an independent evaluator. You are a 20-year Austin residential real estate broker who also runs your team's texting playbook. You are grading ONE outbound text message that an AI ISA named Iris sent on behalf of Austin Realty.

The lead reads this in Apple Messages on an iPhone. Apple Messages renders newlines and blank lines literally. It cannot render bold, headings, or Markdown link syntax.
MANDATORY HOUSE FORMATTING STANDARD (do NOT penalise these; they are required):
- Every URL is its own paragraph: alone on its line, with a blank line before and after it, and nothing preceding or following it on that line. A blank line between a listing's facts and its link is CORRECT and required, not visual noise.
- Property details start on their own line after the intro, never jammed into the intro sentence.
- Multiple listings use blocks: heading/details, blank line, isolated URL, blank line, then the next block or the closing question.
- No Markdown anywhere. Raw clickable URLs only.
Judge spacing ONLY on deviations from this standard.

RESPONSE TYPE: ${testCase.family} (${testCase.label})

PRIOR THREAD:
${thread}

PROPERTY FACTS THE AGENT HAD:
${rows}

LEAD MEMORY THE AGENT HAD:
${JSON.stringify(testCase.lead || {})}

LATEST INBOUND MESSAGE FROM THE LEAD:
${testCase.inbound[testCase.inbound.length - 1]}

THE REPLY YOU ARE GRADING (verbatim, between the markers; newlines are real):
<<<REPLY
${reply}
REPLY>>>

WHAT A SKILLED AGENT'S REPLY MUST DO:
${(testCase.must || []).map((item) => `- ${item}`).join("\n")}

WHAT IT MUST NOT DO:
${(testCase.mustNot || []).map((item) => `- ${item}`).join("\n")}
${testCase.guardrail ? `\nCOMPLIANCE GUARDRAIL THAT MUST HOLD: ${testCase.guardrail}. If the reply breaks it, score brokerageVoice and seamlessExtension at 1.\n` : ""}
Score each criterion 1-5. 1 = badly wrong. 3 = acceptable but noticeably weak. 4 = what a good agent would send. 5 = indistinguishable from your best agent.

CRITERIA:
${CRITERIA.map(([key, description]) => `- ${key}: ${description}`).join("\n")}

Be strict. Do not award 4 or 5 for something you would edit before sending. Judge the reply as written, including its exact line breaks and blank lines.

Return ONLY JSON, no prose:
{"scores":{${CRITERIA.map(([key]) => `"${key}":<1-5>`).join(",")}},"reasoning":"<2-4 sentences on what works and what does not>","violations":["<any must/mustNot item that was broken>"]}`;
}

async function judge(key, testCase, reply, properties, recentEvents) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 1200,
      temperature: 0,
      messages: [{ role: "user", content: judgePrompt(testCase, reply, properties, recentEvents) }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || response.statusText;
    throw new Error(`judge call failed (${response.status}): ${detail}`);
  }
  const text = (payload.content || []).find((block) => block.type === "text")?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`judge did not return JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  const scores = {};
  for (const [criterion] of CRITERIA) {
    const raw = Number(parsed.scores?.[criterion]);
    if (!Number.isFinite(raw)) throw new Error(`judge omitted criterion ${criterion}`);
    scores[criterion] = Math.min(5, Math.max(1, raw));
  }
  return {
    scores,
    reasoning: String(parsed.reasoning || "").trim(),
    violations: Array.isArray(parsed.violations) ? parsed.violations.map(String) : [],
    usage: payload.usage || {},
  };
}

// --- run --------------------------------------------------------------------

const key = offline ? "" : anthropicKey();
if (!offline && !key) {
  console.error("ANTHROPIC_API_KEY not found in env, repo .env, or the master env. Use --offline for deterministic checks only.");
  process.exit(2);
}

const rows = [];
for (const testCase of cases) {
  const { result, properties, recentEvents } = await generate(testCase);
  const reply = result.reply || "";
  const sent = result.shouldSend && Boolean(reply);

  // Opt-out and other no-send cases are graded on the send decision, not on prose.
  if (testCase.expectNoSend) {
    const ok = !sent;
    rows.push({
      id: testCase.id,
      family: testCase.family,
      reply,
      aiAction: result.aiAction,
      status: result.status,
      deterministic: [],
      mean: ok ? 5 : 1,
      min: ok ? 5 : 1,
      scores: Object.fromEntries(CRITERIA.map(([criterion]) => [criterion, ok ? 5 : 1])),
      reasoning: ok
        ? "No outbound message was produced, which is the required behaviour for an opt-out."
        : `Opt-out still produced an outbound message: ${reply}`,
      violations: ok ? [] : ["sent a reply after an opt-out request"],
      pass: ok,
      judged: false,
    });
    continue;
  }

  const deterministic = checkMessagesFormatting(reply, { family: testCase.family });

  let scores = null;
  let reasoning = "";
  let violations = [];
  if (!offline) {
    const verdict = await judge(key, testCase, reply, properties, recentEvents);
    scores = verdict.scores;
    reasoning = verdict.reasoning;
    violations = verdict.violations;
  }

  const values = scores ? Object.values(scores) : [];
  const mean = values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  const min = values.length ? Math.min(...values) : 0;
  rows.push({
    id: testCase.id,
    family: testCase.family,
    reply,
    aiAction: result.aiAction,
    status: result.status,
    deterministic: deterministic.map((item) => `${item.code}: ${item.detail}`),
    mean: Number(mean.toFixed(2)),
    min,
    scores: scores || {},
    reasoning,
    violations,
    // Deterministic violations are a hard fail regardless of what the judge thought.
    pass: deterministic.length === 0 && (offline || (mean >= PASS_MEAN && min >= PASS_FLOOR)),
    judged: !offline,
  });
}

// --- report -----------------------------------------------------------------

console.table(rows.map((row) => ({
  id: row.id,
  family: row.family,
  chars: row.reply.length,
  lines: row.reply ? row.reply.split("\n").length : 0,
  mean: row.judged || row.mean ? row.mean : "-",
  min: row.judged || row.min ? row.min : "-",
  checks: row.deterministic.length ? `FAIL(${row.deterministic.length})` : "ok",
  pass: row.pass ? "PASS" : "FAIL",
})));

const perCriterion = {};
for (const [criterion] of CRITERIA) {
  const values = rows.filter((row) => row.scores[criterion] != null).map((row) => row.scores[criterion]);
  perCriterion[criterion] = values.length
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : null;
}
if (!offline) {
  console.log("\nper-criterion mean across all cases:");
  console.table(perCriterion);
}

const failed = rows.filter((row) => !row.pass);
for (const row of failed) {
  console.log(`\n--- FAIL ${row.id} (${row.family}) mean=${row.mean} min=${row.min}`);
  if (row.deterministic.length) console.log(`  deterministic: ${row.deterministic.join(" | ")}`);
  if (row.violations.length) console.log(`  criteria broken: ${row.violations.join(" | ")}`);
  if (row.reasoning) console.log(`  judge: ${row.reasoning}`);
  console.log(`  reply:\n${row.reply.split("\n").map((line) => `    ${line}`).join("\n")}`);
}

const overallValues = rows.flatMap((row) => Object.values(row.scores));
const summary = {
  ok: failed.length === 0,
  mode: offline ? "offline-deterministic" : "ai-judge",
  channel: source,
  judgeModel: offline ? null : JUDGE_MODEL,
  threshold: { mean: PASS_MEAN, floor: PASS_FLOOR },
  corpusId: corpus.corpusId,
  totalCases: rows.length,
  passed: rows.length - failed.length,
  failed: failed.length,
  overallMean: overallValues.length
    ? Number((overallValues.reduce((total, value) => total + value, 0) / overallValues.length).toFixed(2))
    : null,
  perCriterion,
  cases: rows.map((row) => ({
    id: row.id,
    family: row.family,
    pass: row.pass,
    mean: row.mean,
    min: row.min,
    chars: row.reply.length,
    blocks: row.reply ? row.reply.split("\n\n").filter(Boolean).length : 0,
    aiAction: row.aiAction,
    deterministic: row.deterministic,
    scores: row.scores,
    violations: row.violations,
    reasoning: row.reasoning,
    reply: row.reply,
  })),
};
console.log(`\n${JSON.stringify({ ...summary, cases: undefined }, null, 2)}`);

if (outPath) {
  const resolved = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}

if (failed.length) process.exit(1);
