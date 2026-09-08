import test from "node:test";
import assert from "node:assert/strict";
// The runtime manifest generator is intentionally plain ESM so release operators can invoke it directly.
// @ts-expect-error no declaration file for the operator script
import { generateManifest } from "../../scripts/vapi-eval-scenarios.mjs";
type Scenario = { id: string; family: string; evidence: string; skipUnless?: string };

test("human-call manifest is deterministic and complete", () => {
  const a = generateManifest(42), b = generateManifest(42), c = generateManifest(43);
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, c.sha256);
  assert.equal(a.caseCount, a.cases.length);
  assert.ok(a.cases.length >= 60);
  assert.equal(new Set(a.cases.map((x: Scenario) => x.id)).size, a.cases.length);
});

test("audio-dependent cases cannot be represented as chat passes", () => {
  const manifest = generateManifest();
  const audio = manifest.cases.filter((x: Scenario) => x.evidence === "real-audio-telephony");
  assert.ok(audio.length >= 16);
  for (const item of audio as Scenario[]) assert.match(item.skipUnless || "", /phone|audio|allowlist/i);
});

test("required risk families are present", () => {
  const families = new Set(generateManifest().cases.map((x: Scenario) => x.family));
  for (const family of ["identity", "privacy", "scheduling", "address", "emotion", "safety", "compliance", "security", "language", "accessibility", "stt", "reliability", "transfer", "context", "audio-speech", "audio-environment", "audio-turn-taking", "telephony", "telephony-latency", "telephony-reliability", "telephony-transfer"]) assert.ok(families.has(family), family);
});
