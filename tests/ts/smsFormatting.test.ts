import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  MESSAGES_MAX_LINE_CHARS,
  MESSAGES_REPLY_FAMILIES,
  checkMessagesFormatting,
  fitMessagesReply,
  isMessagesFormattingClean,
  messagesBlockCount,
  messagesBlocks,
  messagesBudget,
  messagesLines,
  normalizeMessagesReply,
  pickVariant,
  repeatsRecentReply,
  replyFingerprint,
  type MessagesReplyFamily,
} from "@/lib/smsFormatting";
import { generateTheoReply } from "@/lib/theoAgent";
import { appendLeadProfileCaptureAsk, decideLeadProfileCapture } from "@/lib/leadProfileCapture";
import type { SheetRow } from "@/lib/sheetSchema";

const codes = (value: string, family?: MessagesReplyFamily) =>
  checkMessagesFormatting(value, family ? { family } : {}).map((violation) => violation.code);

// --- normalization ----------------------------------------------------------

test("normalizeMessagesReply preserves intentional blank lines", () => {
  const input = "I found 2 matches:\n\n1. 70 Rainey St #1509\n$750,000\n\n2. 70 Rainey St #2203\n$499,900";
  const output = normalizeMessagesReply(input);
  assert.equal(messagesBlockCount(output), 3);
  assert.match(output, /matches:\n\n1\./);
});

test("normalizeMessagesReply does not collapse newlines into spaces", () => {
  // This is the exact regression that shipped every live SMS as a single line:
  // appendLeadProfileCaptureAsk ran replace(/\s+/g, " ") over the whole reply.
  const input = "70 Rainey St #1509\n$750,000, 2bd/2ba\nhttps://example.com/a\n\nWant a tour?";
  const normalized = normalizeMessagesReply(input);
  // 5 newlines, not 4: the URL is now its own paragraph, so a blank line precedes it.
  assert.equal((normalized.match(/\n/g) || []).length, 5);
  assert.equal(normalized, "70 Rainey St #1509\n$750,000, 2bd/2ba\n\nhttps://example.com/a\n\nWant a tour?");
});

