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

async function waitFor(check: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("speakProperty: natural spoken sentence, no markdown", () => {
  const spoken = speakProperty(property({ address: "123 Main St", price: "450000", beds: "3", baths: "2", sqft: "1800", neighborhood: "Mueller" }));
  assert.equal(spoken, "one two three Main St is listed at $450,000, 3 bed, 2 bath, 1,800 square feet, in Mueller.");
});

test("speakProperty: partial data still readable", () => {
  const spoken = speakProperty(property({ address: "9 Oak Dr", city: "Austin" }));
  assert.match(spoken, /nine Oak Dr/);
});

test("propertySmsBody: includes address, facts, link", () => {
  const body = propertySmsBody(property({ address: "123 Main St", price: "450000", beds: "3", baths: "2", listing_url: "https://z/123" }));
  assert.match(body, /123 Main St/);
  assert.match(body, /\$450,000/);
  assert.match(body, /https:\/\/z\/123/);
});

test("propertySmsBody: uses configured AI search link when property id is available", () => {
  const originalBase = process.env.NEXT_PUBLIC_AI_SEARCH_BASE_URL;
  const originalTenant = process.env.AI_SEARCH_TENANT_ID;
  const originalMls = process.env.AI_SEARCH_MLS_OSN;
  process.env.NEXT_PUBLIC_AI_SEARCH_BASE_URL = "https://search.austinrealty.example";
  process.env.AI_SEARCH_TENANT_ID = "YQxX9erMaCPdeBOYthLK";
  process.env.AI_SEARCH_MLS_OSN = "Austin";
  try {
    const body = propertySmsBody(property({
      address: "3401 Neal ST B",
      price: "599900",
      beds: "2",
      baths: "2",
      property_id: "5013978221052957045",
      listing_url: "https://www.zillow.com/homedetails/old",
    }));

    assert.match(body, /https:\/\/search\.austinrealty\.example\/property\/5013978221052957045/);
    assert.match(body, /tenant_id=YQxX9erMaCPdeBOYthLK/);
    assert.match(body, /mls_osn=Austin/);
    assert.doesNotMatch(body, /zillow\.com/);
  } finally {
    if (originalBase == null) delete process.env.NEXT_PUBLIC_AI_SEARCH_BASE_URL;
    else process.env.NEXT_PUBLIC_AI_SEARCH_BASE_URL = originalBase;
    if (originalTenant == null) delete process.env.AI_SEARCH_TENANT_ID;
    else process.env.AI_SEARCH_TENANT_ID = originalTenant;
    if (originalMls == null) delete process.env.AI_SEARCH_MLS_OSN;
    else process.env.AI_SEARCH_MLS_OSN = originalMls;
  }
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
  assert.match(result.spoken, /four three zero nine Fairway Path/);
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
  // let the background enrichment + SMS resolve under the concurrent test runner
  await waitFor(() => Boolean(smsBody));
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
  assert.match(spoken, /1\. one A St/);
  assert.match(spoken, /2\. two B Ave/);
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
  assert.match(result.spoken, /one A St/);
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
  assert.match(result.spoken, /nine Fresh St/);
  assert.equal(cached, 1);
});

test("searchPropertiesForVoice: timeout speaks cache and texts fresh results", async () => {
  let smsBody = "";
  let resolveFresh!: (value: { properties: SheetRow[]; context: string }) => void;
  const freshResults = new Promise<{ properties: SheetRow[]; context: string }>((resolve) => {
    resolveFresh = resolve;
  });
  const keepAlive = setTimeout(() => undefined, 100);
  let result: Awaited<ReturnType<typeof searchPropertiesForVoice>>;
  try {
    result = await searchPropertiesForVoice(
      { area: "Austin", beds: 4, phone: "+15125550000" },
      {
        findCandidates: async () => [property({ address: "1 Cached St", price: "500000", beds: "4", baths: "2" })],
        enrich: () => freshResults,
        cacheProperty: async () => null,
        sendSms: async (_to, body) => {
          smsBody = body;
        },
        budgetMs: 1,
      },
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(result.timedOut, true);
  assert.equal(result.fromCache, true);
  assert.match(result.spoken, /one Cached St/);
  assert.match(result.spoken, /text the links/);
  resolveFresh({
    properties: [property({ address: "2 Fresh Ave", price: "540000", beds: "4", baths: "3", listing_url: "https://z/2" })],
    context: "fresh",
  });
  await waitFor(() => Boolean(smsBody));
  assert.match(smsBody, /2 Fresh Ave/);
  assert.match(smsBody, /https:\/\/z\/2/);
});

test("searchPropertiesForVoice: no matches asks for search criteria instead of deferring to text", async () => {
  const result = await searchPropertiesForVoice(
    { query: "what properties do you have available" },
    {
      findCandidates: async () => [],
      enrich: () => new Promise((resolve) => setTimeout(() => resolve({ properties: [], context: "" }), 30)),
      cacheProperty: async () => null,
      sendSms: async () => undefined,
      budgetMs: 5,
    },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.properties.length, 0);
  assert.match(result.spoken, /saved property database/);
  assert.match(result.spoken, /area, budget, or bedroom count/);
  assert.doesNotMatch(result.spoken, /text/i);
});
