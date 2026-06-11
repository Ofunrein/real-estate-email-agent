import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lookupPropertyForVoice,
  propertySmsBody,
  searchPropertiesForVoice,
  speakProperty,
  speakSearchResults,
  type AriaDataDeps,
} from "@/lib/ariaData";
import type { SheetRow } from "@/lib/sheetSchema";

function property(partial: Partial<SheetRow>): SheetRow {
  return {
    address: "",
    price: "",
    beds: "",
    baths: "",
    sqft: "",
    neighborhood: "",
    city: "",
    listing_url: "",
    ...partial,
  } as SheetRow;
}

test("speakProperty: natural spoken sentence, no markdown", () => {
  const spoken = speakProperty(property({ address: "123 Main St", price: "450000", beds: "3", baths: "2", sqft: "1800", neighborhood: "Mueller" }));
  assert.equal(spoken, "123 Main St is listed at $450,000, 3 bed, 2 bath, 1,800 square feet, in Mueller.");
});

test("speakProperty: partial data still readable", () => {
  const spoken = speakProperty(property({ address: "9 Oak Dr", city: "Austin" }));
  assert.match(spoken, /9 Oak Dr/);
});

test("propertySmsBody: includes address, facts, link", () => {
  const body = propertySmsBody(property({ address: "123 Main St", price: "450000", beds: "3", baths: "2", listing_url: "https://z/123" }));
  assert.match(body, /123 Main St/);
  assert.match(body, /\$450,000/);
  assert.match(body, /https:\/\/z\/123/);
});

function deps(overrides: Partial<AriaDataDeps>): AriaDataDeps {
  return {
    findByAddresses: async () => [],
    enrich: async () => ({ properties: [], context: "" }),
    cacheProperty: async () => null,
    sendSms: async () => undefined,
    budgetMs: 50,
    ...overrides,
  };
}

test("lookupPropertyForVoice: enrichment wins inside budget", async () => {
  let cached = false;
  const result = await lookupPropertyForVoice(
    { address: "123 Main St", phone: "+15125550000" },
    deps({
      findByAddresses: async () => [],
      enrich: async () => ({
        properties: [property({ address: "123 Main St", price: "450000", beds: "3", baths: "2" })],
        context: "live",
      }),
      cacheProperty: async (p) => {
        cached = true;
        return p as SheetRow;
      },
      budgetMs: 1000,
    }),
  );
  assert.equal(result.timedOut, false);
  assert.match(result.spoken, /\$450,000/);
  assert.equal(cached, true, "fresh property cached");
});

test("lookupPropertyForVoice: uses lead memory to correct STT-misheard address", async () => {
  const calls: string[] = [];
  const result = await lookupPropertyForVoice(
    {
      address: "4309 Fairwood Avenue",
      phone: "+15558675310",
      lead: { property_interest: "4309 Fairway Path" },
    },
    deps({
      findByAddresses: async (addresses) => {
        calls.push(addresses[0]);
        if (addresses[0] === "4309 Fairwood Avenue") {
          return [property({ address: "4309 Fairwood Avenue caller asked for details" })];
        }
        if (addresses[0] === "4309 Fairway Path") {
          return [property({ address: "4309 Fairway Path", price: "407800", beds: "4", baths: "2.5", sqft: "2702", city: "Round Rock" })];
        }
        return [];
      },
      enrich: async ({ properties }) => ({ properties: properties || [], context: "" }),
      budgetMs: 1000,
    }),
  );
  assert.equal(result.timedOut, false);
  assert.match(result.spoken, /4309 Fairway Path/);
  assert.match(result.spoken, /\$407,800/);
  assert.ok(calls.includes("4309 Fairway Path"), "lead-memory correction was searched");
});

test("lookupPropertyForVoice: filters junk property rows and asks for confirmation", async () => {
  let cached = false;
  const result = await lookupPropertyForVoice(
    { address: "4309 Fairwood Avenue", phone: "+15558675310" },
    deps({
      findByAddresses: async () => [property({ address: "4309 Fairwood Avenue caller asked for details" })],
      enrich: async () => ({ properties: [property({ address: "4309 Fairwood Avenue caller asked for details" })], context: "" }),
      cacheProperty: async () => {
        cached = true;
        return null;
      },
      budgetMs: 1000,
    }),
  );
  assert.equal(result.properties.length, 0);
  assert.equal(cached, false, "junk row was not cached");
  assert.match(result.spoken, /confirm the full street address and city/i);
  assert.doesNotMatch(result.spoken, /caller asked/i);
});

