import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClientConfig } from "@/lib/clientConfig";

// Regression: Aria said "I'm Iris, default's virtual assistant" on a live call because clientName
// fell back to the raw CLIENT_ID slug. Anything that reaches speech must not be an internal slug.
test("clientName does not leak the placeholder slug into spoken copy", () => {
  const config = resolveClientConfig({});
  assert.equal(config.clientName, "the team");
  assert.equal(config.voiceClientName, "the team");
});

test("placeholder slugs are all treated as unnamed", () => {
  for (const slug of ["default", "demo", "test", "local", "DEFAULT"]) {
    assert.equal(resolveClientConfig({ CLIENT_ID: slug }).clientName, "the team", slug);
  }
});

test("a real CLIENT_NAME is used verbatim", () => {
  const config = resolveClientConfig({ CLIENT_NAME: "Any Old Realty" });
  assert.equal(config.clientName, "Any Old Realty");
  assert.equal(config.voiceClientName, "Any Old Realty");
});

test("a real CLIENT_ID still names the client when CLIENT_NAME is unset", () => {
  assert.equal(resolveClientConfig({ CLIENT_ID: "patricia-mack" }).clientName, "patricia-mack");
});

test("ARIA_CLIENT_NAME still overrides the voice name only", () => {
  const config = resolveClientConfig({ CLIENT_NAME: "Any Old Realty", ARIA_CLIENT_NAME: "Any Old Team" });
  assert.equal(config.clientName, "Any Old Realty");
  assert.equal(config.voiceClientName, "Any Old Team");
});
