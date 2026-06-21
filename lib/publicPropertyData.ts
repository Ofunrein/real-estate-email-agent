import type { SheetRow } from "@/lib/sheetSchema";

export type PublicDataMetric = {
  service: "fred" | "census" | "socrata";
  label: string;
  status: "found" | "no_data" | "failed";
  elapsedMs: number;
  detail?: string;
};

export type PublicDataResult = {
  context: string;
  metrics: PublicDataMetric[];
};

type SocrataDatasetConfig = {
  label: string;
  domain: string;
  datasetId: string;
  addressField: string;
  dateField?: string;
  typeField?: string;
  statusField?: string;
  descriptionField?: string;
  valueField?: string;
  linkField?: string;
};

const AUSTIN_PERMITS_DATASET: SocrataDatasetConfig = {
  label: "Austin issued construction permits",
  domain: "data.austintexas.gov",
  datasetId: "3syk-w9eu",
  addressField: "original_address1",
  dateField: "issue_date",
  typeField: "permit_type_desc",
  statusField: "status_current",
  descriptionField: "description",
  valueField: "work_class",
  linkField: "link",
};

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function envFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(clean(process.env[name]));
}

function elapsed(started: number): number {
  return Math.max(0, Date.now() - started);
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function getJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const response = await fetch(url, { signal: timeoutSignal(timeoutMs) });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function firstPresent(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "object" && value && "url" in value) return clean(String((value as { url?: unknown }).url || ""));
    const text = clean(String(value || ""));
    if (text) return text;
  }
  return "";
}

