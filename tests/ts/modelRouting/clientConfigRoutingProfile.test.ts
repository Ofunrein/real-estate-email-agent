import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClientConfig } from "@/lib/clientConfig";

test("modelRoutingProfile defaults to legacy when MODEL_ROUTING_PROFILE is unset", () => {
  const config = resolveClientConfig({});
  assert.equal(config.modelRoutingProfile, "legacy");
});

test("modelRoutingProfile accepts canary and candidate", () => {
  assert.equal(resolveClientConfig({ MODEL_ROUTING_PROFILE: "canary" }).modelRoutingProfile, "canary");
  assert.equal(resolveClientConfig({ MODEL_ROUTING_PROFILE: "candidate" }).modelRoutingProfile, "candidate");
});

test("modelRoutingProfile falls back to legacy on an invalid value (fail-safe, not fail-open)", () => {
  assert.equal(resolveClientConfig({ MODEL_ROUTING_PROFILE: "yolo" }).modelRoutingProfile, "legacy");
});
