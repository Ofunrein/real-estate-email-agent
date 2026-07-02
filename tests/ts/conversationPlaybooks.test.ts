import { test } from "node:test";
import assert from "node:assert/strict";

import { channelTone, detectConversationScenario, sharedBrainInstruction } from "@/lib/conversationPlaybooks";

test("detectConversationScenario: seller valuation with photo requires AVM and calendar context", () => {
  const scenario = detectConversationScenario({
    event: { message_text: "412 Maple Ave, what's it worth?\nMMS image: https://cdn.example.com/front.png" },
  });
  assert.equal(scenario.id, "seller_valuation");
  assert.ok(scenario.requiredContext.includes("avm_or_comp_lookup"));
  assert.ok(scenario.requiredContext.includes("calendar_availability"));
});

test("detectConversationScenario: shared reel/photo maps to media reference search", () => {
  const scenario = detectConversationScenario({
    event: { message_text: "I want something similar to this reel", media_json: JSON.stringify([{ type: "video" }]) },
  });
  assert.equal(scenario.id, "shared_media_reference");
  assert.ok(scenario.requiredContext.includes("media_understanding"));
});

test("sharedBrainInstruction: channel-specific concise social guidance", () => {
  const scenario = detectConversationScenario({ message: "Is Cedar Lane still on market and what's the price?" });
  const instruction = sharedBrainInstruction({ channel: "instagram", scenario });
  assert.equal(scenario.id, "buyer_listing_details");
  assert.match(instruction, /Short DM/);
  assert.equal(channelTone("email").allowBullets, true);
});
