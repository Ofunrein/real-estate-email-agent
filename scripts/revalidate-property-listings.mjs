#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const DEFAULT_ACTOR = "2TAoAgCAUMtO8VXKJ";
const ACTIVE_STATUSES = new Set(["FOR_SALE", "FOR_RENT"]);

function parseArgs(argv) {
  const args = {
    actor: process.env.APIFY_ZILLOW_DETAIL_ACTOR || DEFAULT_ACTOR,
    clientId: process.env.CLIENT_ID || "austin-realty",
    chunkSize: 50,
    concurrency: 4,
    maxAddresses: 0,
    execute: false,
    resume: true,
    runDir: ".tmp/property-revalidation-20260910",
    addressesFile: "",
    timeoutSeconds: 900,
    pollMs: 5000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--actor") args.actor = next();
    else if (arg === "--client-id") args.clientId = next();
    else if (arg === "--chunk-size") args.chunkSize = Number(next());
    else if (arg === "--concurrency") args.concurrency = Number(next());
    else if (arg === "--max-addresses") args.maxAddresses = Number(next());
    else if (arg === "--run-dir") args.runDir = next();
    else if (arg === "--addresses-file") args.addressesFile = next();
    else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(next());
    else if (arg === "--poll-ms") args.pollMs = Number(next());
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--no-resume") args.resume = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.chunkSize = Math.max(1, Math.min(250, Math.floor(args.chunkSize || 50)));
  args.concurrency = Math.max(1, Math.min(10, Math.floor(args.concurrency || 4)));
  args.maxAddresses = Math.max(0, Math.floor(args.maxAddresses || 0));
  args.timeoutSeconds = Math.max(60, Math.floor(args.timeoutSeconds || 900));
  args.pollMs = Math.max(1000, Math.floor(args.pollMs || 5000));
  return args;
}

function usage() {
  console.log(`Usage: node scripts/revalidate-property-listings.mjs [options]

Dry-run is default. Add --execute to start paid Apify runs.

  --client-id <id>        Property tenant (default: austin-realty)
  --actor <id>            Apify actor ID
  --chunk-size <n>        Exact addresses per actor run (default: 50)
  --concurrency <n>       Simultaneous actor runs (default: 4)
  --max-addresses <n>     Limit addresses for smoke tests (0 = all)
  --run-dir <path>        Private checkpoint/output folder
  --addresses-file <path> JSON array or newline-delimited exact addresses
  --timeout-seconds <n>   Per-run deadline (default: 900)
  --poll-ms <n>           Run polling interval (default: 5000)
  --no-resume             Ignore completed checkpoint chunks
  --execute               Authorize paid actor runs
`);
}

function clean(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function exactAddress(row) {
  let address = clean(row.address);
  if (!address || /\b(?:undisclosed|unknown|address not available)\b/i.test(address)) return "";
  const city = clean(row.city);
  const state = clean(row.state);
  const zip = clean(row.zip);
  if (city && !new RegExp(`\\b${escapeRegExp(city)}\\b`, "i").test(address)) address += `, ${city}`;
  if (state && !/\b(?:TX|Texas)\b/i.test(address)) address += `, ${state}`;
  if (zip && !new RegExp(`\\b${escapeRegExp(zip)}\\b`).test(address)) address += ` ${zip}`;
  return address.replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAddress(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\btexas\b/g, "tx")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(circle)\b/g, "cir")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(apartment|apt|unit|suite|ste|number)\b/g, "#")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s*#\s*/g, " #")
    .replace(/\s+/g, " ")
    .trim();
}

function addressTokens(value) {
  return new Set(normalizeAddress(value).split(" ").filter((token) => token && !new Set(["of", "the", "tx", "austin"]).has(token) && !/^\d{5}$/.test(token)));
}

