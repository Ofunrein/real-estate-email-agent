#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";
const executableNames = isWindows ? ["python.exe", "python3.exe"] : ["python3", "python"];
const candidates = [
  process.env.PYTHON,
  join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python"),
  ...String(process.env.PATH || "")
    .split(delimiter)
    .flatMap((directory) => executableNames.map((name) => join(directory, name))),
].filter(Boolean);

const seen = new Set();
const uniqueCandidates = candidates.filter((candidate) => {
  const absolute = resolve(candidate);
  if (!existsSync(absolute)) return false;
  let identity = absolute;
  try {
    identity = realpathSync(absolute);
  } catch {
    // The spawn probe below will report whether the candidate is usable.
  }
  if (seen.has(identity)) return false;
  seen.add(identity);
  return true;
});

const requiredModules = [
  "anthropic",
  "dotenv",
  "google.oauth2",
  "googleapiclient",
  "pytest",
  "requests",
];
const probe = `import ${requiredModules.join(", ")}`;
const python = uniqueCandidates.find((candidate) => {
  const result = spawnSync(candidate, ["-c", probe], { stdio: "ignore" });
  return result.status === 0;
});

if (!python) {
  console.error("No Python interpreter with the project test dependencies was found.");
  console.error("Create .venv and install them with:");
  console.error("  python3 -m venv .venv");
  console.error("  .venv/bin/python -m pip install -r requirements.txt pytest");
  process.exit(1);
}

console.error(`Using Python test interpreter: ${python}`);
const requestedTests = process.argv.slice(2);
const result = spawnSync(
  python,
  ["-m", "pytest", ...(requestedTests.length ? requestedTests : ["tests/"])],
  { cwd: root, stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
