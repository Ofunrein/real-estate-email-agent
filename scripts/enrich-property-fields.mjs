#!/usr/bin/env node
/**
 * Batch-enrich missing core property health fields (zip, sqft, year_built, photo_url).
 * Wraps scripts/property_hygiene.py with sensible defaults for Austin inventory.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const hygieneArgs = [
  "scripts/property_hygiene.py",
  "--enrich",
  "--json",
  "--apify-runs-since",
  getArg("--since", "2026-05-18T00:00:00.000Z"),
  "--source-csv",
  getArg("--source-csv", "dataset_zillow-detail-scraper_2026-05-18_18-15-11-332.csv"),
];

if (hasFlag("--all")) hygieneArgs.push("--all");
else hygieneArgs.push("--limit", getArg("--limit", "25"));

if (hasFlag("--live")) hygieneArgs.push("--live");
if (hasFlag("--dedupe")) hygieneArgs.push("--dedupe");
if (hasFlag("--repair")) hygieneArgs.push("--repair");
if (hasFlag("--no-mark-unresolved")) hygieneArgs.push("--no-mark-unresolved");

const result = spawnSync("python", hygieneArgs, { stdio: "inherit" });
process.exit(result.status ?? 1);
