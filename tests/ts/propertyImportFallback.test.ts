import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildApifySearchPayloadFromCriteria,
  normalizeApifyItemToProperty,
  propertyApifyFallbackEnabled,
  searchAndImportMissingProperties,
} from "@/lib/propertyImportFallback";

test("buildApifySearchPayloadFromCriteria: maps buyer criteria to guarded Zillow actor payload", () => {
  const payload = buildApifySearchPayloadFromCriteria({
    query: "need a 3 bed condo under 500k",
    area: "78704",
    beds: 3,
    maxPrice: 500000,
  }, 9);

  assert.deepEqual(payload, {
    country: "United States",
    location: "78704, TX",
    listing_type: "for_sale",
    max_results: 9,
    property_type: "condo",
  });
});

test("propertyApifyFallbackEnabled: requires explicit env flag and token", () => {
  const previousEnabled = process.env.PROPERTY_APIFY_FALLBACK_ENABLED;
  const previousToken = process.env.APIFY_TOKEN;
  const previousVoice = process.env.PROPERTY_APIFY_FALLBACK_VOICE_ENABLED;
  try {
    delete process.env.PROPERTY_APIFY_FALLBACK_ENABLED;
    delete process.env.APIFY_TOKEN;
    delete process.env.PROPERTY_APIFY_FALLBACK_VOICE_ENABLED;
    assert.equal(propertyApifyFallbackEnabled("sms"), false);
    process.env.PROPERTY_APIFY_FALLBACK_ENABLED = "true";
    assert.equal(propertyApifyFallbackEnabled("sms"), false);
    process.env.APIFY_TOKEN = "token";
    assert.equal(propertyApifyFallbackEnabled("sms"), true);
    assert.equal(propertyApifyFallbackEnabled("voice"), false);
    process.env.PROPERTY_APIFY_FALLBACK_VOICE_ENABLED = "true";
    assert.equal(propertyApifyFallbackEnabled("voice"), true);
  } finally {
    if (previousEnabled == null) delete process.env.PROPERTY_APIFY_FALLBACK_ENABLED;
    else process.env.PROPERTY_APIFY_FALLBACK_ENABLED = previousEnabled;
    if (previousToken == null) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = previousToken;
    if (previousVoice == null) delete process.env.PROPERTY_APIFY_FALLBACK_VOICE_ENABLED;
    else process.env.PROPERTY_APIFY_FALLBACK_VOICE_ENABLED = previousVoice;
  }
});

test("normalizeApifyItemToProperty: preserves Zillow listing keys and media", () => {
  const row = normalizeApifyItemToProperty({
    streetAddress: "1200 Barton Springs Rd",
    price: "$495,000",
    bedrooms: 3,
    bathrooms: 2,
    city: "Austin",
    state: "TX",
    zipcode: "78704",
    homeType: "condo",
    imgSrc: "https://images.example/photo.jpg",
    zpid: "123456",
  });

  assert.equal(row.address, "1200 Barton Springs Rd");
  assert.equal(row.price, "495000");
  assert.equal(row.beds, "3");
  assert.equal(row.baths, "2");
  assert.equal(row.property_type, "Condo");
  assert.equal(row.photo_url, "https://images.example/photo.jpg");
  assert.equal(row.listing_url, "https://www.zillow.com/homedetails/123456_zpid/");
});

test("searchAndImportMissingProperties: runs actor, filters criteria, upserts, and optionally appends sheets", async () => {
  const previousSync = process.env.PROPERTY_APIFY_FALLBACK_SYNC_SHEETS;
  try {
    process.env.PROPERTY_APIFY_FALLBACK_SYNC_SHEETS = "true";
    const upserts: string[] = [];
    const appended: string[] = [];
    const rows = await searchAndImportMissingProperties({
      query: { query: "3 bed home under 500k", area: "Austin", beds: 3, maxPrice: 500000 },
      channel: "instagram",
      limit: 3,
    }, {
      runActor: async (payload) => {
        assert.equal(payload.location, "Austin, TX");
        assert.equal(payload.max_results, 3);
        return [
          { streetAddress: "1 Good Match", price: "$450,000", bedrooms: 3, bathrooms: 2, city: "Austin", state: "TX" },
          { streetAddress: "2 Too Expensive", price: "$750,000", bedrooms: 3, bathrooms: 2, city: "Austin", state: "TX" },
        ];
      },
      upsert: async (row) => {
        upserts.push(row.address || "");
        return row as never;
      },
      appendSheet: async (row) => {
        appended.push(row.address || "");
        return true;
      },
    });

    assert.deepEqual(rows.map((row) => row.address), ["1 Good Match"]);
    assert.deepEqual(upserts, ["1 Good Match"]);
    assert.deepEqual(appended, ["1 Good Match"]);
  } finally {
    if (previousSync == null) delete process.env.PROPERTY_APIFY_FALLBACK_SYNC_SHEETS;
    else process.env.PROPERTY_APIFY_FALLBACK_SYNC_SHEETS = previousSync;
  }
});
