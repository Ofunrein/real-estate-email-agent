import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSocialRouterResult,
  formatManyChatDynamicBlock,
  normalizeManyChatPayload,
  shouldTheoHandleSocialDm,
  socialDmIngestInput,
  socialMediaUrls,
} from "@/lib/manychatSocial";

test("normalizeManyChatPayload: maps common ManyChat fields", () => {
  const input = normalizeManyChatPayload({
    channel: "ig",
    last_text_input: "Is 4309 Fairway Path available?",
    contact_id: "contact_1",
    contact_name: "ignored",
    sender_name: "Lead One",
    route_reason: "listing-question",
    listing_address: "4309 Fairway Path",
  });
  assert.equal(input.channel, "instagram");
  assert.equal(input.messageText, "Is 4309 Fairway Path available?");
  assert.equal(input.contactId, "contact_1");
  assert.equal(input.routeReason, "listing_question");
});

test("shouldTheoHandleSocialDm: allows routed real estate messages", () => {
  const input = normalizeManyChatPayload({
    channel: "messenger",
    message_text: "Can I tour this 3 bed listing?",
    contact_id: "contact_2",
    route_reason: "showing_request",
  });
  const guard = shouldTheoHandleSocialDm(input);
  assert.equal(guard.allowed, true);
  assert.equal(guard.needsHuman, false);
});

test("shouldTheoHandleSocialDm: blocks personal social messages", () => {
  const input = normalizeManyChatPayload({
    channel: "instagram",
    message_text: "Happy birthday lol how are you?",
    contact_id: "contact_3",
  });
  const guard = shouldTheoHandleSocialDm(input);
  assert.equal(guard.allowed, false);
  assert.equal(guard.needsHuman, true);
  assert.equal(guard.intent, "personal_social");
});

test("socialDmIngestInput: stores separate social channel thread refs", () => {
  const input = normalizeManyChatPayload({
    channel: "messenger",
    message_text: "What is the price?",
    contact_id: "contact_4",
    route_reason: "listing_question",
  });
  const ingest = socialDmIngestInput(input, shouldTheoHandleSocialDm(input));
  assert.equal(ingest.channel, "messenger");
  assert.equal(ingest.threadRef, "messenger:contact_4");
  assert.equal(ingest.phone, "contact_4");
  assert.equal(ingest.source, "manychat");
  assert.equal(ingest.agentName, "Iris");
});

test("formatManyChatDynamicBlock: formats Messenger text plus image", () => {
  const result = buildSocialRouterResult({
    channel: "messenger",
    threadRef: "messenger:1",
    reply: {
      shouldSend: true,
      reply: "Here are the photos.",
      mediaUrls: ["https://photos.zillowstatic.com/fp/abc-p_e.jpg"],
      classification: { intent: "property_details", leadRole: "buyer", handoffReason: "", status: "ready_to_reply" },
    },
    baseUrl: "https://app.example.com",
  });
  const block = formatManyChatDynamicBlock(result);
  assert.equal(block.version, "v2");
  assert.deepEqual(block.content.messages?.map((message) => message.type), ["text", "image"]);
  assert.equal(block.content.type, undefined);
});

test("formatManyChatDynamicBlock: marks Instagram content type", () => {
  const result = buildSocialRouterResult({
    channel: "instagram",
    threadRef: "instagram:1",
    reply: {
      shouldSend: true,
      reply: "Yes, it is available.",
      mediaUrls: [],
      classification: { intent: "property_details", leadRole: "buyer", handoffReason: "", status: "ready_to_reply" },
    },
  });
  const block = formatManyChatDynamicBlock(result);
  assert.equal(block.content.type, "instagram");
  assert.equal(block.content.messages?.[0]?.text, "Yes, it is available.");
});

test("socialMediaUrls: caps image URLs and returns direct URLs", () => {
  const prior = process.env.SOCIAL_DM_MAX_IMAGES;
  process.env.SOCIAL_DM_MAX_IMAGES = "1";
  const urls = socialMediaUrls(
    [
      "https://photos.zillowstatic.com/fp/abc-p_e.jpg",
      "https://photos.zillowstatic.com/fp/def-p_e.jpg",
    ],
    "https://app.example.com",
  );
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/photos\.zillowstatic\.com\//);
  if (prior == null) delete process.env.SOCIAL_DM_MAX_IMAGES;
  else process.env.SOCIAL_DM_MAX_IMAGES = prior;
});
