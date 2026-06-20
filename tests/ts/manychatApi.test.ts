import { test } from "node:test";
import assert from "node:assert/strict";

import { missingManyChatResources, resourceNames } from "@/lib/manychatApi";

test("resourceNames: reads ManyChat name/title fields", () => {
  assert.deepEqual(resourceNames([{ name: "a" }, { title: "b" }, { id: 1 }]), ["a", "b"]);
});

test("missingManyChatResources: compares case-insensitively", () => {
  assert.deepEqual(
    missingManyChatResources(["theo:routed", "theo:media"], [{ name: "Theo:Routed" }]),
    ["theo:media"],
  );
});
