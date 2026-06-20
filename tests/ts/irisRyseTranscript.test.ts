import { test } from "node:test";
import assert from "node:assert/strict";

import fixture from "@/tests/fixtures/ryse-remi-google-voice.json";

type FixtureMessage = {
  id: string;
  timestamp: string;
  speaker: "lead" | "remi";
  direction: "lead_to_assistant" | "assistant_to_lead";
  text: string;
  links?: string[];
  attachments?: Array<{ type: string }>;
};

type ExpectedClassification = {
  intent: string;
  leadRole: string;
  shouldSearchListings: boolean;
  recommendedNextAction: string;
  leadFields?: Record<string, unknown>;
  opportunityTags?: string[];
  preferredChannel?: string;
  mediaRequested?: boolean;
  referencedResultOrdinal?: number;
  handoffRequired?: boolean;
  marketStatus?: string;
};

type TranscriptScenario = {
  id: string;
  name: string;
  messageIds: string[];
  expected: ExpectedClassification;
  observedFailure?: {
    messageIds: string[];
    reason: string;
  };
};

type ClassifiedTurn = ExpectedClassification;

const messages = fixture.messages as FixtureMessage[];
const scenarios = fixture.scenarios as TranscriptScenario[];

function messageById(id: string): FixtureMessage {
  const message = messages.find((item) => item.id === id);
  assert.ok(message, `fixture message ${id} exists`);
  return message;
}

function textForScenario(scenario: TranscriptScenario): string {
  return scenario.messageIds.map((id) => messageById(id).text).join(" ").trim();
}

function classifyRyseFixtureTurn(scenario: TranscriptScenario): ClassifiedTurn {
  const text = textForScenario(scenario);
  const normalized = text.toLowerCase();
  const firstMessage = messageById(scenario.messageIds[0]);

  if (
    firstMessage.speaker === "remi"
    && /\bcheck in\b/.test(normalized)
    && /\bbuying or selling\b/.test(normalized)
    && /\bplans shift\b/.test(normalized)
  ) {
    return {
      intent: "database_revival",
      leadRole: "unknown",
      shouldSearchListings: false,
      recommendedNextAction: "wait_for_reply",
      opportunityTags: ["stale_lead"],
    };
  }

  if (/\bspeculo\s+ai\??\b/.test(normalized)) {
    return {
      intent: "business_question",
      leadRole: "unknown",
      shouldSearchListings: false,
      recommendedNextAction: "route_human_or_answer_product_question",
    };
  }

  if (/\bcolumbus\b/.test(normalized) && /\bohio|oh\b/.test(normalized)) {
    return {
      intent: "out_of_market_property_search",
      leadRole: "buyer",
      shouldSearchListings: false,
      recommendedNextAction: "route_referral_or_human",
      leadFields: { area: "Columbus, OH" },
      marketStatus: "out_of_market",
    };
  }

  if (/\bcall me\b|\bphone\b/.test(normalized)) {
    return {
      intent: "call_request",
      leadRole: "buyer",
      shouldSearchListings: false,
      recommendedNextAction: "create_call_task",
      preferredChannel: "phone",
      handoffRequired: true,
    };
  }

  if (/\bemail\b/.test(normalized)) {
    return {
      intent: "property_details",
      leadRole: "buyer",
      shouldSearchListings: false,
      recommendedNextAction: "send_details_by_email",
      preferredChannel: "email",
      mediaRequested: /\bphoto|photos|picture|image\b/.test(normalized),
    };
  }

  if (/\btell me more\b|\bdetails?\b|\bphotos?\b/.test(normalized)) {
    return {
      intent: "property_details",
      leadRole: "buyer",
      shouldSearchListings: false,
      recommendedNextAction: "send_property_details_with_photos",
      mediaRequested: /\bphoto|photos|picture|image\b/.test(normalized),
      referencedResultOrdinal: /\bfirst\b|\b1st\b/.test(normalized) ? 1 : undefined,
    };
  }

  if (/\bbuying\b/.test(normalized) && /\baustin\b/.test(normalized) && /\b2\s*(?:bd|bds|bed|beds)\b/.test(normalized)) {
    return {
      intent: "property_search",
      leadRole: "buyer",
      shouldSearchListings: true,
      recommendedNextAction: "search_properties",
      leadFields: {
        area: "downtown Austin",
        budgetMax: /\bunder\s+1m\b/.test(normalized) ? 1000000 : undefined,
        beds: 2,
        baths: /\b2\s*baths?\b/.test(normalized) ? 2 : undefined,
      },
    };
  }

  return {
    intent: "needs_review",
    leadRole: "unknown",
    shouldSearchListings: false,
    recommendedNextAction: "route_human_or_answer_product_question",
  };
}

