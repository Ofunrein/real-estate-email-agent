import { test } from "node:test";
import assert from "node:assert/strict";

import { extractMetaSocialMessages, fetchMetaSocialSenderProfile, metaSocialDirectEnabled } from "@/lib/metaSocial";

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
  assert.equal(messages[0].raw.message && typeof messages[0].raw.message === "object", true);
});

test("extractMetaSocialMessages preserves Instagram shared post attachments", () => {
  const messages = extractMetaSocialMessages({
    entry: [
      {
        id: "ig-business-1",
        messaging: [
          {
            sender: { id: "igsid-1", username: "oje.o" },
            recipient: { id: "ig-business-1" },
            timestamp: 1782511020000,
            message: {
              mid: "mid.ig.share.1",
              attachments: [
                {
                  type: "share",
                  payload: {
                    url: "https://www.instagram.com/reel/example/",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  }, {
    instagramIds: ["ig-business-1"],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "");
  assert.equal(messages[0].media.length, 1);
  assert.equal(messages[0].media[0]?.url, "https://www.instagram.com/reel/example/");
  assert.equal(messages[0].media[0]?.filename, "Shared Instagram post");
  assert.equal(messages[0].media[0]?.providerMetadata?.title, "Shared Instagram post");
});

test("extractMetaSocialMessages preserves platform-sent echo messages", () => {
  const messages = extractMetaSocialMessages({
    entry: [
      {
        id: "ig-business-1",
        messaging: [
          {
            sender: { id: "ig-business-1" },
            recipient: { id: "igsid-1" },
            timestamp: 1782511020000,
            message: {
              mid: "mid.owner.1",
              text: "Sent from Instagram directly",
              is_echo: true,
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
  assert.equal(messages[0].isEcho, true);
  assert.equal(messages[0].senderId, "ig-business-1");
  assert.equal(messages[0].recipientId, "igsid-1");
  assert.equal(messages[0].text, "Sent from Instagram directly");
});

test("fetchMetaSocialSenderProfile reads Instagram username from Graph profile", async (t) => {
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = priorFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.equal(url.includes("/1526516032549624?"), true);
    assert.equal(url.includes("fields=name%2Cusername%2Cprofile_pic"), true);
    return new Response(JSON.stringify({
      id: "1526516032549624",
      name: "martin",
      username: "martn.o",
      profile_pic: "https://cdn.example.com/profile.jpg",
    }), { status: 200 });
  };

  const profile = await fetchMetaSocialSenderProfile("instagram", "1526516032549624", "page-token");

  assert.equal(profile?.id, "1526516032549624");
  assert.equal(profile?.name, "martin");
  assert.equal(profile?.username, "martn.o");
  assert.equal(profile?.profilePic, "https://cdn.example.com/profile.jpg");
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
