import { test } from "node:test";
import assert from "node:assert/strict";

import { understandMediaItems } from "@/lib/mediaUnderstanding";
import { normalizedMessageText } from "@/lib/omnichannelEvents";

test("understandMediaItems summarizes shared real estate reels for similar-property requests", async () => {
  const media = await understandMediaItems([
    {
      type: "image",
      url: "https://cdn.example.com/north-austin-reel-thumb.jpg",
      filename: "Shared Instagram post",
      providerMetadata: {
        linkUrl: "https://www.instagram.com/reel/north-austin-listing-tour/",
        title: "Shared Instagram post",
      },
    },
  ]);

  const context = media[0].providerMetadata?.mediaContext as Record<string, unknown>;
  assert.match(String(context.summary), /instagram\.com\/reel\/north-austin-listing-tour/i);
  assert.equal(context.needsHuman, false);

  const messageText = normalizedMessageText({
    text: "I want something similar to this",
    media,
  });
  assert.match(messageText, /I want something similar/i);
  assert.match(messageText, /Image context:/i);
});

test("understandMediaItems keeps voice note transcripts available to the agent", async () => {
  const media = await understandMediaItems([
    {
      type: "audio",
      url: "https://cdn.example.com/voice-note.m4a",
      transcript: "I want a three bedroom near Mueller with a modern kitchen under six fifty.",
    },
  ]);

  const context = media[0].providerMetadata?.mediaContext as Record<string, unknown>;
  assert.match(String(context.summary), /three bedroom near Mueller/i);

  const messageText = normalizedMessageText({ text: "", media });
  assert.match(messageText, /Voice note transcript:/i);
  assert.match(messageText, /three bedroom near Mueller/i);
});

test("understandMediaItems gives images usable context even without paid vision enabled", async () => {
  const media = await understandMediaItems([
    {
      type: "image",
      url: "https://cdn.example.com/kitchen.jpg",
      filename: "Kitchen inspiration photo",
    },
  ]);

  const context = media[0].providerMetadata?.mediaContext as Record<string, unknown>;
  assert.match(String(context.summary), /Kitchen inspiration photo/i);
  assert.equal(context.model, "heuristic_image");
});

test("understandMediaItems supports general media vision flag and strips private vision bytes", async () => {
  const previousEnabled = process.env.ENABLE_MEDIA_VISION;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.MEDIA_VISION_MODEL;
  const originalFetch = global.fetch;
  try {
    process.env.ENABLE_MEDIA_VISION = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.MEDIA_VISION_MODEL = "claude-test-vision";
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ summary: "Kitchen has bright natural light", extractedText: "Austin Realty", confidence: 0.91 }) }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const media = await understandMediaItems([{
      type: "image",
      contentType: "image/png",
      filename: "kitchen.png",
      providerMetadata: {
        visionContentType: "image/png",
        visionBytesBase64: Buffer.from("fake-image").toString("base64"),
      },
    }]);
    const metadata = media[0].providerMetadata || {};
    const context = metadata.mediaContext as Record<string, unknown>;
    assert.equal(context.summary, "Kitchen has bright natural light");
    assert.equal(context.extractedText, "Austin Realty");
    assert.equal(context.model, "claude-test-vision");
    assert.equal("visionBytesBase64" in metadata, false);
    assert.equal("visionContentType" in metadata, false);
  } finally {
    global.fetch = originalFetch;
    if (previousEnabled == null) delete process.env.ENABLE_MEDIA_VISION;
    else process.env.ENABLE_MEDIA_VISION = previousEnabled;
    if (previousKey == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel == null) delete process.env.MEDIA_VISION_MODEL;
    else process.env.MEDIA_VISION_MODEL = previousModel;
  }
});