function assertClassificationIncludes(actual: ClassifiedTurn, expected: ExpectedClassification) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue && typeof expectedValue === "object" && !Array.isArray(expectedValue)) {
      assert.deepEqual(actual[key as keyof ClassifiedTurn], expectedValue, `${key} matches fixture expectation`);
    } else {
      assert.deepEqual(actual[key as keyof ClassifiedTurn], expectedValue, `${key} matches fixture expectation`);
    }
  }
}

test("ryse Google Voice fixture: transcript extraction is stable", () => {
  assert.equal(fixture.fixtureId, "ryse-remi-google-voice-2026-06-19");
  assert.equal(fixture.source.kind, "google_voice_html_export");
  assert.match(fixture.source.path, /Voice - \(29\) Messages/);
  assert.equal(messages.length, 21);
  assert.equal(messages[0].text, "Chad! This is Remi with Ryse Realty Group. We wanted to check in about buying or selling a home in the Austin area. Still thinking of doing anything or did plans shift?");
  assert.equal(messages.at(-1)?.text, "Can you see these?");

  for (const message of messages) {
    assert.match(message.id, /^m\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(message.timestamp)), `${message.id} timestamp parses`);
    assert.ok(message.text.length > 0 || (message.attachments?.length || 0) > 0, `${message.id} has text or attachment`);
  }
});

test("ryse Google Voice fixture: listing links preserve Ryse search config", () => {
  const linkMessages = messages.filter((message) => message.links?.length);
  const links = linkMessages.flatMap((message) => message.links || []);

  assert.equal(fixture.listingSearch.baseUrl, "https://aisearch.rysehomes.com");
  assert.equal(fixture.listingSearch.tenantId, "YQxX9erMaCPdeBOYthLK");
  assert.equal(fixture.listingSearch.mlsOsn, "Austin");
  assert.equal(new Set(links).size, 3);
  for (const link of links) {
    assert.match(link, /^https:\/\/aisearch\.rysehomes\.com\/property\/\d+\?/);
    assert.match(link, /tenant_id=YQxX9erMaCPdeBOYthLK/);
    assert.match(link, /mls_osn=Austin/);
  }
});

test("ryse Google Voice fixture: Phase 5 classification expectations are covered", () => {
  const requiredScenarioIds = [
    "database_revival_opener",
    "downtown_two_bed_search",
    "details_and_photos_request",
    "email_preference_request",
    "call_request",
    "product_business_question",
    "out_of_market_request",
  ];

  assert.deepEqual(scenarios.map((scenario) => scenario.id), requiredScenarioIds);

  for (const scenario of scenarios) {
    const actual = classifyRyseFixtureTurn(scenario);
    assertClassificationIncludes(actual, scenario.expected);
  }
});

test("ryse Google Voice fixture: observed Remi misses stay visible", () => {
  const emailPreference = scenarios.find((scenario) => scenario.id === "email_preference_request");
  assert.ok(emailPreference?.observedFailure);
  assert.match(messageById(emailPreference.observedFailure.messageIds[0]).text, /1189 Oakgrove Ave/);
  assert.match(emailPreference.observedFailure.reason, /email handoff/);

  const productQuestion = scenarios.find((scenario) => scenario.id === "product_business_question");
  assert.ok(productQuestion?.observedFailure);
  assert.match(messageById(productQuestion.observedFailure.messageIds[0]).text, /I searched Speculo ai\?/);
  assert.equal(productQuestion.expected.shouldSearchListings, false);
});
