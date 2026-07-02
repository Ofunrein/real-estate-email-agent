import { test } from "node:test";
import assert from "node:assert/strict";

import { detectConversationScenario, sharedBrainInstruction } from "@/lib/conversationPlaybooks";
import { advancedQualificationPlaybook, qualificationScenarioHint } from "@/lib/qualificationPlaybooks";

test("qualificationScenarioHint detects dual sell and buy move", () => {
  assert.equal(
    qualificationScenarioHint("My wife and I are selling our place and moving to Akron area"),
    "dual_move_sell_and_buy",
  );
});

test("detectConversationScenario: dual move keeps seller buyer tracks active", () => {
  const scenario = detectConversationScenario({
    message: "Hey my wife and I are moving to the area and selling our place in Lancaster",
  });

  assert.equal(scenario.id, "move_sell_buy");
  assert.ok(scenario.requiredContext.includes("current_property_address"));
  assert.ok(scenario.requiredContext.includes("target_buy_area"));
  assert.match(scenario.nextBestAction, /both tracks/i);
});

test("detectConversationScenario: represented seller guard wins", () => {
  const scenario = detectConversationScenario({
    message: "I am selling my home. We already have a Realtor lined up.",
  });

  assert.equal(scenario.id, "seller_realtor_guard");
  assert.match(scenario.nextBestAction, /Do not solicit/i);
});

test("advancedQualificationPlaybook covers seller, buyer, appointment, compliance boundaries", () => {
  const playbook = advancedQualificationPlaybook();

  assert.match(playbook, /Seller qualification/i);
  assert.match(playbook, /Buyer qualification/i);
  assert.match(playbook, /Dual move scenario/i);
  assert.match(playbook, /Realtor guard/i);
  assert.match(playbook, /Do not claim an appointment is scheduled until the booking tool\/calendar confirms/i);
  assert.match(playbook, /Sensitive boundary/i);
});

test("sharedBrainInstruction injects advanced qualification into every channel", () => {
  const scenario = detectConversationScenario({ message: "I need to sell my house and buy in Akron" });
  const instruction = sharedBrainInstruction({ channel: "instagram", scenario });

  assert.match(instruction, /Advanced buyer\/seller qualification playbook/i);
  assert.match(instruction, /Dual move scenario/i);
  assert.match(instruction, /max 420 chars/i);
});
