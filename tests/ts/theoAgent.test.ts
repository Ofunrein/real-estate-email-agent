import { test } from "node:test";
import assert from "node:assert/strict";

import { generateTheoReply } from "@/lib/theoAgent";
import type { SheetRow } from "@/lib/sheetSchema";

function property(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    address: "6814 Old Quarry Ln",
    price: "1703 per month",
    beds: "1",
    baths: "1",
    sqft: "1020",
    neighborhood: "Northwest Austin",
    property_type: "Apartment",
    listing_url: "https://www.zillow.com/homedetails/6814-Old-Quarry-Ln-Austin-TX-78731/29349813_zpid/",
    description: "Apartment with community pool and convenient Austin access.",
    photo_url: "https://photos.zillowstatic.com/fp/example-p_e.jpg",
    ...overrides,
  } as SheetRow;
}

async function withoutOpenAi<T>(fn: () => Promise<T>): Promise<T> {
  const priorOpenAiKey = process.env.OPENAI_API_KEY;
  const priorTheoKey = process.env.OPENAI_API_KEY_THEO;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY_THEO;
  try {
    return await fn();
  } finally {
    if (priorOpenAiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAiKey;
    if (priorTheoKey == null) delete process.env.OPENAI_API_KEY_THEO;
    else process.env.OPENAI_API_KEY_THEO = priorTheoKey;
  }
}

test("generateTheoReply: ordinal property detail follow-up does not hand off", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "The first one tell me more about it",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [property()],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_safe_inquiry_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /6814 Old Quarry Ln/);
  assert.match(result.reply, /\$1,703 per month/);
  assert.match(result.reply, /book a showing/);
});

test("generateTheoReply: typo similar options stays deterministic", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "Similar optiosn",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [property(), property({ address: "6903 Deatonhill Dr APT 19", price: "1242 per month", neighborhood: "South Austin" })],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_options_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /matches I found/i);
  assert.match(result.reply, /6814 Old Quarry Ln/);
});

test("generateTheoReply: similar options with no matches asks to widen instead of handoff", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "similar options",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_options_no_match_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /widen/i);
});

test("generateTheoReply: photo follow-up sends media when enabled", async () => {
  const prior = process.env.ENABLE_SMS_IMAGES;
  process.env.ENABLE_SMS_IMAGES = "true";
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "send photos of that one",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [property()],
  }));
  if (prior == null) delete process.env.ENABLE_SMS_IMAGES;
  else process.env.ENABLE_SMS_IMAGES = prior;

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_photos_reply_ready");
  assert.deepEqual(result.mediaUrls, ["https://photos.zillowstatic.com/fp/example-p_e.jpg"]);
  assert.match(result.reply, /Sending the property photo/i);
});

test("generateTheoReply: availability question answers from listing context instead of handoff", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "Is it still available?",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [property({ status: "Active" })],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_safe_inquiry_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /Status for 6814 Old Quarry Ln: Active/i);
});

test("generateTheoReply: amenity question answers known and unknown listing fields", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "Does the first one allow pets and have parking?",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [property({ features: "Community pool, covered parking, washer dryer connections." })],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_safe_inquiry_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /parking/i);
  assert.match(result.reply, /pets/i);
});

test("generateTheoReply: showing request asks for timing instead of human handoff", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "Can I tour the first one?",
    source: "sms",
    properties: [property()],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_showing_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /what day and time/i);
});

test("generateTheoReply: comparison question ranks saved listings", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "Which one is cheapest?",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [
      property({ address: "6814 Old Quarry Ln", price: "1703 per month" }),
      property({ address: "8600 N Fm 620 APT 1841", price: "1643 per month" }),
      property({ address: "8330 Fathom Cir APT 702", price: "1900 per month" }),
    ],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_comparison_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /Lowest listed price/i);
  assert.ok(result.reply.indexOf("8600 N Fm 620 APT 1841") < result.reply.indexOf("6814 Old Quarry Ln"));
});

test("generateTheoReply: fair housing sensitive property question still hands off", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "Is this a safe neighborhood with good schools?",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [property()],
  }));

  assert.equal(result.status, "needs_human");
  assert.equal(result.aiAction, "handoff_reply_ready");
  assert.match(result.handoffReason, /Fair Housing/i);
});

test("generateTheoReply: greeting does not hand off when LLM is unavailable", async () => {
  const result = await withoutOpenAi(() => generateTheoReply({
    message: "hi",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [],
  }));

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "general_lead_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /area, budget, and bedroom count/i);
});
