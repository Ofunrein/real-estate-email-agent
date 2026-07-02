import { test } from "node:test";
import assert from "node:assert/strict";

import { propertyEmbeddingText, vectorLiteral } from "@/lib/propertyEmbeddings";
import { retrievePropertiesForAgent } from "@/lib/propertyRetrieval";
import type { SheetRow } from "@/lib/sheetSchema";

function property(address: string, features = ""): SheetRow {
  return {
    address,
    price: "500000",
    beds: "3",
    baths: "2",
    city: "Austin",
    state: "TX",
    zip: "",
    description: "",
    neighborhood: "",
    property_type: "house",
    features,
    days_on_market: "",
    photo_url: "",
    sqft: "",
    year_built: "",
    status: "active",
    listing_url: "",
    agent_name: "",
    agent_email: "",
  };
}

test("propertyEmbeddingText: combines structured and descriptive property facts", () => {
  const text = propertyEmbeddingText(property("810 Ethel St", "modern kitchen natural light"));

  assert.match(text, /810 Ethel St/);
  assert.match(text, /3 beds/);
  assert.match(text, /2 baths/);
  assert.match(text, /modern kitchen natural light/);
  assert.equal(vectorLiteral([0.1, Number.NaN, 0.3]), "[0.1,0,0.3]");
});

test("retrievePropertiesForAgent: falls back to structured order when RAG is disabled", async () => {
  const rows = [property("A"), property("B")];
  const result = await retrievePropertiesForAgent("modern kitchen", 2, { enableRag: false }, {
    structured: async () => rows,
    embed: async () => {
      throw new Error("should not embed");
    },
    semantic: async () => [],
  });

  assert.deepEqual(result.map((row) => row.address), ["A", "B"]);
});

test("retrievePropertiesForAgent: reranks within the structured candidate pool", async () => {
  const rows = [
    property("Structured First"),
    property("Semantic First"),
    property("Third"),
  ];
  const result = await retrievePropertiesForAgent("modern kitchen", 2, { enableRag: true }, {
    structured: async () => rows,
    embed: async () => [0.1, 0.2, 0.3],
    semantic: async () => [
      { property: rows[1], distance: 0.01 },
      { property: rows[0], distance: 0.5 },
    ],
  });

  assert.deepEqual(result.map((row) => row.address), ["Semantic First", "Structured First"]);
});

test("retrievePropertiesForAgent: voice channel skips RAG unless explicitly enabled", async () => {
  let embedded = false;
  const rows = [property("A"), property("B")];
  const result = await retrievePropertiesForAgent("modern kitchen", 2, { channel: "voice" }, {
    structured: async () => rows,
    embed: async () => {
      embedded = true;
      return [0.1, 0.2, 0.3];
    },
    semantic: async () => [],
  });

  assert.equal(embedded, false);
  assert.deepEqual(result.map((row) => row.address), ["A", "B"]);
});

test("retrievePropertiesForAgent: imports missing properties when structured search is empty", async () => {
  let fallbackCalled = false;
  const imported = [property("Imported Apify Match")];
  const result = await retrievePropertiesForAgent("3 bed home in Austin under 500k", 2, { channel: "sms" }, {
    structured: async () => [],
    embed: async () => {
      throw new Error("should not embed empty structured results");
    },
    semantic: async () => [],
    fallback: async (_query, limit, options) => {
      fallbackCalled = true;
      assert.equal(limit, 2);
      assert.equal(options.channel, "sms");
      return imported;
    },
  });

  assert.equal(fallbackCalled, true);
  assert.deepEqual(result.map((row) => row.address), ["Imported Apify Match"]);
});

test("retrievePropertiesForAgent: does not import missing properties for voice by default", async () => {
  let fallbackCalled = false;
  const result = await retrievePropertiesForAgent("3 bed home in Austin under 500k", 2, { channel: "voice" }, {
    structured: async () => [],
    embed: async () => null,
    semantic: async () => [],
    fallback: async () => {
      fallbackCalled = true;
      return [property("Should Not Import")];
    },
  });

  assert.equal(fallbackCalled, false);
  assert.deepEqual(result, []);
});

test("retrievePropertiesForAgent: does not import when structured results exist", async () => {
  let fallbackCalled = false;
  const result = await retrievePropertiesForAgent("modern kitchen", 2, { channel: "instagram", enableRag: false }, {
    structured: async () => [property("Existing Match")],
    embed: async () => null,
    semantic: async () => [],
    fallback: async () => {
      fallbackCalled = true;
      return [property("Should Not Import")];
    },
  });

  assert.equal(fallbackCalled, false);
  assert.deepEqual(result.map((row) => row.address), ["Existing Match"]);
});
