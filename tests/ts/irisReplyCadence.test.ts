import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtmlEmailReply, classifyIrisEmailText, decideIrisEmailExecution } from "@/lib/irisEmail";
import type { SheetRow } from "@/lib/sheetSchema";

// Cadence: answer the human first, THEN show property cards. Every ordering assertion
// below compares indexOf positions rather than "contains", because a reply that leads
// with a card block and buries the answer underneath still passes a contains check.

function row(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    address: "9605 Corbe Dr",
    city: "Austin",
    state: "TX",
    zip: "78729",
    price: "385000",
    beds: "3",
    baths: "2",
    sqft: "1850",
    status: "Active",
    property_type: "Single Family",
    listing_url: "https://example.com/listing/9605-corbe-dr",
    photo_url: "https://example.com/img/9605.jpg",
    ...overrides,
  } as unknown as SheetRow;
}

function classifyFor(body: string, subject = "Looking for a home") {
  const message = { id: "cadence-1", threadId: "cadence-1", from: "Lead <lead@example.com>", subject, body };
  return { message, classification: classifyIrisEmailText(message) };
}

test("cadence: prose answer precedes the first property card", () => {
  const { classification } = classifyFor(
    "Hi, I am looking for a three bedroom in Austin under $400k. Can you help me find something?",
  );
  const draft = buildHtmlEmailReply("Happy to help with that search.", [row()], classification);

  const cardIndex = draft.html.indexOf("9605 Corbe Dr");
  const answerIndex = draft.html.indexOf("Happy to help");
  assert.ok(answerIndex >= 0, "expected the prose answer in the html body");
  assert.ok(cardIndex >= 0, "expected a property card for a property intent");
  assert.ok(answerIndex < cardIndex, "the answer must come before the property card, not after it");
});

test("cadence: sign-off comes after the cards, never between answer and cards", () => {
  const { classification } = classifyFor(
    "Do you have anything else similar to 9605 Corbe Dr? I would like to compare options.",
  );
  const draft = buildHtmlEmailReply("Here is what I have.", [row(), row({ address: "1204 Ridgemont Ln" })], classification);

  const cardIndex = draft.html.indexOf("9605 Corbe Dr");
  const signOff = draft.html.indexOf("<strong>Iris</strong>");
  assert.ok(cardIndex >= 0 && signOff >= 0);
  assert.ok(cardIndex < signOff, "sign-off must follow the property cards");
});

test("cadence: every card carries price, beds, baths and a listing link", () => {
  const { classification } = classifyFor("Tell me about 9605 Corbe Dr please.", "Re: 9605 Corbe Dr");
  const draft = buildHtmlEmailReply("Here are the details.", [row()], classification);

  for (const needle of ["385,000", "3", "2", "https://example.com/listing/9605-corbe-dr", "View listing"]) {
    assert.ok(draft.html.includes(needle), `card missing ${needle}`);
  }
});

test("cadence: no cards means no fabricated match claim", () => {
  const { classification } = classifyFor("I am looking for a three bedroom in Austin under $400k.");
  const draft = buildHtmlEmailReply("Let me look into that.", [], classification);

  assert.doesNotMatch(draft.html, /best matching options/i, "must not claim matches with zero cards");
  assert.doesNotMatch(draft.html, /property details from our inventory/i, "must not claim details with zero cards");
});

test("cadence: plain-text part keeps answer above property details", () => {
  const { classification } = classifyFor("Any three bedroom homes in Austin under $400k?");
  const draft = buildHtmlEmailReply("Happy to help with that search.", [row()], classification);

  const answerIndex = draft.text.indexOf("Happy to help");
  const detailsIndex = draft.text.indexOf("Property details:");
  assert.ok(answerIndex >= 0 && detailsIndex >= 0, "expected both parts in the plain text");
  assert.ok(answerIndex < detailsIndex, "plain text must answer before listing property details");
});

// Escalation split: the thing that must never regress is the DIRECTION of the
// decision. Auto-send where no human is needed; a complete draft where one is.

test("escalation: a human-review case still produces a sendable draft, not silence", () => {
  const { classification } = classifyFor(
    "My landlord is refusing to return my security deposit and I think it is illegal. What are my rights?",
    "Deposit dispute",
  );
  const execution = decideIrisEmailExecution(classification);

  assert.equal(classification.intent, "human_required", "legal question must classify as human_required");
  assert.equal(execution.canReply, false, "legal question must not auto-send");
  assert.equal(execution.aiAction, "draft_reply", "must still draft for the human, not go silent");
  assert.ok(execution.handoffReason, "must record why it escalated");
});

// The classifier already promotes a sensitive flag to human_required, so routing a
// sensitive case through classifyIrisEmailText tests the CLASSIFIER, not the execution
// gate. Hand decideIrisEmailExecution a flagged-but-otherwise-auto-sendable
// classification directly, so the defense-in-depth layer is what's under test.
for (const flag of ["fair_housing", "mortgage_license", "legal", "privacy", "prompt_injection", "broker_approval"]) {
  test(`escalation: sensitive flag "${flag}" blocks auto-send even on a property intent`, () => {
    const { classification } = classifyFor(
      "Hi, is 9605 Corbe Dr still available and what is the asking price?",
      "Re: 9605 Corbe Dr",
    );
    assert.equal(decideIrisEmailExecution(classification).canReply, true, "control: clean version must auto-send");

    const flagged = { ...classification, compliance_flags: [flag] };
    const execution = decideIrisEmailExecution(flagged);

    assert.equal(execution.canReply, false, `${flag} must block auto-send at the execution gate`);
    assert.equal(execution.aiAction, "draft_reply", "must still leave the human a draft");
    assert.deepEqual(execution.labels, ["NEEDS_HUMAN"], "must be labelled for human review");
  });
}

test("escalation: plain property question auto-sends with no human in the loop", () => {
  const { classification } = classifyFor(
    "Hi, is 9605 Corbe Dr still available and what is the asking price?",
    "Re: 9605 Corbe Dr",
  );
  const execution = decideIrisEmailExecution(classification);

  assert.equal(execution.canReply, true, "a simple availability question should auto-send");
  assert.equal(execution.handoffReason, "", "auto-send must not carry a handoff reason");
});
