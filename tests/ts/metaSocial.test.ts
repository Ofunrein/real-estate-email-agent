import { test } from "node:test";
import assert from "node:assert/strict";

import { extractMetaSocialMessages, metaSocialDirectEnabled } from "@/lib/metaSocial";

test("extractMetaSocialMessages parses Messenger-style messaging webhook payloads", () => {
  const messages = extractMetaSocialMessages({
    entry: [
      {
        id: "page-1",
        messaging: [
          {
            sender: { id: "lead-1", name: "Lead One" },
            recipient: { id: "page-1" },
            timestamp: 1719095640000,
            message: {
              mid: "mid.1",
              text: "Can you send 3 bed homes?",
              attachments: [
                { type: "audio", payload: { url: "https://cdn.example.com/voice.m4a" } },
              ],
            },
          },
        ],
      },
    ],
  }, {
    messengerIds: ["page-1"],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].channel, "messenger");
  assert.equal(messages[0].messageId, "mid.1");
  assert.equal(messages[0].media[0]?.type, "audio");
});

test("extractMetaSocialMessages infers Instagram when the recipient matches a saved Instagram asset id", () => {
  const messages = extractMetaSocialMessages({
    entry: [
      {
        id: "ig-business-1",
        messaging: [
          {
            sender: { id: "igsid-1", username: "martn.o" },
            recipient: { id: "ig-business-1" },
            timestamp: 1719095640000,
            message: {
              mid: "mid.ig.1",
              text: "Voice note coming through",
            },
          },
        ],
      },
    ],
  }, {
    instagramIds: ["ig-business-1"],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].channel, "instagram");
  assert.equal(messages[0].senderUsername, "martn.o");
});

test("metaSocialDirectEnabled respects global and per-channel flags", () => {
  const priorGlobal = process.env.ENABLE_META_SOCIAL_WEBHOOKS;
  const priorIg = process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK;
  const priorMessenger = process.env.ENABLE_MESSENGER_DIRECT_WEBHOOK;
  delete process.env.ENABLE_META_SOCIAL_WEBHOOKS;
  delete process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK;
  delete process.env.ENABLE_MESSENGER_DIRECT_WEBHOOK;

  assert.equal(metaSocialDirectEnabled("instagram"), false);

  process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK = "true";
  assert.equal(metaSocialDirectEnabled("instagram"), true);
  assert.equal(metaSocialDirectEnabled("messenger"), false);

  process.env.ENABLE_META_SOCIAL_WEBHOOKS = "true";
  assert.equal(metaSocialDirectEnabled("messenger"), true);

  if (priorGlobal == null) delete process.env.ENABLE_META_SOCIAL_WEBHOOKS;
  else process.env.ENABLE_META_SOCIAL_WEBHOOKS = priorGlobal;
  if (priorIg == null) delete process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK;
  else process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK = priorIg;
  if (priorMessenger == null) delete process.env.ENABLE_MESSENGER_DIRECT_WEBHOOK;
  else process.env.ENABLE_MESSENGER_DIRECT_WEBHOOK = priorMessenger;
});