test("normalizeMessagesReply strips markdown that Messages cannot render", () => {
  const output = normalizeMessagesReply(
    "## Options\n**70 Rainey St** has `central air` and __a balcony__\n- first item\n- second item\n[Listing](https://example.com/x)",
  );
  assert.doesNotMatch(output, /\*\*|__|##|`|\[.*\]\(/);
  assert.doesNotMatch(output, /^- /m);
  assert.match(output, /70 Rainey St has central air and a balcony/);
  assert.match(output, /https:\/\/example\.com\/x/);
  assert.match(output, /^first item$/m);
});

test("normalizeMessagesReply removes em dashes and placeholder characters", () => {
  const output = normalizeMessagesReply("￼￼Photos coming through — all three.");
  assert.doesNotMatch(output, /￼/);
  assert.doesNotMatch(output, /—/);
  assert.match(output, /^Photos coming through/);
});

test("normalizeMessagesReply collapses 3+ newlines and trims edges", () => {
  const output = normalizeMessagesReply("\n\nfirst\n\n\n\nsecond\n\n");
  assert.equal(output, "first\n\nsecond");
});

test("normalizeMessagesReply separates a numbered list from its intro but keeps items tight", () => {
  const output = normalizeMessagesReply("I found 3 matches:\n1. one\n2. two\n3. three");
  assert.equal(output, "I found 3 matches:\n\n1. one\n2. two\n3. three");
});

test("normalizeMessagesReply keeps a bare link label out of the way", () => {
  assert.equal(normalizeMessagesReply("[link](https://example.com/z)"), "https://example.com/z");
  // A meaningful label is kept, but the URL still gets its own paragraph.
  assert.equal(normalizeMessagesReply("[Rainey unit](https://example.com/z)"), "Rainey unit\n\nhttps://example.com/z");
});

// --- artifact checks --------------------------------------------------------

test("checkMessagesFormatting flags every markdown artifact", () => {
  assert.ok(codes("**bold**").includes("markdown_bold"));
  assert.ok(codes("__under__").includes("markdown_underscore"));
  assert.ok(codes("## heading").includes("markdown_heading"));
  assert.ok(codes("[a](https://b.c)").includes("markdown_link"));
  assert.ok(codes("use `code`").includes("markdown_code"));
  assert.ok(codes("- first\n- second").includes("markdown_bullet"));
});

test("checkMessagesFormatting flags em dashes via the shared noEmDash rule", () => {
  assert.ok(codes("Great news — it is available.").includes("em_dash"));
  assert.ok(!codes("Great news, it is available.").includes("em_dash"));
});

test("checkMessagesFormatting flags emoji and placeholder characters", () => {
  assert.ok(codes("Sounds good \u{1F600}").includes("emoji"));
  assert.ok(codes("￼Photos coming through.").includes("placeholder_char"));
});

test("checkMessagesFormatting flags robotic label prefixes", () => {
  const robotic = [
    "Property Details: 70 Rainey St #1509 is a condo.",
    "Next Steps: pick a time.",
    "Status for 70 Rainey St #1509: Active.",
    "Sending the property photos for: 1. 70 Rainey St",
    "Here are the listing links: https://example.com/a",
    "Lowest listed price from these options:",
    "Notes: it has a balcony.",
    "Listing: https://example.com/a",
  ];
  for (const value of robotic) {
    assert.ok(codes(value).includes("robotic_label"), `expected robotic_label for: ${value}`);
  }
});

test("checkMessagesFormatting accepts a natural address line that is not a label", () => {
  const clean = "70 Rainey St #1509\n$750,000, 2bd/2ba, 1,128 sqft, Downtown Austin\nhttps://example.com/a\n\nWant a tour this week?";
  assert.deepEqual(codes(clean, "single_property"), []);
});

// --- spacing ----------------------------------------------------------------

test("checkMessagesFormatting flags 3 or more consecutive newlines", () => {
  assert.ok(codes("first\n\n\nsecond").includes("excess_blank_lines"));
});

test("checkMessagesFormatting flags leading and trailing blank lines", () => {
  assert.ok(codes("\nfirst").includes("leading_blank"));
  assert.ok(codes("first\n").includes("trailing_blank"));
});

test("checkMessagesFormatting flags a single-line wall", () => {
  const wall = `I found 3 matches: ${"1. 70 Rainey St #1509 $750,000, 2bd/2ba, 1,128 sqft, Downtown Austin. ".repeat(3)}Which one?`;
  assert.ok(wall.length > MESSAGES_MAX_LINE_CHARS);
  assert.ok(codes(wall, "multi_listing").includes("line_wall"));
});

test("checkMessagesFormatting does not call a long bare URL a wall", () => {
  const longUrl = `https://www.zillow.com/homedetails/${"a".repeat(200)}/306644848_zpid/`;
  const reply = `70 Rainey St #1509\n$750,000, 2bd/2ba\n${longUrl}\n\nWant a tour?`;
  assert.ok(!codes(reply, "single_property").includes("line_wall"));
});

test("checkMessagesFormatting flags a verbatim repeated line", () => {
  const line = "70 Rainey St #1509 is showing as active right now.";
  assert.ok(codes(`${line}\n\n${line}`, "single_property").includes("repeated_line"));
});

// --- budgets ----------------------------------------------------------------

test("a short acknowledgment must not be a 300 character reply", () => {
  const long = "Happy to help with that. ".repeat(13);
  assert.ok(long.length > 300);
  const found = codes(long, "short_ack");
  assert.ok(found.includes("over_budget"), `expected over_budget, got ${found.join(",")}`);
  assert.deepEqual(codes("Anytime. Just say the word when you want to keep going.", "short_ack"), []);
});

test("a short acknowledgment must stay one block", () => {
  assert.ok(codes("Anytime.\n\nWant to keep looking?", "short_ack").includes("ack_not_single_block"));
});

test("budgets grow with the shape of the answer", () => {
  assert.ok(messagesBudget("multi_listing").maxChars > messagesBudget("single_property").maxChars);
  assert.ok(messagesBudget("single_property").maxChars > messagesBudget("short_ack").maxChars);
  for (const family of MESSAGES_REPLY_FAMILIES) {
    assert.equal(messagesBudget(family).maxQuestions, 1, `${family} should allow at most one question`);
  }
});

test("checkMessagesFormatting flags more than one question", () => {
  assert.ok(codes("Want a tour? Or photos first?", "single_property").includes("too_many_questions"));
});

test("checkMessagesFormatting flags too many blocks and lines", () => {
  const many = Array.from({ length: 12 }, (_v, index) => `block ${index}`).join("\n\n");
  const found = codes(many, "single_property");
  assert.ok(found.includes("too_many_blocks"));
  assert.ok(found.includes("too_many_lines"));
});

// --- list discipline --------------------------------------------------------

test("a list needs 2 or more parallel items to be a list", () => {
  assert.ok(codes("Here is what I have:\n\n1. 70 Rainey St #1509", "multi_listing").includes("single_item_list"));
  assert.ok(
    !codes("I found 2 matches:\n\n1. 70 Rainey St #1509\n2. 70 Rainey St #2203", "multi_listing").includes("single_item_list"),
  );
});

// --- helpers ----------------------------------------------------------------

test("messagesBlocks joins non-empty parts with exactly one blank line", () => {
  assert.equal(messagesBlocks("a", "", null, undefined, false, "b"), "a\n\nb");
  assert.equal(messagesBlocks(""), "");
});

test("messagesLines drops blank lines", () => {
  assert.deepEqual(messagesLines("a\n\nb\n\n\nc"), ["a", "b", "c"]);
});

test("pickVariant is deterministic and stays in range", () => {
  const pool = ["one", "two", "three"] as const;
  assert.equal(pickVariant(pool, "70 Rainey St #1509"), pickVariant(pool, "70 Rainey St #1509"));
  const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => pickVariant(pool, seed)));
  assert.ok(seen.size > 1, "variants should actually vary across seeds");
  for (const value of seen) assert.ok(pool.includes(value as (typeof pool)[number]));
});

