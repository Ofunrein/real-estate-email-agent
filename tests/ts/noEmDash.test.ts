import { test } from "node:test";
import assert from "node:assert/strict";

import { containsEmDash, removeEmDashes, removeEmDashesFromRecord } from "@/lib/noEmDash";
import { composioSocialSendsEnabled, sendComposioSocialMessage } from "@/lib/composioSocial";

test("removeEmDashes replaces em dash with plain hyphen spacing", () => {
  const cleaned = removeEmDashes("Iris says yes — then follows up");
  assert.equal(containsEmDash(cleaned), false);
  assert.equal(cleaned, "Iris says yes - then follows up");
});

test("removeEmDashesFromRecord cleans selected text fields only", () => {
  const cleaned = removeEmDashesFromRecord({ body: "One — two", note: "Keep — this" }, ["body"]);
  assert.equal(cleaned.body, "One - two");
  assert.equal(cleaned.note, "Keep — this");
});

test("composio social sends are off unless explicit env flag enables them", async () => {
  const previous = process.env.IRIS_ENABLE_COMPOSIO_SOCIAL_SENDS;
  delete process.env.IRIS_ENABLE_COMPOSIO_SOCIAL_SENDS;
  assert.equal(composioSocialSendsEnabled(), false);
  const result = await sendComposioSocialMessage({ channel: "instagram", to: "martn.o", body: "Hi — no send" });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Composio send unexpectedly enabled");
  assert.match(result.error, /disabled/i);
  if (previous === undefined) delete process.env.IRIS_ENABLE_COMPOSIO_SOCIAL_SENDS;
  else process.env.IRIS_ENABLE_COMPOSIO_SOCIAL_SENDS = previous;
});
