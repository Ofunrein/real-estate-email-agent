import assert from "node:assert/strict";
import test from "node:test";

import {
  isMediaTranscribable,
  mediaLogLines,
  normalizedDedupeKey,
  normalizedMessageText,
} from "@/lib/omnichannelEvents";

test("normalizedDedupeKey uses provider-specific stable prefixes", () => {
  assert.equal(
    normalizedDedupeKey({
      channel: "instagram",
      provider: "",
      providerMessageId: "mid_1",
      threadRef: "instagram:thread_1",
    }),
    "instagram:mid_1",
  );
  assert.equal(
    normalizedDedupeKey({
      channel: "messenger",
      provider: "",
      providerMessageId: "mid_2",
      threadRef: "messenger:thread_1",
    }),
    "facebook:mid_2",
  );
});

test("normalizedMessageText includes audio and video transcripts", () => {
  const text = normalizedMessageText({
    text: "Can you help?",
    media: [
      { type: "audio", transcript: "I need a three bedroom home." },
      { type: "video", transcript: "Near downtown Austin." },
    ],
  });

  assert.match(text, /Can you help\?/);
  assert.match(text, /Voice note transcript: I need a three bedroom home\./);
  assert.match(text, /Video note transcript: Near downtown Austin\./);
});

test("media transcription and logs recognize iPhone-playable audio formats", () => {
  assert.equal(isMediaTranscribable({ url: "https://cdn.example.com/voice.m4a" }), true);
  assert.equal(isMediaTranscribable({ contentType: "audio/mp4" }), true);
  assert.deepEqual(mediaLogLines([{ type: "audio", url: "https://cdn.example.com/voice.m4a", transcript: "hello" }]), [
    "Voice note: https://cdn.example.com/voice.m4a",
    "Voice note transcript: hello",
  ]);
});