test("fitMessagesReply drops whole trailing blocks before cutting a sentence", () => {
  const reply = "70 Rainey St #1509\n$750,000, 2bd/2ba\n\nWant a tour this week or next?";
  const fitted = fitMessagesReply(reply, 40);
  assert.equal(fitted, "70 Rainey St #1509\n$750,000, 2bd/2ba");
  assert.doesNotMatch(fitted, /\.\.\.$/);
});

test("fitMessagesReply leaves a within-budget reply untouched", () => {
  const reply = "70 Rainey St #1509\n$750,000\n\nWant a tour?";
  assert.equal(fitMessagesReply(reply, 500), reply);
});

test("repeatsRecentReply catches an exact and a near repeat", () => {
  const prior = "70 Rainey St #1509\n$750,000, 2bd/2ba, 1,128 sqft, Downtown Austin\nBuilt 2018, condo.\nhttps://example.com/a";
  assert.ok(repeatsRecentReply(prior, prior));
  assert.ok(repeatsRecentReply(`${prior}\n\nWant a tour?`, prior));
  assert.ok(!repeatsRecentReply("Happy to set that up. What day works?", prior));
});

test("replyFingerprint ignores urls and punctuation", () => {
  assert.equal(
    replyFingerprint("70 Rainey St #1509, $750,000\nhttps://a.example/x"),
    replyFingerprint("70 Rainey St 1509 $750 000 https://b.example/y"),
  );
});

// --- the bug that produced one-line SMS in production -----------------------

