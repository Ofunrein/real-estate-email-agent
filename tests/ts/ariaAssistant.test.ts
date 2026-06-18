import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAriaAssistant } from "@/lib/ariaAssistant";
import { resolveClientConfig } from "@/lib/clientConfig";

function config() {
  return resolveClientConfig({
    CLIENT_NAME: "Acme Realty",
    HUMAN_TRANSFER_NUMBER: "+15128152032",
    ARIA_VOICE_ID: "voice-xyz",
  });
}

test("buildAriaAssistant: includes all server tools with secret-bearing urls", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com/", secret: "s3cr3t" });
  const model = assistant.model as Record<string, unknown>;
  const tools = model.tools as Array<Record<string, unknown>>;
  const names = tools
    .filter((t) => t.type === "function")
    .map((t) => (t.function as Record<string, unknown>).name);
  assert.deepEqual(names, [
    "getCallerContext",
    "lookupProperty",
    "searchProperties",
    "qualifyLead",
    "bookAppointment",
    "cancelAppointment",
    "rescheduleAppointment",
    "scheduleShowing",
    "syncToCrm",
  ]);

  const lookup = tools.find((t) => (t.function as Record<string, unknown> | undefined)?.name === "lookupProperty");
  const server = lookup?.server as Record<string, unknown>;
  assert.equal(server.url, "https://app.example.com/api/webhooks/aria-tools/lookupProperty?secret=s3cr3t");
});

test("buildAriaAssistant: transferCall destination is the human transfer number", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const tools = (assistant.model as Record<string, unknown>).tools as Array<Record<string, unknown>>;
  const transfer = tools.find((t) => t.type === "transferCall");
  assert.ok(transfer, "transferCall tool present");
  const destinations = transfer!.destinations as Array<Record<string, unknown>>;
  assert.equal(destinations[0].number, "+15128152032");
  assert.ok(tools.some((t) => t.type === "endCall"), "endCall tool present");
});

test("buildAriaAssistant: server url for lifecycle webhook", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com", secret: "k" });
  const server = assistant.server as Record<string, unknown>;
  assert.equal(server.url, "https://app.example.com/api/webhooks/aria-voice?secret=k");
});

test("buildAriaAssistant: custom voice id wired, system prompt branded", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const voice = assistant.voice as Record<string, unknown>;
  assert.equal(voice.voiceId, "voice-xyz");
  assert.equal(voice.provider, "11labs");
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.match(messages[0].content, /Acme Realty/);
  assert.match(messages[0].content, /getCallerContext/);
  assert.match(messages[0].content, /greater Austin \/ Central Texas metro/);
  assert.match(messages[0].content, /Fairwood Avenue/);
  assert.match(messages[0].content, /mile markers/);
  assert.match(messages[0].content, /preferred follow-up channel/);
  assert.match(messages[0].content, /Human-assisted does not mean stopping useful property help/);
  assert.match(messages[0].content, /transferToHuman|transfer/i);
});

test("buildAriaAssistant: qualifyLead captures channel and bed-bath preferences", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const tools = (assistant.model as Record<string, unknown>).tools as Array<Record<string, unknown>>;
  const qualify = tools.find((t) => (t.function as Record<string, unknown> | undefined)?.name === "qualifyLead");
  const params = (qualify!.function as Record<string, unknown>).parameters as Record<string, unknown>;
  const properties = params.properties as Record<string, unknown>;
  assert.ok(properties.preferred_channel);
  assert.ok(properties.bedrooms);
  assert.ok(properties.bathrooms);
  assert.ok(properties.sell_before_buy);
});

test("buildAriaAssistant: no voice block when voiceId unset", () => {
  const bare = resolveClientConfig({ HUMAN_TRANSFER_NUMBER: "+15128152032" });
  const assistant = buildAriaAssistant(bare, { publicUrl: "https://app.example.com" });
  assert.equal(assistant.voice, undefined);
});

test("buildAriaAssistant: appends styleContext to system prompt when provided", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com", styleContext: "VOICE_SAMPLE_BLOCK" });
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.match(messages[0].content, /VOICE_SAMPLE_BLOCK/);
});

test("buildAriaAssistant: no style text when styleContext absent", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.ok(!messages[0].content.includes("VOICE_SAMPLE_BLOCK"));
});

test("buildAriaAssistant: defaults to matching OpenAI provider for GPT models", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const model = assistant.model as Record<string, unknown>;
  assert.equal(model.provider, "openai");
  assert.equal(model.model, "gpt-4.1-mini");
});

test("buildAriaAssistant: allows explicit Anthropic model/provider override", () => {
  const assistant = buildAriaAssistant(config(), {
    publicUrl: "https://app.example.com",
    respondProvider: "anthropic",
    respondModel: "claude-sonnet-4-5",
  });
  const model = assistant.model as Record<string, unknown>;
  assert.equal(model.provider, "anthropic");
  assert.equal(model.model, "claude-sonnet-4-5");
});
