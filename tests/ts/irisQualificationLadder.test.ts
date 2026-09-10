import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtmlEmailReply, classifyIrisEmailText, decideIrisEmailExecution, generateIrisEmailReply } from "@/lib/irisEmail";
import type { SheetRow } from "@/lib/sheetSchema";

// The qualification ladder has four rungs and they are ordered:
//
//   1. answer      — respond to the question actually asked
//   2. qualify     — ask the second-time-buyer / valuation question
//   3. confirm     — acknowledge their answer ("thanks for confirming")
//   4. book        — only now hand over the booking link
//
// The failure mode these tests exist to catch is a rung being SKIPPED, specifically
// rung 4 arriving early: a booking link on a cold first inquiry is the same bug as
// no booking link at all, and a test that only asserts "link present somewhere"
// passes trivially in both directions. So each rung asserts a positive AND the
// absence of the rung that must not have fired yet.

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

// classifyIrisEmailText reads ONLY subject + body, and splits the body on the exact
// marker "Thread context for classification only:" (lib/irisEmail.ts:287) to separate
// the latest message from prior thread state. Passing a separate context field, or
// faking context as a quoted ">" reply, is silently ignored and yields a contextless
// classification — which is how three of these tests first passed for the wrong reason.
const THREAD_CONTEXT_MARKER = "Thread context for classification only:";

function classifyFor(body: string, subject = "Property inquiry", context = "") {
  const fullBody = context ? `${body}\n\n${THREAD_CONTEXT_MARKER}\n${context}` : body;
  const message = {
    id: "ladder-1",
    threadId: "ladder-1",
    from: "Lead <lead@example.com>",
    subject,
    body: fullBody,
  };
  return { message, classification: classifyIrisEmailText(message) };
}

