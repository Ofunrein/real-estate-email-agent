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
  assert.equal(result.aiAction, "property_details_reply_ready");
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
