#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

function args(argv) {
  const out = {
    apply: false,
    clientId: process.env.CLIENT_ID || "austin-realty",
    report: ".tmp/property-revalidation-20260910/full-v2/report.json",
    deleteInactive: false,
    backupDir: ".tmp/property-revalidation-20260910/backups",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--delete-inactive") out.deleteInactive = true;
    else if (arg === "--client-id") out.clientId = next();
    else if (arg === "--report") out.report = next();
    else if (arg === "--backup-dir") out.backupDir = next();
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(`Usage: node scripts/apply-property-revalidation.mjs [options]

Dry-run is default.

  --report <path>        Revalidation report
  --client-id <id>       Property tenant
  --apply                Commit status/detail updates
  --delete-inactive      Delete verified inactive rows after backup
  --backup-dir <path>    Private backup folder
`);
}

function clean(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function firstPhoto(item) {
  const candidates = [item?.photo_url, item?.imgSrc, item?.image, item?.responsivePhotos?.[0]?.url, item?.photos?.[0]?.url];
  return candidates.map(clean).find(Boolean) || "";
}

function listingUrl(item) {
  const candidate = [item?.hdpUrl, item?.postingUrl, item?.url, item?.detailUrl].map(clean).find(Boolean) || "";
  if (!candidate) return "";
  return candidate.startsWith("http") ? candidate : `https://www.zillow.com${candidate.startsWith("/") ? "" : "/"}${candidate}`;
}

function activeDetails(entry) {
  const item = entry.evidence || {};
  const attribution = item.attributionInfo || {};
  return {
    price: clean(item.price),
    beds: clean(item.bedrooms),
    baths: clean(item.bathrooms),
    sqft: clean(item.livingAreaValue),
    year_built: clean(item.yearBuilt),
    property_type: clean(item.homeType).replace(/_/g, " "),
    photo_url: firstPhoto(item),
    listing_url: listingUrl(item),
    agent_name: clean(attribution.agentName),
    listing_agent_name: clean(attribution.agentName),
    listing_agent_phone: clean(attribution.agentPhoneNumber),
  };
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.help) return usage();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const report = JSON.parse(fs.readFileSync(path.resolve(options.report), "utf8"));
  const matched = report.results.filter((entry) => entry.addressMatch && entry.classification !== "unverified");
  const active = matched.filter((entry) => entry.classification === "active");
  const inactive = matched.filter((entry) => entry.classification === "inactive");
  const unverified = report.results.filter((entry) => entry.classification === "unverified");
  const inactiveAddresses = new Set(inactive.map((entry) => clean(entry.current.address).toLowerCase()));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const current = await client.query("select * from properties where client_id = $1 order by address", [options.clientId]);
    const drafts = await client.query("select * from ai_drafts where client_id = $1 and status = 'draft' order by id", [options.clientId]);
    const affectedDrafts = drafts.rows.filter((draft) => [...inactiveAddresses].some((address) => clean(draft.body).toLowerCase().includes(address)));
    const summary = {
      mode: options.apply ? "apply" : "dry-run",
      report: path.resolve(options.report),
      currentProperties: current.rowCount,
      verifiedActive: active.length,
      verifiedInactive: inactive.length,
      unverified: unverified.length,
      deleteInactive: options.deleteInactive,
      draftRowsChecked: drafts.rowCount,
      affectedDraftIds: affectedDrafts.map((draft) => draft.id),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!options.apply) return;
    if (affectedDrafts.length) throw new Error("Drafts reference inactive listings. Rebuild them before applying property deletion.");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    atomicJson(path.resolve(options.backupDir, `properties-${stamp}.json`), current.rows);
    atomicJson(path.resolve(options.backupDir, `drafts-${stamp}.json`), drafts.rows);

    await client.query("begin");
    for (const entry of active) {
      const details = activeDetails(entry);
      await client.query(
        `update properties set
           status = $3,
           price = coalesce(nullif($4, ''), price),
           beds = coalesce(nullif($5, ''), beds),
           baths = coalesce(nullif($6, ''), baths),
           sqft = coalesce(nullif($7, ''), sqft),
           year_built = coalesce(nullif($8, ''), year_built),
           property_type = coalesce(nullif($9, ''), property_type),
           photo_url = coalesce(nullif($10, ''), photo_url),
           listing_url = coalesce(nullif($11, ''), listing_url),
           agent_name = coalesce(nullif($12, ''), agent_name),
           listing_agent_name = coalesce(nullif($13, ''), listing_agent_name),
           listing_agent_phone = coalesce(nullif($14, ''), listing_agent_phone),
           updated_at = now()
         where client_id = $1 and address = $2`,
        [options.clientId, entry.current.address, entry.sourceStatus, details.price, details.beds, details.baths, details.sqft, details.year_built, details.property_type, details.photo_url, details.listing_url, details.agent_name, details.listing_agent_name, details.listing_agent_phone],
      );
    }
    if (options.deleteInactive) {
      for (const entry of inactive) {
        await client.query("delete from properties where client_id = $1 and address = $2", [options.clientId, entry.current.address]);
      }
    } else {
      for (const entry of inactive) {
        await client.query("update properties set status = $3, updated_at = now() where client_id = $1 and address = $2", [options.clientId, entry.current.address, entry.sourceStatus]);
      }
    }
    for (const entry of unverified) {
      await client.query("update properties set status = 'UNVERIFIED', updated_at = now() where client_id = $1 and address = $2", [options.clientId, entry.current.address]);
    }
    await client.query("commit");
    console.log(JSON.stringify({ committed: true, activeUpdated: active.length, inactiveDeleted: options.deleteInactive ? inactive.length : 0, inactiveUpdated: options.deleteInactive ? 0 : inactive.length, unverifiedHidden: unverified.length }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
