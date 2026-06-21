import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchPublicPropertyContext, fetchSocrataPublicRecords } from "@/lib/publicPropertyData";

test("fetchSocrataPublicRecords: defaults Austin properties to Austin issued permits dataset", async () => {
  const priorFetch = globalThis.fetch;
  const priorDatasets = process.env.SOCRATA_PROPERTY_DATASETS;
  const priorDisableAustin = process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN;
  delete process.env.SOCRATA_PROPERTY_DATASETS;
  delete process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN;
  const urls: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    assert.match(url, /data\.austintexas\.gov\/resource\/3syk-w9eu\.json/);
    assert.equal(new URL(url).searchParams.get("$where"), "upper(original_address1) like '%100 E 51ST ST%'");
    return Response.json([{
      issue_date: "2026-06-01T00:00:00.000",
      permit_type_desc: "Building Permit",
      status_current: "Active",
      description: "Interior remodel",
      link: { url: "https://abc.austintexas.gov/permit/123" },
    }]);
  };
  try {
    const context = await fetchSocrataPublicRecords({
      address: "100 E 51st St #7",
      city: "Austin",
      state: "TX",
    });

    assert.equal(urls.length, 1);
    assert.match(context, /Austin issued construction permits/);
    assert.match(context, /Building Permit/);
    assert.match(context, /Interior remodel/);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorDatasets === undefined) delete process.env.SOCRATA_PROPERTY_DATASETS;
    else process.env.SOCRATA_PROPERTY_DATASETS = priorDatasets;
    if (priorDisableAustin === undefined) delete process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN;
    else process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN = priorDisableAustin;
  }
});

test("fetchPublicPropertyContext: uses FRED, Census, and Socrata without RentCast", async () => {
  const priorFetch = globalThis.fetch;
  const priorDatasets = process.env.SOCRATA_PROPERTY_DATASETS;
  const priorDisableAustin = process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN;
  delete process.env.SOCRATA_PROPERTY_DATASETS;
  delete process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN;
  const urls: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("fred/series/observations")) {
      return Response.json({ observations: [{ value: url.includes("MORTGAGE15US") ? "5.77" : "6.81" }] });
    }
    if (url.includes("api.census.gov/data/2022/acs/acs5")) {
      return Response.json([
        ["B19013_001E", "B01003_001E", "B25002_003E", "B25002_001E", "zip code tabulation area"],
        ["98000", "22000", "550", "11000", "78751"],
      ]);
    }
    if (url.includes("data.austintexas.gov/resource/3syk-w9eu.json")) {
      return Response.json([{
        issue_date: "2026-06-01T00:00:00.000",
        permit_type_desc: "Residential Building Permit",
        status_current: "Final",
        description: "Mechanical update",
      }]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const result = await fetchPublicPropertyContext({
      address: "100 E 51st St #7",
      city: "Austin",
      state: "TX",
      zip: "78751",
    });

    assert.match(result.context, /Current mortgage rate context from FRED/);
    assert.match(result.context, /Census ZIP 78751 context/);
    assert.match(result.context, /Public-record permit context from Socrata/);
    assert.equal(urls.some((url) => /rentcast/i.test(url)), false);
    assert.deepEqual(result.metrics.map((metric) => metric.service).sort(), ["census", "fred", "socrata"]);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorDatasets === undefined) delete process.env.SOCRATA_PROPERTY_DATASETS;
    else process.env.SOCRATA_PROPERTY_DATASETS = priorDatasets;
    if (priorDisableAustin === undefined) delete process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN;
    else process.env.SOCRATA_DISABLE_DEFAULT_AUSTIN = priorDisableAustin;
  }
});
