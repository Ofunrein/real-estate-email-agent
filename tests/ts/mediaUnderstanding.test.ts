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
