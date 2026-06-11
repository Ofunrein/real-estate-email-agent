import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildActorPayload,
  buildSearchSlices,
  dedupeRows,
  normalizeAddressKey,
  normalizeApifyItem,
  PROPERTIES_HEADERS,
  rowsFromExistingZillowCsv,
} from "../../scripts/import-zillow-apify-properties.mjs";
import { PROPERTIES_HEADERS as SCHEMA_PROPERTIES_HEADERS } from "@/lib/sheetSchema";

test("bulk Zillow importer keeps the existing properties schema", () => {
  assert.deepEqual(PROPERTIES_HEADERS, SCHEMA_PROPERTIES_HEADERS);
});

test("buildSearchSlices spreads Austin imports across diverse segments", () => {
  const slices = buildSearchSlices({ city: "Austin", state: "TX", target: 2000, limitPerQuery: 50, maxQueries: 40 });
  const listingTypes = new Set(slices.map((slice) => slice.listingType));
  const propertyTypes = new Set(slices.map((slice) => slice.propertyType));
  const zips = new Set(slices.map((slice) => slice.zip));

  assert.ok(slices.length >= 40);
  assert.ok(listingTypes.has("for_sale"));
  assert.ok(propertyTypes.has("house"));
  assert.ok(propertyTypes.has("condo"));
  assert.ok(zips.size > 1);
});

test("buildActorPayload uses location search and bounded max results", () => {
  const [slice] = buildSearchSlices({ city: "Austin", state: "TX", target: 20, limitPerQuery: 25, maxQueries: 1 });
  const payload = buildActorPayload(slice, 25);

  assert.equal(payload.country, "United States");
  assert.equal(payload.location, slice.location);
  assert.equal(payload.listing_type, slice.listingType);
  assert.equal(payload.max_results, 25);
  assert.equal(payload.property_type, slice.propertyType);
});

test("normalizeApifyItem maps truefetch and Zillow-shaped fields to sheet rows", () => {
  const row = normalizeApifyItem({
    address: "123 Main St",
    list_price: 455000,
    beds: 3,
    baths_full: 2,
    city: "Austin",
    state: "TX",
    zip_code: "78704",
    property_url: "/homedetails/123-Main-St/999_zpid/",
    primary_photo: "https://photos.zillowstatic.com/fp/example.jpg",
    property_type: "house",
    agent_broker: "Example Realty",
  }, { propertyTypeLabel: "single_family", listingLabel: "for_sale" });

  assert.equal(row.address, "123 Main St");
  assert.equal(row.price, "455000");
  assert.equal(row.beds, "3");
  assert.equal(row.baths, "2");
  assert.equal(row.city, "Austin");
  assert.equal(row.zip, "78704");
  assert.equal(row.property_type, "Single-Family Home");
  assert.equal(row.status, "For Sale");
  assert.equal(row.listing_url, "https://www.zillow.com/homedetails/123-Main-St/999_zpid/");
});

test("normalizeApifyItem maps current truefetch structured output", () => {
  const row = normalizeApifyItem({
    cover_image: "https://photos.zillowstatic.com/fp/example.jpg",
    title: "2615 Deerfoot Trl, Austin, TX 78704",
    description: "Zillow has 40 photos of this $1,599,000 3 beds, 3 baths, 1,848 sqft single family home located at 2615 Deerfoot Trl, Austin, TX 78704.",
    listing_id: "29325757",
    listing_type: "for_sale",
    property_type: "House",
    price: { value: 1599000, text: "$1,599,000" },
    rooms: { beds: 3, baths: 3 },
    area: { floor: 1848, floor_unit: "sqft" },
    location: "Austin, TX, 78704",
    address: "2615 Deerfoot Trl",
    dates: { market_days: 2 },
    features: ["3D model", "Investment property"],
    contact: { agency: "Blairfield Realty LLC" },
    source_url: "https://www.zillow.com/homedetails/2615-Deerfoot-Trl-Austin-TX-78704/29325757_zpid/",
  }, { propertyTypeLabel: "single_family", listingLabel: "for_sale" });

  assert.equal(row.address, "2615 Deerfoot Trl");
  assert.equal(row.price, "1599000");
  assert.equal(row.beds, "3");
  assert.equal(row.baths, "3");
  assert.equal(row.zip, "78704");
  assert.equal(row.sqft, "1848");
  assert.equal(row.days_on_market, "2");
  assert.equal(row.photo_url, "https://photos.zillowstatic.com/fp/example.jpg");
  assert.equal(row.agent_name, "Blairfield Realty LLC");
  assert.equal(row.listing_url, "https://www.zillow.com/homedetails/2615-Deerfoot-Trl-Austin-TX-78704/29325757_zpid/");
});

test("dedupeRows blocks existing addresses and duplicate Zillow ids", () => {
  const rows = [
    { address: "123 Main Street", listing_url: "https://www.zillow.com/homedetails/999_zpid/" },
    { address: "125 Main St", listing_url: "https://www.zillow.com/homedetails/999_zpid/" },
    { address: "127 Main St", listing_url: "https://www.zillow.com/homedetails/127-Main/127_zpid/" },
  ];
  const existing = [{ address: "123 Main St", listing_url: "" }];

  const result = dedupeRows(rows, existing);
  assert.equal(normalizeAddressKey("123 Main Street"), normalizeAddressKey("123 Main St"));
  assert.equal(result.unique.length, 1);
  assert.equal(result.unique[0].address, "127 Main St");
  assert.equal(result.duplicates.length, 2);
});

test("rowsFromExistingZillowCsv contributes prior scrape rows to dedupe index", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zillow-existing-"));
  const csvPath = path.join(dir, "existing.csv");
  fs.writeFileSync(
    csvPath,
    [
      "\"address/streetAddress\",\"address/city\",\"address/state\",\"address/zipcode\",\"hdpUrl\",\"zpid\"",
      "\"500 Test Ave\",\"Austin\",\"TX\",\"78704\",\"/homedetails/500-Test-Ave-Austin-TX-78704/555_zpid/\",\"555\"",
    ].join("\n"),
  );

  const existing = rowsFromExistingZillowCsv(csvPath);
  const result = dedupeRows([
    { address: "500 Test Avenue", listing_url: "https://www.zillow.com/homedetails/500-Test-Ave-Austin-TX-78704/555_zpid/" },
  ], existing);

  assert.equal(existing.length, 1);
  assert.equal(result.unique.length, 0);
  assert.equal(result.duplicates.length, 1);
});

test("dedupeRows ignores generic Zillow homepage URLs as listing keys", () => {
  const result = dedupeRows([
    { address: "1 First St", listing_url: "https://www.zillow.com" },
    { address: "2 Second St", listing_url: "https://www.zillow.com" },
  ]);

  assert.equal(result.unique.length, 2);
  assert.equal(result.duplicates.length, 0);
});
