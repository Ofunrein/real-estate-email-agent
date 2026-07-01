import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAgentAction, planAgentAction, type AgentActionDeps } from "@/lib/agentActions";
import { DEFAULT_INBOX_SETTINGS, type InboxSettings } from "@/lib/inboxSettings";

function settings(patch: Partial<InboxSettings> = {}): InboxSettings {
  return {
    ...DEFAULT_INBOX_SETTINGS,
    ...patch,
    auto_send: { ...DEFAULT_INBOX_SETTINGS.auto_send, ...(patch.auto_send || {}) },
    channels_enabled: { ...DEFAULT_INBOX_SETTINGS.channels_enabled, ...(patch.channels_enabled || {}) },
  };
}

test("planAgentAction blocks outbound sends until shared trigger context exists", () => {
  const result = planAgentAction({
    action: "send_text",
    actorAgent: "Theo",
    to: "+15125550000",
    body: "Here are the listings.",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "missing_trigger_context");
  assert.equal(result.safeFallback, "capture_context");
});

test("planAgentAction respects client autosend settings for scalable onboarding", () => {
  const result = planAgentAction({
    action: "send_email",
    actorAgent: "Iris",
    to: "lead@example.com",
    body: "Details attached.",
    context: { captured: true, trigger: "lead_requested_details" },
  }, settings({ auto_send: { email: false } as InboxSettings["auto_send"] }));
  assert.equal(result.allowed, false);
  assert.equal(result.code, "autosend_disabled");
  assert.equal(result.safeFallback, "draft");
});

test("planAgentAction requires call consent before outbound call", () => {
  const result = planAgentAction({
    action: "start_call",
    actorAgent: "Aria",
    to: "+15125550000",
    lead: { phone: "+15125550000" },
    context: { captured: true, reason: "Lead asked for showing." },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "missing_call_consent");
});

test("executeAgentAction sends through shared reply dependency and records audit event", async () => {
  const sent: unknown[] = [];
  const recorded: unknown[] = [];
  const deps: Partial<AgentActionDeps> = {
    readSettings: async () => settings(),
    sendReply: async (input) => {
      sent.push(input);
      return { ok: true, deliveredBody: input.body, deliveredMediaUrls: input.mediaUrls || [], droppedMediaUrls: [], messageIds: ["msg_1"] };
    },
    recordInteraction: async (input) => {
      recorded.push(input);
      return {};
    },
  };
  const result = await executeAgentAction({
    action: "send_social_dm",
    actorAgent: "Theo",
    channel: "instagram",
    to: "ig_scoped_id",
    body: "I can send similar Austin homes here.",
    threadRef: "instagram:ig_scoped_id",
    lead: { fullName: "Maya Chen", preferredChannel: "instagram" },
    context: { captured: true, trigger: "shared_reel", reason: "Lead shared a property reel." },
  }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(sent[0], {
    channel: "instagram",
    to: "ig_scoped_id",
    body: "I can send similar Austin homes here.",
    mediaUrls: undefined,
    subject: undefined,
    threadId: "instagram:ig_scoped_id",
    messageId: undefined,
    references: undefined,
  });
  assert.equal(recorded.length, 1);
  assert.equal((recorded[0] as { aiAction: string }).aiAction, "send_social_dm");
});

test("executeAgentAction records blocked actions without provider call", async () => {
  let providerCalled = false;
  const recorded: unknown[] = [];
  const result = await executeAgentAction({
    action: "send_text",
    actorAgent: "Theo",
    to: "+15125550000",
    body: "Hello",
  }, {
    readSettings: async () => settings(),
    sendReply: async () => {
      providerCalled = true;
      return { ok: false, error: "should not happen" };
    },
    recordInteraction: async (input) => {
      recorded.push(input);
      return {};
    },
  });
  assert.equal(result.ok, false);
  assert.equal(providerCalled, false);
  assert.equal(recorded.length, 1);
  assert.match((recorded[0] as { status: string }).status, /blocked:missing_trigger_context/);
});
