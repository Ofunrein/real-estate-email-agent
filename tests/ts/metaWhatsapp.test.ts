import assert from "node:assert/strict";
import { test } from "node:test";

import { extractMetaWhatsAppMessages, sendMetaWhatsApp, verifyMetaSignature } from "@/lib/metaWhatsapp";

test("extractMetaWhatsAppMessages maps Meta text payloads to Theo input", () => {
  const messages = extractMetaWhatsAppMessages({
    entry: [{
      changes: [{
        value: {
          metadata: {
            display_phone_number: "15125550123",
            phone_number_id: "123456789012345",
          },
          contacts: [{
            wa_id: "15125550100",
            profile: { name: "Sam Buyer" },
          }],
          messages: [{
            from: "15125550100",
            id: "wamid.1",
            type: "text",
            text: { body: "Can I see photos of 12400 Cedar St?" },
          }],
        },
      }],
    }],
  });

  assert.deepEqual(messages, [{
    from: "15125550100",
    body: "Can I see photos of 12400 Cedar St?",
    profileName: "Sam Buyer",
    messageId: "wamid.1",
    phoneNumberId: "123456789012345",
    displayPhoneNumber: "15125550123",
    messageType: "text",
  }]);
});

test("extractMetaWhatsAppMessages keeps image captions as message text", () => {
  const messages = extractMetaWhatsAppMessages({
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: "+1 (512) 555-0100",
            id: "wamid.2",
            type: "image",
            image: { caption: "Is this property still available?" },
          }],
        },
      }],
    }],
  });

  assert.equal(messages[0]?.from, "15125550100");
  assert.equal(messages[0]?.body, "Is this property still available?");
  assert.equal(messages[0]?.messageType, "image");
});

test("sendMetaWhatsApp does not call Meta when the WhatsApp agent is disabled", async () => {
  const original = process.env.ENABLE_WHATSAPP_AGENT;
  process.env.ENABLE_WHATSAPP_AGENT = "false";
  try {
    const result = await sendMetaWhatsApp("15125550100", "Hello");
    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.equal(result.error, "ENABLE_WHATSAPP_AGENT is not true");
  } finally {
    if (original === undefined) {
      delete process.env.ENABLE_WHATSAPP_AGENT;
    } else {
      process.env.ENABLE_WHATSAPP_AGENT = original;
    }
  }
});

test("verifyMetaSignature allows unsigned payloads unless META_APP_SECRET is set", () => {
  const original = process.env.META_APP_SECRET;
  delete process.env.META_APP_SECRET;
  try {
    assert.equal(verifyMetaSignature("{}", null), true);
  } finally {
    if (original === undefined) {
      delete process.env.META_APP_SECRET;
    } else {
      process.env.META_APP_SECRET = original;
    }
  }
});
