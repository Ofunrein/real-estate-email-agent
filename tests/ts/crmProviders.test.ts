import { test } from "node:test";
import assert from "node:assert/strict";
import { crmProviderLabels, directCrmAdapterKey, normalizeCrmProvider, resolveCrmProviderDefinition } from "@/lib/crm/providers";
import { resolveClientConfig } from "@/lib/clientConfig";
import { resolveCrmAdapter } from "@/lib/crm";

test("crm providers: includes Structurely CRM dropdown options", () => {
  const labels = crmProviderLabels();
  for (const label of [
    "AccuLynx",
    "AgentLocator",
    "BoomTown",
    "Brivity",
    "Builder Prime",
    "Buildertrend",
    "Commissions, Inc.",
    "Firepoint",
    "Follow Up Boss",
    "HighLevel",
    "Housecall Pro",
    "HubSpot",
    "Improveit 360",
    "Jobber",
    "JobNimbus",
    "Jungo",
    "kvCORE",
    "LeadPerfection",
    "Leap",
    "MarketSharp",
    "Pipedrive",
    "RealGeeks",
    "Salesforce",
    "ServiceMonster",
    "ServiceTitan",
    "Sierra Interactive",
    "Wise Agent",
    "Zoho",
    "Other",
    "None",
  ]) {
    assert.ok(labels.includes(label), `${label} should be supported`);
  }
});

test("crm providers: normalizes common aliases", () => {
  assert.equal(normalizeCrmProvider("GoHighLevel"), "ghl");
  assert.equal(normalizeCrmProvider("Follow Up Boss"), "fub");
  assert.equal(normalizeCrmProvider("Lofty"), "lofty_chime");
  assert.equal(normalizeCrmProvider("Commissions, Inc."), "cinc");
  assert.equal(normalizeCrmProvider("Real Geeks"), "realgeeks");
  assert.equal(normalizeCrmProvider("ServiceTitan"), "servicetitan");
});

test("crm providers: direct adapter aliases route to existing adapters", () => {
  assert.equal(directCrmAdapterKey("HighLevel"), "ghl");
  assert.equal(directCrmAdapterKey("Follow Up Boss"), "fub");
  assert.equal(directCrmAdapterKey("Lofty"), "kvcore");
  assert.equal(directCrmAdapterKey("kvCORE"), "kvcore");
  assert.equal(resolveCrmProviderDefinition("HubSpot")?.path, "composio");
  assert.equal(resolveCrmProviderDefinition("BoomTown")?.path, "csv_first");
});

test("crm providers: client config aliases activate direct adapter", () => {
  const config = resolveClientConfig({ CRM_PROVIDER: "Lofty" });
  assert.equal(config.crmProvider, "lofty_chime");
  const adapter = resolveCrmAdapter(config, { KVCORE_API_KEY: "test-key" });
  assert.equal(adapter?.provider, "kvcore");
});
