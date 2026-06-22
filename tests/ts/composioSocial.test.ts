import assert from "node:assert/strict";
import test from "node:test";

import { buildComposioSocialSendArguments, composioSocialSendHealth } from "@/lib/composioSocial";

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