test("appendLeadProfileCaptureAsk keeps the reply's blank lines intact", () => {
  const reply = "70 Rainey St #1509\n$750,000, 2bd/2ba\nhttps://example.com/a\n\nWant a tour this week?";
  const decision = decideLeadProfileCapture({
    channel: "sms",
    message: "tell me more",
    lead: { phone: "+15125550101" },
    classification: { intent: "property_details", leadRole: "buyer", handoffReason: "", status: "ready_to_reply" },
  });
  const output = appendLeadProfileCaptureAsk(reply, decision, 1200);
  assert.match(output, /\n\n/, "blank line between blocks must survive");
  assert.equal((output.match(/\n/g) || []).length >= 4, true);
});

// --- the real generated replies must satisfy the checks ---------------------

function property(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    address: "70 Rainey St #1509",
    price: "750000",
    beds: "2",
    baths: "2",
    sqft: "1128",
    year_built: "2018",
    property_type: "Condo",
    status: "Active",
    neighborhood: "Downtown Austin",
    features: "Central Air, Balcony, Elevator Building, Urban Location",
    listing_url: "https://www.zillow.com/homedetails/70-Rainey-St-1509-Austin-TX-78701/306644848_zpid/",
    photo_url: "https://photos.zillowstatic.com/fp/rainey1509-p_e.jpg",
    ...overrides,
  } as SheetRow;
}

