import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildImportPreview,
  isCampaignEligible,
  normalizeLeadImportRow,
  parseCsv,
  runLeadImport,
  segmentImportedLead,
} from "@/lib/leadImport";
import { composioImportConfig, rowsFromComposioResult } from "@/lib/composioLeadImport";

test("CSV import maps common CRM export fields and reports unmapped columns", () => {
  const parsed = parseCsv(`Full Name,Email Address,Mobile,Tags,Property Interest,Random Column
Sam Lee,sam@example.com,(512) 555-0100,"hot buyer;showing",100 E 51st St,keep me`);
  const { results, summary } = buildImportPreview(parsed.rows, {
    sourceType: "csv",
    sourceProvider: "follow_up_boss_export",
    dryRun: true,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].normalized.fullName, "Sam Lee");
  assert.equal(results[0].normalized.email, "sam@example.com");
  assert.equal(results[0].normalized.phone, "15125550100");
  assert.ok(results[0].segments.includes("hot_buyer"));
  assert.ok(results[0].segments.includes("showing_ready"));
  assert.deepEqual(summary.unmappedColumns, ["Random Column"]);
});

test("duplicate rows in the same import do not become duplicate candidates", () => {
  const { results, summary } = buildImportPreview([
    { Name: "Priya Shah", Email: "PRIYA@example.com", Tags: "nurture" },
    { Name: "Priya S", Email: "priya@example.com", Tags: "hot" },
  ], {
    sourceType: "csv",
    sourceProvider: "lofty_export",
    dryRun: true,
  });

  assert.equal(results[0].status, "validated");
  assert.equal(results[1].status, "duplicate");
  assert.ok(results[1].segments.includes("duplicate_merged"));
  assert.equal(summary.duplicateRows, 1);
});

test("consent and do-not-contact fields block campaign eligibility", () => {
  const result = normalizeLeadImportRow({
    Name: "Rene Buyer",
    Phone: "512-555-0199",
    "Do Not Contact": "yes",
    Tags: "hot buyer",
  }, {
    sourceType: "csv",
    sourceProvider: "kvcore_export",
    dryRun: true,
  });

  assert.ok(result.segments.includes("do_not_contact"));
  assert.equal(result.campaignEligible, false);
  assert.equal(isCampaignEligible(result.normalized, result.segments), false);
});

test("missing contact info is segmented and blocked", () => {
  const result = normalizeLeadImportRow({ Name: "Unknown Lead", Tags: "seller valuation" }, {
    sourceType: "manual",
    dryRun: true,
  });

  assert.ok(segmentImportedLead(result.normalized).includes("missing_contact_info"));
  assert.equal(result.campaignEligible, false);
});

test("Composio-supported rows ingest into the normalized lead shape", async () => {
  const { summary, results } = await runLeadImport([
    {
      "Contact ID": "hub_1",
      "Full Name": "Alex Owner",
      Email: "alex@example.com",
      Stage: "Seller valuation",
      Notes: "Wants home value and may list this summer",
    },
  ], {
    sourceType: "composio",
    sourceProvider: "hubspot",
    dryRun: true,
  });

  assert.equal(summary.totalRows, 1);
  assert.equal(summary.sourceType, "composio");
  assert.equal(results[0].normalized.sourceId, "hub_1");
  assert.equal(results[0].normalized.leadRole, "seller");
  assert.ok(results[0].segments.includes("seller_valuation"));
});

test("Composio import config and result path normalize CRM rows", () => {
  const config = composioImportConfig({
    COMPOSIO_IMPORT_TOOL_SLUG: "FOLLOW_UP_BOSS_LIST_PEOPLE",
    COMPOSIO_IMPORT_TOOLKIT: "follow_up_boss",
    COMPOSIO_IMPORT_USER_EMAIL: "Client@Example.com",
    COMPOSIO_IMPORT_ARGUMENTS_JSON: "{\"limit\":25}",
    COMPOSIO_IMPORT_RESULT_PATH: "data.people",
  });

  assert.equal(config?.toolSlug, "FOLLOW_UP_BOSS_LIST_PEOPLE");
  assert.equal(config?.toolkit, "follow_up_boss");
  assert.equal(config?.userId, "client@example.com");
  assert.deepEqual(config?.arguments, { limit: 25 });

  const rows = rowsFromComposioResult({
    data: {
      people: [
        { id: "fub_1", name: "Maya Buyer", emails: ["maya@example.com"] },
        "bad row",
      ],
    },
  }, "data.people");
  assert.deepEqual(rows, [{ id: "fub_1", name: "Maya Buyer", emails: ["maya@example.com"] }]);
});
