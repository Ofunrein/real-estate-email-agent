import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveClientConfig } from "@/lib/clientConfig";

test("resolveClientConfig: defaults when env empty", () => {
  const config = resolveClientConfig({});
  assert.equal(config.clientId, "default");
  assert.equal(config.clientName, "default");
  assert.equal(config.agentNames.voice, "Iris");
  assert.equal(config.agentNames.email, "Iris");
  assert.equal(config.agentNames.sms, "Iris");
  assert.equal(config.crmProvider, "ghl");
  assert.equal(config.cadence.maxTouches, 14);
  assert.equal(config.cadence.minGapHours, 48);
  assert.equal(config.cadence.stopOnReply, true);
  assert.equal(config.cadence.oneChannelPerDay, true);
  assert.equal(config.cadence.callWindowStartHour, 8);
  assert.equal(config.cadence.callWindowEndHour, 21);
  assert.equal(config.notify.preferredChannel, "sms");
  assert.equal(config.styleTraining.enabled, false);
  assert.equal(config.styleTraining.limit, 3);
});

test("resolveClientConfig: overrides from env", () => {
  const config = resolveClientConfig({
    CLIENT_ID: "acme",
    CLIENT_NAME: "Acme Realty",
    TEAM_NAME: "Acme Team",
    ARIA_VOICE_ID: "voice-123",
    CRM_PROVIDER: "FUB",
    GHL_CALENDAR_ID: "cal-1",
    HUMAN_TRANSFER_NUMBER: "+15128152032",
    CADENCE_MAX_TOUCHES: "20",
    CADENCE_MIN_GAP_HOURS: "72",
    CADENCE_STOP_ON_REPLY: "false",
    ENABLE_STYLE_TRAINING: "true",
    STYLE_TRAINING_EXAMPLES_LIMIT: "5",
    NOTIFY_PREFERRED_CHANNEL: "email",
  });
  assert.equal(config.clientId, "acme");
  assert.equal(config.clientName, "Acme Realty");
  assert.equal(config.voiceId, "voice-123");
  assert.equal(config.crmProvider, "fub", "provider lowercased");
  assert.equal(config.calendarId, "cal-1");
  assert.equal(config.humanTransferNumber, "+15128152032");
  assert.equal(config.cadence.maxTouches, 20);
  assert.equal(config.cadence.minGapHours, 72);
  assert.equal(config.cadence.stopOnReply, false);
  assert.equal(config.styleTraining.enabled, true);
  assert.equal(config.styleTraining.limit, 5);
  assert.equal(config.notify.preferredChannel, "email");
});

test("resolveClientConfig: brand voice falls back to team name", () => {
  const config = resolveClientConfig({ TEAM_NAME: "Lakeside Group" });
  assert.match(config.brandVoice, /Lakeside Group/);
});

test("resolveClientConfig: bad numbers fall back to defaults", () => {
  const config = resolveClientConfig({ CADENCE_MAX_TOUCHES: "abc" });
  assert.equal(config.cadence.maxTouches, 14);
});

test("resolveClientConfig: invalid notify channel falls back to sms", () => {
  const config = resolveClientConfig({ NOTIFY_PREFERRED_CHANNEL: "carrier-pigeon" });
  assert.equal(config.notify.preferredChannel, "sms");
});
