import assert from "node:assert/strict";
import test from "node:test";

import { buildComposioSocialSendArguments, composioSocialSendHealth } from "@/lib/composioSocial";
import {
  extractComposioMessageMediaForTest,
  socialPollInboundAlreadyHandledForTest,
} from "@/lib/composioSocialPoll";

test("buildComposioSocialSendArguments overwrites stale social recipient and body", () => {
  const args = buildComposioSocialSendArguments(
    "messenger",
    {
      page_id: "page_1",
      recipient_id: "stale_recipient",
      recipient: "stale_recipient",
      to: "stale_recipient",
      message_text: "stale body",
      body: "stale body",
      message: "stale body",
    },
    {
      to: "live_recipient",
      body: "Fresh reply",
      threadRef: "messenger:thread_1",
    },
  );

  assert.equal(args.page_id, "page_1");
  assert.equal(args.recipient_id, "live_recipient");
  assert.equal(args.recipient, "live_recipient");
  assert.equal(args.to, "live_recipient");
  assert.equal(args.message_text, "Fresh reply");
  assert.equal(args.body, "Fresh reply");
  assert.equal(args.message, "Fresh reply");
  assert.equal(args.thread_ref, "messenger:thread_1");
});

test("composioSocialSendHealth treats recipient and body as runtime fields", () => {
  const instagram = composioSocialSendHealth("instagram", null, {
    COMPOSIO_INSTAGRAM_SEND_TOOL_SLUG: "INSTAGRAM_SEND_MESSAGE",
  });
  const messenger = composioSocialSendHealth("messenger", {
    metadata: { default_send_arguments: { page_id: "page_1" } },
  }, {
    COMPOSIO_FACEBOOK_SEND_TOOL_SLUG: "FACEBOOK_SEND_MESSAGE",
  });

  assert.equal(instagram.outboundReady, true);
  assert.deepEqual(instagram.missing, []);
  assert.equal(messenger.outboundReady, true);
  assert.deepEqual(messenger.missing, []);
});

test("composioSocialSendHealth lets saved selected asset args override env defaults", () => {
  const messenger = composioSocialSendHealth("messenger", {
    metadata: { default_send_arguments: { page_id: "selected_page" } },
  }, {
    COMPOSIO_FACEBOOK_SEND_TOOL_SLUG: "FACEBOOK_SEND_MESSAGE",
    COMPOSIO_FACEBOOK_SEND_ARGUMENTS_JSON: '{"page_id":"stale_page","recipient_id":"stale","message_text":"stale"}',
  });

  assert.equal(messenger.outboundReady, true);
  assert.equal(messenger.arguments.page_id, "selected_page");
});

test("buildComposioSocialSendArguments strips Instagram audio from the text tool payload", () => {
  const args = buildComposioSocialSendArguments(
    "instagram",
    {
      recipient_id: "stale_recipient",
      text: "stale",
      media_url: "https://cdn.example.com/old.mp3",
    },
    {
      to: "ig_123",
      body: "Here is the update.",
      mediaUrls: ["https://cdn.example.com/voice-note.mp3", "https://cdn.example.com/photo.jpg"],
      threadRef: "instagram:thread_1",
    },
  );

  assert.equal(args.recipient_id, "ig_123");
  assert.match(String(args.text || ""), /Voice note attached in dashboard/);
  assert.deepEqual(args.media_urls, ["https://cdn.example.com/photo.jpg"]);
  assert.equal(args.media_url, "https://cdn.example.com/photo.jpg");
});

test("social poll retry is not suppressed by owner/manual outbound", () => {
  const inbound = {
    direction: "inbound",
    gmail_message_id: "instagram:mid_1",
    event_at: "2026-06-22T12:05:00.000Z",
    source: "composio",
    agent_name: "Iris",
  };
  const owner = {
    direction: "outbound",
    gmail_message_id: "instagram:owner_1",
    event_at: "2026-06-22T12:06:00.000Z",
    source: "human_takeover",
    agent_name: "owner",
  };
  const iris = {
    direction: "outbound",
    gmail_message_id: "instagram:reply_1",
    event_at: "2026-06-22T12:07:00.000Z",
    source: "composio",
    agent_name: "Iris",
  };

  assert.equal(socialPollInboundAlreadyHandledForTest("instagram:mid_1", [inbound, owner] as any), false);
  assert.equal(socialPollInboundAlreadyHandledForTest("instagram:mid_1", [inbound, owner, iris] as any), true);
});

test("extractComposioMessageMediaForTest finds nested Instagram and Messenger attachments", () => {
  const media = extractComposioMessageMediaForTest({
    id: "mid_1",
    attachments: {
      data: [
        { type: "audio", payload: { url: "https://cdn.example.com/voice.m4a" }, name: "voice.m4a" },
        { type: "image", image_data: { url: "https://cdn.example.com/photo.jpg" } },
      ],
    },
  });

  assert.equal(media.length, 2);
  assert.equal(media[0].url, "https://cdn.example.com/voice.m4a");
  assert.equal(media[0].type, "audio");
  assert.equal(media[1].url, "https://cdn.example.com/photo.jpg");
  assert.equal(media[1].type, "image");
});
