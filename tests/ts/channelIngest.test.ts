import { test } from "node:test";
import assert from "node:assert/strict";

import { inferPreferredChannelFromText, twilioSmsIngestInput, vapiVoiceIngestInput } from "@/lib/channelIngest";

test("inferPreferredChannelFromText: detects explicit channel preference", () => {
  assert.equal(inferPreferredChannelFromText("Email is best for the details", "sms"), "email");
  assert.equal(inferPreferredChannelFromText("Text me the options", "email"), "sms");
  assert.equal(inferPreferredChannelFromText("Can you call me back?", "sms"), "voice");
});

test("twilioSmsIngestInput: stores preferred channel from SMS wording", () => {
  const event = twilioSmsIngestInput({
    From: "+15558675310",
    To: "+15128469460",
    Body: "Email is best. I am looking in downtown Austin.",
  });
  assert.equal(event.preferredChannel, "email");
});

test("vapiVoiceIngestInput: unwraps Vapi message envelope", () => {
  const event = vapiVoiceIngestInput({
    message: {
      type: "end-of-call-report",
      summary: "Caller asked about 4309 Fairway Path.",
      transcript: "User: Tell me about 4309 Fairway Path.",
      recordingUrl: "https://recording.example/call.mp3",
      call: {
        id: "call_123",
        customer: { number: "+15558675310" },
      },
    },
  });

  assert.equal(event.threadRef, "voice:call_123");
  assert.equal(event.phone, "+15558675310");
  assert.equal(event.messageText, "User: Tell me about 4309 Fairway Path.");
  assert.equal(event.summary, "Caller asked about 4309 Fairway Path.");
  assert.equal(event.recordingUrl, "https://recording.example/call.mp3");
  assert.equal(event.sourceDetail, "end-of-call-report");
});

test("vapiVoiceIngestInput: detects preferred channel from transcript", () => {
  const event = vapiVoiceIngestInput({
    message: {
      type: "end-of-call-report",
      transcript: "Assistant: Should I text or email? User: Email is better for me.",
      call: { id: "call_email", customer: { number: "+15558675310" } },
    },
  });
  assert.equal(event.preferredChannel, "email");
});
