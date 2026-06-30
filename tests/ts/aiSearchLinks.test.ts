import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aiSearchPropertyId,
  aiSearchPropertyUrl,
  resolveAiSearchConfig,
} from "@/lib/aiSearchLinks";

const austinEnv = {
  NEXT_PUBLIC_AI_SEARCH_BASE_URL: "https://search.austinrealty.example",
  AI_SEARCH_TENANT_ID: "YQxX9erMaCPdeBOYthLK",
  AI_SEARCH_MLS_OSN: "Austin",
};

test("aiSearchPropertyUrl: builds Austin property link from id", () => {
  const url = aiSearchPropertyUrl("5013978221052957045", { env: austinEnv });

  assert.equal(
    url,
    "https://search.austinrealty.example/property/5013978221052957045?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin&no_squeeze=true",
  );
});

test("aiSearchPropertyUrl: builds from a property row id field", () => {
  const url = aiSearchPropertyUrl(
    { address: "70 Rainey St #1509", property_id: "5013978221052957045", listing_url: "https://www.zillow.com/homedetails/old" },
    { env: austinEnv },
  );

  assert.equal(
    url,
    "https://search.austinrealty.example/property/5013978221052957045?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin&no_squeeze=true",
  );
});

test("aiSearchPropertyUrl: extracts id from existing ai-search listing_url", () => {
  const url = aiSearchPropertyUrl(
    {
      listing_url:
        "https://search.austinrealty.example/property/5010086478384677653?tenant_id=old&mls_osn=old",
    },
    { env: austinEnv },
  );

  assert.equal(
    url,
    "https://search.austinrealty.example/property/5010086478384677653?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin&no_squeeze=true",
  );
});

test("aiSearchPropertyUrl: preserves existing listing_url when config is missing", () => {
  const url = aiSearchPropertyUrl(
    { property_id: "5013978221052957045", listing_url: "https://www.zillow.com/homedetails/old" },
    { env: { NEXT_PUBLIC_AI_SEARCH_BASE_URL: "https://search.austinrealty.example" } },
  );

  assert.equal(url, "https://www.zillow.com/homedetails/old");
});

test("aiSearchPropertyUrl: preserves existing listing_url when id is missing", () => {
  const url = aiSearchPropertyUrl(
    { address: "123 Main St", listing_url: "https://example.com/listing/123" },
    { env: austinEnv },
  );

  assert.equal(url, "https://example.com/listing/123");
});

test("aiSearchPropertyUrl: degrades to empty string when config and fallback are missing", () => {
  const url = aiSearchPropertyUrl({ address: "123 Main St" }, { env: austinEnv });

  assert.equal(url, "");
});

test("aiSearchPropertyUrl: encodes property id and params", () => {
  const url = aiSearchPropertyUrl("ABC/123", {
    env: {
      NEXT_PUBLIC_AI_SEARCH_BASE_URL: "https://aisearch.example.com/search/",
      AI_SEARCH_TENANT_ID: "tenant+id",
      AI_SEARCH_MLS_OSN: "Austin / Central",
    },
  });

  assert.equal(
    url,
    "https://aisearch.example.com/property/ABC%2F123?tenant_id=tenant%2Bid&mls_osn=Austin+%2F+Central&no_squeeze=true",
  );
});

test("aiSearchPropertyUrl: can omit no_squeeze", () => {
  const url = aiSearchPropertyUrl("5013978221052957045", { env: austinEnv, noSqueeze: false });

  assert.equal(
    url,
    "https://search.austinrealty.example/property/5013978221052957045?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin",
  );
});

test("resolveAiSearchConfig: accepts server-only base url alias", () => {
  const config = resolveAiSearchConfig({
    AI_SEARCH_BASE_URL: "https://search.austinrealty.example/some/path",
    AI_SEARCH_TENANT_ID: "tenant",
    AI_SEARCH_MLS_OSN: "Austin",
  });

  assert.deepEqual(config, {
    baseUrl: "https://search.austinrealty.example",
    tenantId: "tenant",
    mlsOsn: "Austin",
  });
});

test("aiSearchPropertyId: supports common row id fields", () => {
  assert.equal(aiSearchPropertyId({ mlsNumber: "5018084977197200761" }), "5018084977197200761");
});