function addressSimilarity(left, right) {
  const a = addressTokens(left);
  const b = addressTokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function streetNumber(value) {
  return normalizeAddress(value).match(/^\d+/)?.[0] || "";
}

function itemAddress(item) {
  if (typeof item?.address === "string") return clean(item.address);
  const obj = item?.address && typeof item.address === "object" ? item.address : {};
  const street = clean(obj.streetAddress || item?.streetAddress);
  const city = clean(obj.city || item?.city);
  const state = clean(obj.state || item?.state);
  const zip = clean(obj.zipcode || obj.zip || item?.zipcode || item?.zip);
  return [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function normalizedStatus(item) {
  return clean(item?.homeStatus || item?.status || item?.home_status).toUpperCase().replace(/[ -]+/g, "_");
}

function realtorNames(row, item) {
  const attribution = item?.attributionInfo || {};
  const names = [
    row.agent_name,
    row.listing_agent_name,
    attribution.agentName,
    ...(Array.isArray(attribution.listingAgents) ? attribution.listingAgents.map((entry) => entry?.name) : []),
  ];
  return [...new Set(names.map(clean).filter(Boolean))];
}

function compactEvidence(item) {
  if (!item) return null;
  const attribution = item.attributionInfo || {};
  const photo = item.imgSrc || item.photo_url || item.responsivePhotos?.[0]?.url || item.photos?.[0]?.url || "";
  return {
    zpid: item.zpid ?? null,
    homeStatus: normalizedStatus(item),
    address: itemAddress(item),
    price: item.price ?? null,
    bedrooms: item.bedrooms ?? null,
    bathrooms: item.bathrooms ?? null,
    livingAreaValue: item.livingAreaValue ?? null,
    yearBuilt: item.yearBuilt ?? null,
    homeType: item.homeType || "",
    hdpUrl: item.hdpUrl || item.postingUrl || item.url || "",
    photo_url: photo,
    attributionInfo: {
      agentName: attribution.agentName || "",
      agentPhoneNumber: attribution.agentPhoneNumber || "",
      agentEmail: attribution.agentEmail || "",
      brokerName: attribution.brokerName || "",
      trueStatus: attribution.trueStatus || "",
      lastChecked: attribution.lastChecked || "",
      lastUpdated: attribution.lastUpdated || "",
    },
  };
}

function numeric(value) {
  const number = Number(clean(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function replacementScore(source, candidate) {
  let score = 0;
  if (clean(source.current.city).toLowerCase() === clean(candidate.current.city).toLowerCase()) score += 20;
  const desiredRent = /rent|lease/i.test(clean(source.current.status));
  const candidateRent = candidate.sourceStatus === "FOR_RENT";
  if (desiredRent === candidateRent) score += 30;
  const sourceBeds = numeric(source.current.beds);
  const candidateBeds = numeric(candidate.current.beds || candidate.evidence?.bedrooms);
  if (sourceBeds && candidateBeds) score += Math.max(0, 15 - Math.abs(sourceBeds - candidateBeds) * 5);
  const sourcePrice = numeric(source.current.price);
  const candidatePrice = numeric(candidate.current.price || candidate.evidence?.price);
  if (sourcePrice && candidatePrice) score += Math.max(0, 35 - Math.abs(sourcePrice - candidatePrice) / sourcePrice * 35);
  return Math.round(score * 100) / 100;
}

async function loadProperties(clientId) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query("select * from properties where client_id = $1 order by address asc", [clientId]);
    return result.rows;
  } finally {
    await pool.end();
  }
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function apifyRequest(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      const body = (await response.text()).slice(0, 500);
      if (response.status !== 429 && response.status < 500) throw new Error(`Apify HTTP ${response.status}: ${body}`);
      lastError = new Error(`Apify HTTP ${response.status}: ${body}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 1000 * 2 ** attempt)));
  }
  throw lastError;
}

async function startActor(actor, token, addresses) {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?token=${encodeURIComponent(token)}`;
  const body = {
    address: addresses,
    maxItems: addresses.length,
    requestTimeoutSecs: 25,
    timeoutSecs: Math.min(600, Math.max(55, addresses.length * 4 + 30)),
  };
  const response = await apifyRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { run: response.data, input: body };
}

async function waitForActor(runId, token, deadlineMs, pollMs) {
  const terminal = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
  while (Date.now() < deadlineMs) {
    const response = await apifyRequest(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
    if (terminal.has(response.data.status)) return response.data;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Apify run ${runId} exceeded local deadline`);
}

async function fetchDataset(datasetId, token) {
  return apifyRequest(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&clean=true&format=json`);
}

function makeChunks(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function buildReport(properties, rawChunks) {
  const requests = properties.map((row) => ({ row, requestedAddress: exactAddress(row) })).filter((entry) => entry.requestedAddress);
  const returned = rawChunks.flatMap((chunk) => chunk.items || []);
  const byAddress = new Map();
  const returnedEntries = [];
  for (const item of returned) {
    const address = itemAddress(item);
    const key = normalizeAddress(address);
    if (key) {
      const entry = { item, returnedAddress: address };
      byAddress.set(key, entry);
      returnedEntries.push(entry);
    }
  }

  const results = requests.map(({ row, requestedAddress }) => {
    let match = byAddress.get(normalizeAddress(requestedAddress));
    if (!match) {
      const candidates = returnedEntries
        .filter((entry) => streetNumber(entry.returnedAddress) === streetNumber(requestedAddress))
        .map((entry) => ({ ...entry, similarity: addressSimilarity(entry.returnedAddress, requestedAddress) }))
        .filter((entry) => entry.similarity >= 0.6)
        .sort((a, b) => b.similarity - a.similarity);
      if (candidates.length === 1 || (candidates[0]?.similarity || 0) > (candidates[1]?.similarity || 0)) match = candidates[0];
    }
    const status = match ? normalizedStatus(match.item) : "MISSING_RESULT";
    return {
      requestedAddress,
      returnedAddress: match?.returnedAddress || "",
      addressMatch: Boolean(match),
      sourceStatus: status,
      classification: match && ACTIVE_STATUSES.has(status) ? "active" : match ? "inactive" : "unverified",
      realtorNames: realtorNames(row, match?.item),
      current: row,
      evidence: compactEvidence(match?.item),
    };
  });

  const activeByRealtor = new Map();
  for (const result of results.filter((entry) => entry.classification === "active")) {
    for (const name of result.realtorNames) {
      const key = clean(name).toLowerCase();
      if (!activeByRealtor.has(key)) activeByRealtor.set(key, []);
      activeByRealtor.get(key).push(result);
    }
  }

  const replacementPlan = [];
  for (const result of results.filter((entry) => entry.classification !== "active")) {
    const candidates = result.realtorNames.flatMap((name) => activeByRealtor.get(name.toLowerCase()) || []);
    const unique = [...new Map(candidates.map((candidate) => [normalizeAddress(candidate.requestedAddress), candidate])).values()]
      .map((candidate) => ({ candidate, score: replacementScore(result, candidate) }))
      .sort((a, b) => b.score - a.score);
    replacementPlan.push({
      inactiveAddress: result.requestedAddress,
      sourceStatus: result.sourceStatus,
      realtorNames: result.realtorNames,
      replacementAddress: unique[0]?.candidate.requestedAddress || "",
      replacementStatus: unique[0]?.candidate.sourceStatus || "",
      replacementScore: unique[0]?.score ?? null,
      resolution: unique.length ? "same-realtor-active-candidate" : "unresolved",
      candidateCount: unique.length,
    });
  }

  const counts = results.reduce((acc, result) => {
    acc[result.classification] = (acc[result.classification] || 0) + 1;
    acc.byStatus[result.sourceStatus] = (acc.byStatus[result.sourceStatus] || 0) + 1;
    return acc;
  }, { active: 0, inactive: 0, unverified: 0, byStatus: {} });
  counts.skipped = properties.length - requests.length;
  counts.replacementsFound = replacementPlan.filter((entry) => entry.resolution !== "unresolved").length;
  counts.replacementsUnresolved = replacementPlan.filter((entry) => entry.resolution === "unresolved").length;
  return { generatedAt: new Date().toISOString(), activeStatuses: [...ACTIVE_STATUSES], counts, results, replacementPlan };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const runDir = path.resolve(args.runDir);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const properties = await loadProperties(args.clientId);
  const usable = properties.filter((row) => exactAddress(row));
  let selected = usable;
  if (args.addressesFile) {
    const raw = fs.readFileSync(path.resolve(args.addressesFile), "utf8");
    let requested;
    try {
      const parsed = JSON.parse(raw);
      requested = Array.isArray(parsed) ? parsed : parsed.addresses;
    } catch {
      requested = raw.split(/\r?\n/).filter(Boolean);
    }
    const wanted = new Set((requested || []).map(normalizeAddress));
    selected = usable.filter((row) => wanted.has(normalizeAddress(exactAddress(row))));
  }
  if (args.maxAddresses) selected = selected.slice(0, args.maxAddresses);
  const addresses = selected.map(exactAddress);
  const chunks = makeChunks(addresses, args.chunkSize);
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = readJson(manifestPath, { createdAt: new Date().toISOString(), actor: args.actor, clientId: args.clientId, chunks: {} });
  manifest.actor = args.actor;
  manifest.clientId = args.clientId;
  manifest.totalProperties = properties.length;
  manifest.selectedAddresses = addresses.length;
  manifest.chunkSize = args.chunkSize;
  manifest.concurrency = args.concurrency;
  manifest.updatedAt = new Date().toISOString();
  atomicJson(manifestPath, manifest);

  console.log(JSON.stringify({ mode: args.execute ? "execute" : "dry-run", properties: properties.length, searchable: usable.length, selected: addresses.length, chunks: chunks.length, runDir }, null, 2));
  if (!args.execute) return;
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is required with --execute");

  async function processChunk(index) {
    const key = String(index + 1).padStart(4, "0");
    const chunkFile = path.join(runDir, "raw", `chunk-${key}.json`);
    if (args.resume && manifest.chunks[key]?.status === "SUCCEEDED" && fs.existsSync(chunkFile)) {
      console.log(`chunk ${key}/${String(chunks.length).padStart(4, "0")}: resume hit`);
      return;
    }
    const startedAt = new Date().toISOString();
    const { run, input } = await startActor(args.actor, token, chunks[index]);
    manifest.chunks[key] = { runId: run.id, datasetId: run.defaultDatasetId, status: run.status, startedAt, addresses: chunks[index] };
    atomicJson(manifestPath, manifest);
    console.log(`chunk ${key}/${String(chunks.length).padStart(4, "0")}: started ${run.id}`);
    const completed = await waitForActor(run.id, token, Date.now() + args.timeoutSeconds * 1000, args.pollMs);
    manifest.chunks[key] = { ...manifest.chunks[key], status: completed.status, finishedAt: completed.finishedAt || new Date().toISOString(), usageTotalUsd: completed.usageTotalUsd ?? null };
    atomicJson(manifestPath, manifest);
    if (completed.status !== "SUCCEEDED") throw new Error(`Apify run ${run.id} ended ${completed.status}`);
    const items = await fetchDataset(completed.defaultDatasetId || run.defaultDatasetId, token);
    atomicJson(chunkFile, { runId: run.id, input, status: completed.status, usageTotalUsd: completed.usageTotalUsd ?? null, items });
    console.log(`chunk ${key}: ${items.length}/${chunks[index].length} results`);
  }

  let nextChunk = 0;
  async function worker() {
    while (nextChunk < chunks.length) {
      const index = nextChunk;
      nextChunk += 1;
      await processChunk(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, chunks.length) }, () => worker()));

  const rawChunks = chunks.map((_, index) => readJson(path.join(runDir, "raw", `chunk-${String(index + 1).padStart(4, "0")}.json`), { items: [] }));
  const report = buildReport(selected, rawChunks);
  atomicJson(path.join(runDir, "report.json"), report);
  atomicJson(path.join(runDir, "replacement-plan.json"), report.replacementPlan);
  console.log(JSON.stringify(report.counts, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
