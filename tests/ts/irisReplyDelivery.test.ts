import assert from "node:assert/strict";
import { test } from "node:test";

import { agentActionForReplyJob, IRIS_REPLY_SEND_RETRIES, isReplyJobReplayable, requireSuccessfulReplySend } from "@/lib/irisReplyDelivery";
import type { ReplyJobRecord } from "@/lib/database";

function job(channel: string): ReplyJobRecord {
  return {
    id: "job-1", dedupeKey: "message-1", channel, provider: "test", threadRef: `${channel}:lead-1`,
    contactRef: channel === "email" ? "lead@example.com" : "+15125550100", status: "send_failed",
    attempts: 1, modelClassify: "", modelReply: "", replyText: "Reply", mediaJson: [{ url: "https://example.com/home.jpg" }],
    error: "provider timeout", nextAction: "retry_send", metadata: { lead: { fullName: "Sam", smsConsent: "inbound_text" } },
    sentAt: "", createdAt: "", updatedAt: "",
  };
}

test("reply delivery maps all channels into guarded shared actions", () => {
  assert.equal(agentActionForReplyJob(job("sms")).action, "send_text");
  assert.equal(agentActionForReplyJob(job("whatsapp")).action, "send_text");
  assert.equal(agentActionForReplyJob(job("email")).action, "send_email");
  assert.equal(agentActionForReplyJob(job("instagram")).action, "send_social_dm");
  assert.equal(agentActionForReplyJob(job("messenger")).action, "send_social_dm");
  assert.deepEqual(agentActionForReplyJob(job("sms")).mediaUrls, ["https://example.com/home.jpg"]);
});

test("only failed reply jobs can be manually replayed", () => {
  assert.equal(isReplyJobReplayable("send_failed"), true);
  assert.equal(isReplyJobReplayable("send_blocked"), false);
  assert.equal(isReplyJobReplayable("sent"), false);
  assert.equal(isReplyJobReplayable("sending"), false);
});

test("failed provider sends throw so Inngest runs configured retries", () => {
  assert.equal(IRIS_REPLY_SEND_RETRIES, 4);
  assert.throws(
    () => requireSuccessfulReplySend({ ok: false, error: "provider timeout" }, "sms"),
    /Iris sms send failed: provider timeout/,
  );
});