function formatCurrency(value?: string): string {
  const amount = Number(clean(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "";
}

function addOptionalParam(params: URLSearchParams, key: string, value?: string): void {
  const trimmed = clean(value);
  if (trimmed) params.set(key, trimmed);
}

export async function fetchFredMortgageRates(): Promise<string> {
  const key = process.env.FRED_API_KEY || "";
  const series = [
    ["30yr fixed", "MORTGAGE30US"],
    ["15yr fixed", "MORTGAGE15US"],
  ];
  const rates = await Promise.all(series.map(async ([label, seriesId]) => {
    const params = new URLSearchParams({
      series_id: seriesId,
      file_type: "json",
      limit: "1",
      sort_order: "desc",
    });
    addOptionalParam(params, "api_key", key);
    const data = await getJson(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`) as Record<string, unknown> | null;
    const observations = Array.isArray(data?.observations) ? data.observations as Record<string, unknown>[] : [];
    const value = clean(String(observations[0]?.value || ""));
    return value && value !== "." ? `${label} ${value}%` : "";
  }));
  const cleanRates = rates.filter(Boolean);
  return cleanRates.length ? `Current mortgage rate context from FRED: ${cleanRates.join(", ")}.` : "";
}

export async function fetchCensusZipStats(zip?: string): Promise<string> {
  const normalizedZip = clean(zip).match(/\b\d{5}\b/)?.[0] || "";
  if (!normalizedZip) return "";
  const params = new URLSearchParams({
    get: "B19013_001E,B01003_001E,B25002_003E,B25002_001E",
    for: `zip code tabulation area:${normalizedZip}`,
  });
  addOptionalParam(params, "key", process.env.CENSUS_API_KEY);
  const data = await getJson(`https://api.census.gov/data/2022/acs/acs5?${params.toString()}`);
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) return "";
  const [income, population, vacant, totalHousing] = data[1] as string[];
  const incomeText = income && income !== "-666666666" ? formatCurrency(income) : "";
  const populationText = Number(population);
  const vacantUnits = Number(vacant);
  const housingUnits = Number(totalHousing);
  const vacancyRate = Number.isFinite(vacantUnits) && Number.isFinite(housingUnits) && housingUnits > 0
    ? `${((vacantUnits / housingUnits) * 100).toFixed(1)}% vacancy`
    : "";
  return [
    incomeText ? `median income ${incomeText}` : "",
    Number.isFinite(populationText) && populationText > 0 ? `population ${populationText.toLocaleString("en-US")}` : "",
    vacancyRate,
  ].filter(Boolean).join(", ").replace(/^/, `Census ZIP ${normalizedZip} context: `);
}

function socrataDatasetsForProperty(property: Partial<SheetRow>): SocrataDatasetConfig[] {
  const configured = clean(process.env.SOCRATA_PROPERTY_DATASETS);
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as SocrataDatasetConfig[];
      if (Array.isArray(parsed)) return parsed.filter((item) => item.domain && item.datasetId && item.addressField);
    } catch {
      return [];
    }
  }
  const cityState = `${property.city || ""} ${property.state || ""} ${property.address || ""}`;
  if (!envFlag("SOCRATA_DISABLE_DEFAULT_AUSTIN") && /\b(austin|tx|texas)\b/i.test(cityState)) {
    return [AUSTIN_PERMITS_DATASET];
  }
  return [];
}

function addressSearchNeedle(address?: string): string {
  const normalized = clean(address)
    .replace(/(?:apt|unit|#)\s*[A-Za-z0-9-]+/gi, "")
    .replace(/\b(street)\b/gi, "st")
    .replace(/\b(avenue)\b/gi, "ave")
    .replace(/\b(road)\b/gi, "rd")
    .replace(/\b(drive)\b/gi, "dr")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const parts = normalized.split(" ").filter(Boolean);
  return parts.slice(0, Math.min(parts.length, 4)).join(" ");
}

function socrataString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatSocrataRecord(config: SocrataDatasetConfig, row: Record<string, unknown>): string {
  const date = firstPresent(row, config.dateField || "issue_date", "issued_date", "date");
  const type = firstPresent(row, config.typeField || "permit_type_desc", "permit_type", "permit_class");
  const status = firstPresent(row, config.statusField || "status_current", "status");
  const description = firstPresent(row, config.descriptionField || "description", "work_description").slice(0, 120);
  const value = firstPresent(row, config.valueField || "valuation", "estimated_cost", "work_class");
  const link = firstPresent(row, config.linkField || "link");
  const dateText = date ? date.slice(0, 10) : "";
  return [dateText, type, status, value, description, link].filter(Boolean).join(" | ");
}

export async function fetchSocrataPublicRecords(property: Partial<SheetRow>, limit = 3): Promise<string> {
  const address = clean(property.address);
  const needle = addressSearchNeedle(address);
  if (!needle) return "";
  const datasets = socrataDatasetsForProperty(property);
  const lines: string[] = [];
  for (const config of datasets) {
    const params = new URLSearchParams({
      $limit: String(Math.max(1, Math.min(limit, 5))),
      $order: config.dateField ? `${config.dateField} DESC` : `:id DESC`,
      $where: `upper(${config.addressField}) like '%${socrataString(needle)}%'`,
    });
    const data = await getJson(`https://${config.domain}/resource/${config.datasetId}.json?${params.toString()}`);
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    const records = rows.map((row) => formatSocrataRecord(config, row)).filter(Boolean);
    if (records.length) lines.push(`${config.label}: ${records.join("; ")}`);
  }
  return lines.length ? `Public-record permit context from Socrata: ${lines.join(" ")}` : "";
}

async function measuredPublicCall(label: PublicDataMetric["label"], service: PublicDataMetric["service"], fn: () => Promise<string>): Promise<{ value: string; metric: PublicDataMetric }> {
  const started = Date.now();
  try {
    const value = await fn();
    return {
      value,
      metric: {
        service,
        label,
        status: value ? "found" : "no_data",
        elapsedMs: elapsed(started),
      },
    };
  } catch (error) {
    return {
      value: "",
      metric: {
        service,
        label,
        status: "failed",
        elapsedMs: elapsed(started),
        detail: error instanceof Error ? error.message : "public data call failed",
      },
    };
  }
}

export async function fetchPublicPropertyContext(property: Partial<SheetRow>): Promise<PublicDataResult> {
  const [rates, census, socrata] = await Promise.all([
    measuredPublicCall("fred_mortgage_rates", "fred", fetchFredMortgageRates),
    measuredPublicCall("census_zip_stats", "census", () => fetchCensusZipStats(property.zip)),
    measuredPublicCall("socrata_property_records", "socrata", () => fetchSocrataPublicRecords(property)),
  ]);
  return {
    context: [rates.value, census.value, socrata.value].filter(Boolean).join("\n"),
    metrics: [rates.metric, census.metric, socrata.metric],
  };
}