test("lookupPropertyForVoice: timeout speaks cache + schedules SMS", async () => {
  let smsSentTo = "";
  let smsBody = "";
  const result = await lookupPropertyForVoice(
    { address: "123 Main St", phone: "+15125550000" },
    deps({
      findByAddresses: async () => [property({ address: "123 Main St", price: "400000", beds: "2", baths: "1" })],
      enrich: () => new Promise((resolve) => setTimeout(() => resolve({
        properties: [property({ address: "123 Main St", price: "455000", beds: "3", baths: "2", listing_url: "https://z/1" })],
        context: "late",
      }), 30)),
      sendSms: async (to, body) => {
        smsSentTo = to;
        smsBody = body;
      },
      budgetMs: 5,
    }),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.fromCache, true);
  assert.match(result.spoken, /text you the full details/);
  // let the background enrichment + SMS resolve
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(smsSentTo, "+15125550000");
  assert.match(smsBody, /455,000/);
});

test("lookupPropertyForVoice: timeout, no cache, no phone -> graceful", async () => {
  const result = await lookupPropertyForVoice(
    { address: "5 Elm St" },
    deps({
      findByAddresses: async () => [],
      enrich: () => new Promise((resolve) => setTimeout(() => resolve({ properties: [], context: "" }), 30)),
      budgetMs: 5,
    }),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.fromCache, false);
  assert.match(result.spoken, /5 Elm St/);
});

test("lookupPropertyForVoice: empty address asks for one", async () => {
  const result = await lookupPropertyForVoice({ address: "" }, deps({}));
  assert.match(result.spoken, /address/i);
});

test("speakSearchResults: lists up to 3 options with a question", () => {
  const spoken = speakSearchResults([
    property({ address: "1 A St", price: "400000", beds: "3", baths: "2", neighborhood: "Mueller" }),
    property({ address: "2 B Ave", price: "450000", beds: "4", baths: "3", city: "Austin" }),
  ]);
  assert.match(spoken, /I found 2 options/);
  assert.match(spoken, /1\. 1 A St/);
  assert.match(spoken, /2\. 2 B Ave/);
  assert.match(spoken, /Want details/);
});

test("speakSearchResults: empty offers a follow-up", () => {
  assert.match(speakSearchResults([]), /follow up/i);
});

test("searchPropertiesForVoice: builds criteria and speaks matches", async () => {
  let received: unknown = null;
  const result = await searchPropertiesForVoice(
    { area: "Mueller", beds: 3, maxPrice: 500000 },
    {
      findCandidates: async (criteria) => {
        received = criteria;
        return [property({ address: "1 A St", price: "450000", beds: "3", baths: "2", neighborhood: "Mueller" })];
      },
      enrich: async () => ({ properties: [], context: "" }),
      cacheProperty: async () => null,
      sendSms: async () => undefined,
      budgetMs: 1,
    },
  );
  assert.match(result.spoken, /1 A St/);
  assert.equal((received as { beds?: number }).beds, 3);
  assert.equal((received as { maxPrice?: number }).maxPrice, 500000);
});

test("searchPropertiesForVoice: enrichment can win and be cached", async () => {
  let cached = 0;
  const result = await searchPropertiesForVoice(
    { query: "4 bed near Austin", beds: 4 },
    {
      findCandidates: async () => [],
      enrich: async () => ({
        properties: [property({ address: "9 Fresh St", price: "550000", beds: "4", baths: "3", neighborhood: "Austin" })],
        context: "fresh",
      }),
      cacheProperty: async () => {
        cached += 1;
        return null;
      },
      sendSms: async () => undefined,
      budgetMs: 1000,
    },
  );
  assert.equal(result.timedOut, false);
  assert.equal(result.fromCache, false);
  assert.match(result.spoken, /9 Fresh St/);
  assert.equal(cached, 1);
});

test("searchPropertiesForVoice: timeout speaks cache and texts fresh results", async () => {
  let smsBody = "";
  const result = await searchPropertiesForVoice(
    { area: "Austin", beds: 4, phone: "+15125550000" },
    {
      findCandidates: async () => [property({ address: "1 Cached St", price: "500000", beds: "4", baths: "2" })],
      enrich: () => new Promise((resolve) => setTimeout(() => resolve({
        properties: [property({ address: "2 Fresh Ave", price: "540000", beds: "4", baths: "3", listing_url: "https://z/2" })],
        context: "fresh",
      }), 30)),
      cacheProperty: async () => null,
      sendSms: async (_to, body) => {
        smsBody = body;
      },
      budgetMs: 5,
    },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.fromCache, true);
  assert.match(result.spoken, /1 Cached St/);
  assert.match(result.spoken, /text them/);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(smsBody, /2 Fresh Ave/);
  assert.match(smsBody, /https:\/\/z\/2/);
});