async function offlineReply(context: Parameters<typeof generateTheoReply>[0]) {
  const saved = {
    openai: process.env.OPENAI_API_KEY,
    theo: process.env.OPENAI_API_KEY_THEO,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY_THEO;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    return await generateTheoReply(context);
  } finally {
    if (saved.openai == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.openai;
    if (saved.theo == null) delete process.env.OPENAI_API_KEY_THEO;
    else process.env.OPENAI_API_KEY_THEO = saved.theo;
    if (saved.anthropic == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.anthropic;
  }
}

const GENERATED_CASES: Array<{
  name: string;
  family: MessagesReplyFamily;
  context: Parameters<typeof generateTheoReply>[0];
}> = [
  { name: "short ack", family: "short_ack", context: { message: "Thanks", source: "sms", lead: { phone: "+15125550101" }, properties: [] } },
  { name: "greeting", family: "general", context: { message: "Hi", source: "sms", lead: { phone: "+15125550101" }, properties: [] } },
  {
    name: "single property",
    family: "single_property",
    context: { message: "Tell me more about the first one", source: "sms", lead: { phone: "+15125550101" }, properties: [property()] },
  },
  {
    name: "multi listing",
    family: "multi_listing",
    context: {
      message: "What condo options do you have available downtown?",
      source: "sms",
      lead: { phone: "+15125550101" },
      properties: [
        property(),
        property({ address: "70 Rainey St #2208", price: "1450000", sqft: "1434", listing_url: "https://www.zillow.com/homedetails/70-Rainey-St-2208-Austin-TX-78701/306644542_zpid/" }),
        property({ address: "70 Rainey St #2203", price: "499900", beds: "1", baths: "1", sqft: "663", listing_url: "https://www.zillow.com/homedetails/70-Rainey-St-2203-Austin-TX-78701/306644488_zpid/" }),
      ],
    },
  },
  {
    name: "missing details",
    family: "missing_details",
    context: { message: "Got anything similar?", source: "sms", lead: { phone: "+15125550101" }, properties: [] },
  },
  {
    name: "availability follow-up",
    family: "followup_question",
    context: { message: "Is it still available?", source: "sms", lead: { phone: "+15125550101" }, properties: [property()] },
  },
  {
    name: "scheduling",
    family: "scheduling",
    context: { message: "Can I tour the first one?", source: "sms", lead: { phone: "+15125550101" }, properties: [property()] },
  },
  {
    name: "amenities with shared context",
    family: "shared_property_context",
    context: { message: "What other amenities does it have?", source: "sms", lead: { phone: "+15125550101" }, properties: [property()] },
  },
  {
    name: "comparison",
    family: "multi_listing",
    context: {
      message: "Which one is cheapest?",
      source: "sms",
      lead: { phone: "+15125550101" },
      properties: [property(), property({ address: "70 Rainey St #2203", price: "499900" })],
    },
  },
  {
    name: "fair housing handoff",
    family: "sensitive_handoff",
    context: { message: "Is this a safe neighborhood with good schools?", source: "sms", lead: { phone: "+15125550101" }, properties: [property()] },
  },
];

for (const testCase of GENERATED_CASES) {
  test(`generated reply is Messages-clean: ${testCase.name}`, async () => {
    const result = await offlineReply(testCase.context);
    const violations = checkMessagesFormatting(result.reply, { family: testCase.family });
    assert.deepEqual(
      violations,
      [],
      `${testCase.name} violations: ${violations.map((v) => `${v.code} (${v.detail})`).join("; ")}\n---\n${result.reply}\n---`,
    );
    assert.ok(isMessagesFormattingClean(result.reply, { family: testCase.family }));
  });
}

test("generated replies do not all share one canned closing question", async () => {
  const tails = new Set<string>();
  for (const address of ["70 Rainey St #1509", "6828 Walkup Ln", "7405 Wallach St", "6814 Old Quarry Ln"]) {
    const result = await offlineReply({
      message: "Tell me more about it",
      source: "sms",
      lead: { phone: "+15125550101" },
      properties: [property({ address })],
    });
    const lines = messagesLines(result.reply);
    tails.add(lines[lines.length - 1] || "");
  }
  assert.ok(tails.size > 1, `closing question never varied: ${[...tails].join(" | ")}`);
});

test("a details follow-up right after the same details advances instead of repeating", async () => {
  const prior = "70 Rainey St #1509\n$750,000, 2bd/2ba, 1,128 sqft, Downtown Austin\nBuilt 2018, condo. Central Air, Balcony, Elevator Building, Urban Location.\nhttps://www.zillow.com/homedetails/70-Rainey-St-1509-Austin-TX-78701/306644848_zpid/\n\nShould I line up a walkthrough, or keep looking?";
  const result = await offlineReply({
    message: "Tell me more about it",
    source: "sms",
    lead: { phone: "+15125550101" },
    properties: [property()],
    recentEvents: [{ direction: "outbound", message_text: prior } as SheetRow],
  });
  assert.ok(!repeatsRecentReply(result.reply, prior), `reply repeated the previous outbound:\n${result.reply}`);
  assert.deepEqual(checkMessagesFormatting(result.reply, { family: "single_property" }), []);
});

test("the corpus fixture stays in sync with the families the checker knows", () => {
  const corpusPath = path.join(process.cwd(), "tests/fixtures/imessage-reply-evals.json");
  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8")) as {
    cases: Array<{ id: string; family: MessagesReplyFamily; inbound: string[]; must: string[]; mustNot: string[] }>;
    properties: Record<string, SheetRow>;
  };
  assert.ok(corpus.cases.length >= 15, `expected at least 15 eval cases, found ${corpus.cases.length}`);
  const ids = new Set<string>();
  for (const item of corpus.cases) {
    assert.ok(!ids.has(item.id), `duplicate case id ${item.id}`);
    ids.add(item.id);
    assert.ok(MESSAGES_REPLY_FAMILIES.includes(item.family), `unknown family ${item.family} on ${item.id}`);
    assert.ok(item.inbound.length >= 1, `${item.id} has no inbound message`);
    assert.ok(item.must.length >= 1, `${item.id} has no must criteria`);
    assert.ok(item.mustNot.length >= 1, `${item.id} has no mustNot criteria`);
  }
  // Every family the checker supports except the catch-all must be exercised.
  const covered = new Set(corpus.cases.map((item) => item.family));
  for (const family of MESSAGES_REPLY_FAMILIES) {
    if (family === "general") continue;
    assert.ok(covered.has(family), `corpus does not cover family ${family}`);
  }
  const multiTurn = corpus.cases.filter((item) => item.inbound.length > 1);
  assert.ok(multiTurn.length >= 2, `expected at least 2 multi-turn cases, found ${multiTurn.length}`);
});

// Regression from the live SMS suite: the model path answered compliance questions in one
// 220-290 character paragraph, which lands in Apple Messages as an unbroken grey wall.
// These are the exact replies chat 1984 sent back before the splitter existed.
test("an over-long single-line reply is broken into blocks at sentence boundaries", () => {
  const walls = [
    "Hey Martin, that's not something I'm able to help with - Fair Housing law means I can't filter or steer by race, ethnicity, or national origin. What I can help with is finding you a great 2-bedroom in Northwest Austin. What's your budget range?",
    "That's not something I'm able to share - personal data and system credentials are never sent over text for anyone's protection. A member of our team has been flagged to follow up with you directly. In the meantime, happy to keep helping you find a 2-bedroom in Austin when you're ready.",
    "Hey Martin, I hear you - and I'm not going to engage with that request. A real person from Austin Realty will be reaching out to you directly. If you do want help finding a 2-bedroom in Austin, we're here when you're ready.",
  ];
  for (const wall of walls) {
    const normalized = normalizeMessagesReply(wall);
    assert.ok(normalized.includes("\n\n"), `no block break added to: ${normalized}`);
    for (const line of normalized.split("\n")) {
      assert.ok(line.length <= MESSAGES_MAX_LINE_CHARS, `line still a wall (${line.length}): ${line}`);
    }
    assert.deepEqual(checkMessagesFormatting(normalized, { family: "sensitive_handoff" }), []);
    // Splitting must not lose or reorder words.
    assert.equal(normalized.replace(/\s+/g, " ").trim(), wall.replace(/\s+/g, " ").trim());
  }
});

test("a long URL is never broken and a single long sentence is left intact", () => {
  const url = `https://www.zillow.com/homedetails/${"x".repeat(200)}_zpid/`;
  assert.equal(normalizeMessagesReply(url), url);

  const oneSentence = `I ${"really ".repeat(40)}mean it`;
  const normalized = normalizeMessagesReply(oneSentence);
  assert.ok(!normalized.includes("\n"), "a single sentence must not be chopped mid-clause");
});

// The first version of the wall splitter broke sentences on every period, including the ones
// inside "www.zillow.com/...". That tore links in half and silently defeated the repeat guard,
// because replyFingerprint could no longer recognise and strip the URL.
test("wall splitting never breaks a URL apart", () => {
  const wall = "70 Rainey St #1509 is still active and I can get you in this week. The full listing is at https://www.zillow.com/homedetails/70-Rainey-St-1509-Austin-TX-78701/306644848_zpid/ so you can see every photo. What day works best for you?";
  const normalized = normalizeMessagesReply(wall);
  assert.ok(normalized.includes("https://www.zillow.com/homedetails/70-Rainey-St-1509-Austin-TX-78701/306644848_zpid/"));
  for (const line of normalized.split("\n")) {
    assert.ok(!/^\S*zillow\.com/.test(line) || line.startsWith("https://"), `URL fragment on its own line: ${line}`);
  }
});

test("a collapsed one-line copy of a reply still fingerprints as the same reply", () => {
  const block = "70 Rainey St #1509\n$750,000, 2bd/2ba, 1,128 sqft, Downtown Austin\nBuilt 2018, condo.\nhttps://www.zillow.com/homedetails/70-Rainey-St-1509-Austin-TX-78701/306644848_zpid/\n\nShould I line up a walkthrough, or keep looking?";
  // conversation_events storage collapses whitespace, so the guard has to survive that.
  const collapsed = block.replace(/\s+/g, " ").trim();
  assert.equal(replyFingerprint(block), replyFingerprint(collapsed));
  assert.ok(repeatsRecentReply(block, collapsed));
});

// Binding messaging invariant: a URL is its own paragraph. The live channel shipped
// "…, Downtown Austin Listing: https://… Want me to send photos?" as one run-on line, where
// the link is unreadable and barely tappable. Enforced in the shared finalization path, so
// SMS, iMessage, WhatsApp, website chat and social DMs all inherit it.
const EXAMPLE_URL = "https://www.zillow.com/homedetails/example";

function urlLinesAreIsolated(text: string): boolean {
  return text
    .split("\n")
    .filter((line) => /https?:\/\//.test(line))
    .every((line) => line.replace(/https?:\/\/\S+/g, "").trim() === "");
}

function urlsHaveParagraphSeparation(text: string): boolean {
  const lines = text.split("\n");
  return lines.every((line, index) => {
    if (!/https?:\/\//.test(line)) return true;
    const beforeOk = index === 0 || lines[index - 1] === "";
    const afterOk = index === lines.length - 1 || lines[index + 1] === "";
    return beforeOk && afterOk;
  });
}

test("every messaging URL is isolated on its own line as its own paragraph", () => {
  const inputs: Array<[string, string]> = [
    ["inline label, the live bug", `6815 Cougar Run $969,800, 3bd/3ba, Northwest Austin Listing: ${EXAMPLE_URL} Want me to send photos, book a showing, or find similar options?`],
    ["single listing block", `Here's the Northwest Austin option I found:\n6815 Cougar Run\n$969,800 | 3 bed | 3 bath | 2,625 sq ft\n${EXAMPLE_URL}\nAre you looking to buy or rent?`],
    ["url at message start", `${EXAMPLE_URL} is the one I meant. What day works?`],
    ["url at message end", `Here's the option.\n6815 Cougar Run\n${EXAMPLE_URL}`],
    ["two listings, two urls", `I found 2 matches:\n1. 6815 Cougar Run $969,800 ${EXAMPLE_URL}\n2. 70 Rainey St #1509 $750,000 ${EXAMPLE_URL}2\nWhich do you want to see first?`],
    ["punctuation wrapping the url", `See the listing (${EXAMPLE_URL}). Then tell me what you think.`],
    ["trailing period after a label", `Listing: ${EXAMPLE_URL}.`],
    ["url only", EXAMPLE_URL],
  ];

  for (const [label, input] of inputs) {
    const normalized = normalizeMessagesReply(input);
    assert.ok(urlLinesAreIsolated(normalized), `${label}: URL shares a line with prose:\n${normalized}`);
    assert.ok(urlsHaveParagraphSeparation(normalized), `${label}: URL lacks paragraph separation:\n${normalized}`);
    // No meaningless blank line at either message boundary.
    assert.ok(!/^\s*\n/.test(normalized), `${label}: leading blank line`);
    assert.ok(!/\n\s*$/.test(normalized), `${label}: trailing blank line`);
    // The raw clickable URL survives; no Markdown link syntax is introduced.
    assert.ok(normalized.includes(EXAMPLE_URL), `${label}: URL was altered:\n${normalized}`);
    assert.doesNotMatch(normalized, /\[[^\]]*\]\([^)]*\)/, `${label}: Markdown link syntax`);
  }
});

test("the checker reports a URL that shares a line with prose", () => {
  const bad = `70 Rainey St #1509 $750,000, Downtown Austin Listing: ${EXAMPLE_URL} Want me to send photos?`;
  assert.ok(codes(bad, "multi_listing").includes("url_not_isolated"));
  // And is satisfied once the shared finalization path has run.
  assert.ok(!codes(normalizeMessagesReply(bad), "multi_listing").includes("url_not_isolated"));
});

test("a label that existed only to introduce the link is dropped, not stranded", () => {
  for (const label of ["Listing:", "Link:", "Photos:", "More info:"]) {
    const normalized = normalizeMessagesReply(`6815 Cougar Run\n${label} ${EXAMPLE_URL}`);
    assert.doesNotMatch(normalized, new RegExp(`^${label.replace(":", ":?")}$`, "m"), `stranded label: ${normalized}`);
    assert.ok(urlLinesAreIsolated(normalized));
  }
});
