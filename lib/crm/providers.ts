export type CrmSupportPath = "direct_adapter" | "composio" | "csv_first" | "none";

export type CrmProviderDefinition = {
  id: string;
  label: string;
  aliases: string[];
  path: CrmSupportPath;
  directAdapter?: "ghl" | "fub" | "kvcore";
  category: "real_estate" | "home_services" | "sales" | "none";
  detail: string;
};

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export const CRM_PROVIDER_DEFINITIONS: CrmProviderDefinition[] = [
  { id: "ghl", label: "HighLevel", aliases: ["gohighlevel", "go_high_level", "highlevel", "high_level", "leadconnector", "lead_connector", "ghl"], path: "direct_adapter", directAdapter: "ghl", category: "sales", detail: "Direct adapter supports contacts, activities, appointments, custom fields, and lead import." },
  { id: "fub", label: "Follow Up Boss", aliases: ["followupboss", "follow_up_boss", "followup_boss", "fub"], path: "direct_adapter", directAdapter: "fub", category: "real_estate", detail: "Direct API adapter supports contacts, notes, and appointments when FUB_API_KEY is set." },
  { id: "kvcore", label: "kvCORE", aliases: ["kv_core", "kvcore"], path: "direct_adapter", directAdapter: "kvcore", category: "real_estate", detail: "Direct adapter supports contact sync with KVCORE_API_KEY. CSV remains fallback for exports." },
  { id: "lofty_chime", label: "Lofty / Chime", aliases: ["lofty", "chime", "lofty_chime"], path: "direct_adapter", directAdapter: "kvcore", category: "real_estate", detail: "Uses the same real-estate contact adapter path when API access is available; CSV import works now." },
  { id: "hubspot", label: "HubSpot", aliases: ["hub_spot"], path: "composio", category: "sales", detail: "Supported through Composio import/action mapping or CSV export." },
  { id: "salesforce", label: "Salesforce", aliases: ["sales_force"], path: "composio", category: "sales", detail: "Supported through Composio import/action mapping or CSV export." },
  { id: "pipedrive", label: "Pipedrive", aliases: ["pipe_drive"], path: "composio", category: "sales", detail: "Supported through Composio import/action mapping or CSV export." },
  { id: "zoho", label: "Zoho", aliases: ["zoho_crm"], path: "composio", category: "sales", detail: "Supported through Composio import/action mapping or CSV export." },
  { id: "acculynx", label: "AccuLynx", aliases: ["accu_lynx"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "agentlocator", label: "AgentLocator", aliases: ["agent_locator"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "boomtown", label: "BoomTown", aliases: ["boom_town"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "brivity", label: "Brivity", aliases: [], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "builder_prime", label: "Builder Prime", aliases: ["builderprime"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "buildertrend", label: "Buildertrend", aliases: ["builder_trend"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "cinc", label: "Commissions, Inc.", aliases: ["commissions_inc", "commissions_inc_", "commissions_incorporated"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "firepoint", label: "Firepoint", aliases: ["fire_point"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "housecall_pro", label: "Housecall Pro", aliases: ["housecallpro"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "improveit_360", label: "Improveit 360", aliases: ["improveit360", "improve_it_360"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "jobber", label: "Jobber", aliases: [], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "jobnimbus", label: "JobNimbus", aliases: ["job_nimbus"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "jungo", label: "Jungo", aliases: [], path: "csv_first", category: "sales", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "leadperfection", label: "LeadPerfection", aliases: ["lead_perfection"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "leap", label: "Leap", aliases: [], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "marketsharp", label: "MarketSharp", aliases: ["market_sharp"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "realgeeks", label: "RealGeeks", aliases: ["real_geeks"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "servicemonster", label: "ServiceMonster", aliases: ["service_monster"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "servicetitan", label: "ServiceTitan", aliases: ["service_titan"], path: "csv_first", category: "home_services", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "sierra_interactive", label: "Sierra Interactive", aliases: ["sierra"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "wise_agent", label: "Wise Agent", aliases: ["wiseagent"], path: "csv_first", category: "real_estate", detail: "CSV/export import is supported now; direct adapter can be added for client-specific API access." },
  { id: "other", label: "Other", aliases: ["other_crm", "custom"], path: "csv_first", category: "sales", detail: "Universal CSV import works for any CRM export." },
  { id: "none", label: "None", aliases: ["no_crm", "no crm"], path: "none", category: "none", detail: "No CRM selected. Leads still store in Lumenosis lead memory." },
];

const CRM_LOOKUP = new Map<string, CrmProviderDefinition>();
for (const provider of CRM_PROVIDER_DEFINITIONS) {
  CRM_LOOKUP.set(slug(provider.id), provider);
  CRM_LOOKUP.set(slug(provider.label), provider);
  for (const alias of provider.aliases) CRM_LOOKUP.set(slug(alias), provider);
}

export function normalizeCrmProvider(value = "ghl"): string {
  const key = slug(value || "ghl");
  return CRM_LOOKUP.get(key)?.id || key || "ghl";
}

export function resolveCrmProviderDefinition(value = "ghl"): CrmProviderDefinition | null {
  return CRM_LOOKUP.get(slug(value)) || null;
}

export function directCrmAdapterKey(value = "ghl"): "ghl" | "fub" | "kvcore" | "" {
  return resolveCrmProviderDefinition(value)?.directAdapter || "";
}

export function crmProviderLabels(): string[] {
  return CRM_PROVIDER_DEFINITIONS.map((provider) => provider.label);
}
