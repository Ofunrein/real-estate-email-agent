import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CORPUS_DIR = path.resolve(__dirname, "../../../evals/model-routing/corpus");

const PII_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "email address", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  { name: "gmail-style handle", regex: /@gmail\.[a-zA-Z]{2,}/i },
  { name: "US phone number", regex: /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
  { name: "+1 prefixed phone", regex: /\+1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/ },
  { name: "ZIP adjacent to street suffix", regex: /\b\d{5}\b.{0,20}\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|ct|court)\b/i },
];

function jsonlFiles(): string[] {
  return fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".jsonl"));
}

test("corpus directory contains all required task-class files at minimum sizes", () => {
  const required: Record<string, number> = {
    "email-classification.jsonl": 120,
    "email-reply.jsonl": 60,
    "sms-reply.jsonl": 40,
    "voice-turn.jsonl": 40,
    "sensitive-routing.jsonl": 80,
    "adversarial.jsonl": 40,
  };
  for (const [file, minCount] of Object.entries(required)) {
    const full = path.join(CORPUS_DIR, file);
    assert.ok(fs.existsSync(full), `missing corpus file: ${file}`);
    const lines = fs.readFileSync(full, "utf8").trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= minCount, `${file} has ${lines.length} cases, need >= ${minCount}`);
  }
});

test("no corpus file contains PII per the frozen regex set", () => {
  for (const file of jsonlFiles()) {
    const content = fs.readFileSync(path.join(CORPUS_DIR, file), "utf8");
    for (const { name, regex } of PII_PATTERNS) {
      const match = content.match(regex);
      assert.equal(match, null, `${file} matched PII pattern "${name}": ${match?.[0]}`);
    }
  }
});

test("every corpus record has a unique, deterministic id and the required fields", () => {
  for (const file of jsonlFiles()) {
    const lines = fs.readFileSync(path.join(CORPUS_DIR, file), "utf8").trim().split("\n").filter(Boolean);
    const ids = new Set<string>();
    for (const line of lines) {
      const record = JSON.parse(line);
      for (const field of ["id", "task", "input", "expected", "rubric_id", "severity"]) {
        assert.ok(field in record, `${file} record missing field "${field}": ${line.slice(0, 80)}`);
      }
      assert.ok(!ids.has(record.id), `${file} has duplicate id: ${record.id}`);
      ids.add(record.id);
    }
  }
});

test("adversarial corpus uses 40 distinct bodies and includes multiline and Unicode bypass attempts", () => {
  const records = fs
    .readFileSync(path.join(CORPUS_DIR, "adversarial.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const bodies = records.map((record) => String(record.input.body));
  assert.equal(new Set(bodies).size, 40);
  assert.ok(bodies.some((body) => body.includes("\n")), "expected multiline adversarial cases");
  assert.ok(bodies.some((body) => /[^\x00-\x7F]/.test(body)), "expected Unicode adversarial cases");
});
