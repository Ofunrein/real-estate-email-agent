import { test } from "node:test";
import assert from "node:assert/strict";

import { inferPreferredChannelFromText, twilioSmsIngestInput, vapiVoiceIngestInput } from "@/lib/channelIngest";

test("inferPreferredChannelFromText: detects explicit channel preference", () => {
  assert.equal(inferPreferredChannelFromText("Email is best for the details", "sms"), "email");
  assert.equal(inferPreferredChannelFromText("Text me the options", "email"), "sms");
  assert.equal(inferPreferredChannelFromText("Can you call me back?", "sms"), "voice");
  assert.equal(inferPreferredChannelFromText("Instagram DM works best", "sms"), "instagram");
});

test("twilioSmsIngestInput: stores preferred channel from SMS wording", () => {
  const event = twilioSmsIngestInput({
    From: "+15558675310",
    To: "+15128469460",
    Body: "Email is best. I am looking in downtown Austin.",
  });
  assert.equal(event.preferredChannel, "email");
});

test("twilioSmsIngestInput: preserves inbound MMS media for the dashboard", () => {
  const event = twilioSmsIngestInput({
    From: "+15558675310",
    To: "+15128469460",
    Body: "Here are the photos",
    NumMedia: "2",
    MediaUrl0: "https://api.twilio.com/2010-04-01/Accounts/ac/Messages/mm/Media/me0",
    MediaContentType0: "image/jpeg",
    MediaUrl1: "https://api.twilio.com/2010-04-01/Accounts/ac/Messages/mm/Media/me1",
    MediaContentType1: "image/png",
  });

  assert.match(event.messageText || "", /Here are the photos/);
  assert.match(event.messageText || "", /MMS image: https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ac\/Messages\/mm\/Media\/me0/);
  assert.match(event.messageText || "", /MMS image: https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ac\/Messages\/mm\/Media\/me1/);
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