const BOOKING_RE = /(?:calendly|fillout|book(?:ing)?\s+link|schedule[^<]{0,20}(?:call|valuation)|https?:\/\/[^\s"']*(?:calendly|fillout)[^\s"']*)/i;

// ---------------------------------------------------------------- rung 1: answer

test("ladder rung 1: a cold inquiry gets answered, not immediately booked", () => {
  const { classification } = classifyFor(
    "Hi, when is the next viewing for 9605 Corbe Dr? I saw it listed this week.",
    "Re: 9605 Corbe Dr",
  );

  assert.equal(classification.recommended_next_action, "reply_and_qualify",
    "a first-touch question must route to reply_and_qualify, never straight to send_booking_link");
  assert.ok(!classification.opportunity_tags.includes("valuation_consented"),
    "nothing has been consented to on a cold first inquiry");
});

test("ladder rung 1 negative control: the answer is not replaced by the qualifier", () => {
  const { classification } = classifyFor(
    "When is the next viewing for 9605 Corbe Dr?",
    "Re: 9605 Corbe Dr",
  );
  const draft = buildHtmlEmailReply("The next viewing is Saturday at 11am.", [row()], classification);

  const answerIndex = draft.html.indexOf("next viewing is Saturday");
  assert.ok(answerIndex >= 0, "the substantive answer must survive into the reply body");
  // If a qualifier is present it must come AFTER the answer, not instead of it.
  const valuationIndex = draft.html.search(/valuation/i);
  if (valuationIndex >= 0) {
    assert.ok(answerIndex < valuationIndex,
      "the qualifying question must follow the answer, not pre-empt it");
  }
});

// --------------------------------------------------------------- rung 2: qualify

test("ladder rung 2: a second-time buyer is asked the valuation question", () => {
  const { classification } = classifyFor(
    "I am looking at 9605 Corbe Dr. I currently own a home in Round Rock that I would need to deal with.",
    "Re: 9605 Corbe Dr",
  );

  assert.equal(classification.primary_lead_role, "second_time_buyer",
    "owning a current property makes this a second_time_buyer");
  assert.ok(classification.opportunity_tags.includes("sell_before_buy"),
    "sell_before_buy must be tagged so the valuation path is reachable");
  assert.ok(!classification.opportunity_tags.includes("valuation_consented"),
    "merely BEING a second-time buyer is not consent to a valuation");
});

test("ladder rung 2 negative control: the qualifier does not leak a booking link", () => {
  const { classification } = classifyFor(
    "Interested in 9605 Corbe Dr. I already own a place I would need to sell first.",
    "Re: 9605 Corbe Dr",
  );
  const draft = buildHtmlEmailReply("Happy to help with both sides of that.", [row()], classification);

  assert.ok(!classification.opportunity_tags.includes("valuation_consented"));
  assert.ok(!BOOKING_RE.test(draft.html),
    "rung 4 must not fire at rung 2 — no booking link before the lead confirms");
});

// --------------------------------------------------------------- rung 3: confirm

test("ladder rung 3: consent produces an acknowledgement before the handoff", () => {
  const { message, classification } = classifyFor(
    "Yes please, I would like the free valuation of my current property.",
    "Re: 9605 Corbe Dr",
    "Current property status: owns. second_time_buyer",
  );

  assert.ok(classification.opportunity_tags.includes("valuation_consented"),
    "an explicit yes to the valuation must register as consent");

  // The ladder copy is produced by generateIrisEmailReply, not buildHtmlEmailReply.
  // buildHtmlEmailReply only wraps a body it is handed, so asserting rung 3 against it
  // with an empty body passes an empty shell and proves nothing.
  const body = generateIrisEmailReply(message, classification);
  assert.ok(body, "expected a reply body for a consented second-time buyer");
  assert.match(body, /thanks for confirming/i,
    "rung 3 must acknowledge the confirmation rather than jumping silently to the link");
});

test("ladder rung 3: consent without second-time-buyer context does not self-promote", () => {
  // "yes ... valuation" from someone with no ownership context must NOT be treated
  // as a consented valuation — otherwise any stray "yes" unlocks rung 4.
  const { classification } = classifyFor(
    "Yes, sounds good.",
    "Re: 9605 Corbe Dr",
  );

  assert.ok(!classification.opportunity_tags.includes("valuation_consented"),
    "a bare yes with no valuation context must not count as consent");
  assert.notEqual(classification.recommended_next_action, "send_booking_link",
    "a bare yes must not unlock the booking rung");
});

// ------------------------------------------------------------------ rung 4: book

test("ladder rung 4: confirmed consent routes to the booking link", () => {
  const { classification } = classifyFor(
    "Yes, I would like to book the valuation for my current property.",
    "Re: valuation",
    "Current property status: owns. second_time_buyer",
  );

  assert.ok(classification.opportunity_tags.includes("valuation_consented"));
  assert.equal(classification.recommended_next_action, "send_booking_link",
    "consent plus ownership context is the only state that earns the booking rung");
});

test("ladder rung 4: an explicit showing request may book directly", () => {
  // Not every path climbs all four rungs — asking for a showing IS the booking ask.
  const { classification } = classifyFor(
    "Can I tour 9605 Corbe Dr this Saturday at 2pm?",
    "Re: 9605 Corbe Dr",
  );

  assert.equal(classification.intent, "showing_request");
  assert.equal(classification.recommended_next_action, "send_booking_link",
    "a direct showing request is itself the booking rung");
});

// ----------------------------------------------------- ordering across the ladder

test("ladder ordering: confirm precedes the booking handoff in the rendered reply", () => {
  const { message, classification } = classifyFor(
    "Yes please, book me in for the valuation.",
    "Re: valuation",
    "Current property status: owns. second_time_buyer",
  );
  const body = generateIrisEmailReply(message, classification);
  assert.ok(body, "expected a reply body");

  const confirmIndex = body.search(/thanks for confirming/i);
  assert.ok(confirmIndex >= 0, "expected the rung 3 acknowledgement");

  const bookingIndex = body.search(BOOKING_RE);
  if (bookingIndex >= 0) {
    assert.ok(confirmIndex < bookingIndex,
      "the acknowledgement must precede the booking link, not trail it");
  }
});

test("ladder gate: a sensitive flag outranks every rung, including a confirmed booking", () => {
  // Even at rung 4 with valid consent, a compliance flag must stop the send. This is
  // asserted at the execution gate rather than the classifier so it survives a
  // classifier change that stops promoting flagged mail on its own.
  const { message, classification } = classifyFor(
    "Yes, book the valuation. Also, is this a good neighbourhood for a family like mine?",
    "Re: valuation",
    "Current property status: owns. second_time_buyer",
  );

  const decision = decideIrisEmailExecution({
    ...classification,
    canReply: true,
    sensitive_flags: ["fair_housing"],
  } as never, message as never);

  assert.ok(!decision.autoSend,
    "a fair_housing flag must block auto-send even with a fully climbed ladder");
});
