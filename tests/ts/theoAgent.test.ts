import { test } from "node:test";
import assert from "node:assert/strict";

import { generateTheoReply } from "@/lib/theoAgent";
import type { SheetRow } from "@/lib/sheetSchema";

test("generateTheoReply: ordinal property detail follow-up does not hand off", async () => {
  const priorOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await generateTheoReply({
    message: "The first one tell me more about it",
    source: "sms",
    lead: { phone: "+15125712595" },
    properties: [{
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
    } as SheetRow],
  });

  if (priorOpenAiKey == null) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = priorOpenAiKey;

  assert.equal(result.status, "ready_to_reply");
  assert.equal(result.aiAction, "property_details_reply_ready");
  assert.equal(result.handoffReason, "");
  assert.match(result.reply, /6814 Old Quarry Ln/);
  assert.match(result.reply, /\$1,703 per month/);
  assert.match(result.reply, /book a showing/);
});
