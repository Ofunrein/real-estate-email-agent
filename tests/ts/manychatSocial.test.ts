import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSocialRouterResult,
  formatManyChatDynamicBlock,
  normalizeManyChatPayload,
  shouldTheoHandleSocialDm,
  shouldTheoHandleDirectMetaDm,
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

test("shouldTheoHandleSocialDm: flags personal social messages but still lets the agent reply", () => {
  const input = normalizeManyChatPayload({
    channel: "instagram",
    message_text: "Happy birthday lol how are you?",
    contact_id: "contact_3",
  });
  const guard = shouldTheoHandleSocialDm(input);
  assert.equal(guard.allowed, true);
  assert.equal(guard.needsHuman, true);
  assert.equal(guard.intent, "personal_social");
});

test("shouldTheoHandleSocialDm: defaults low-confidence social DMs to reply plus human flag", () => {
  const guard = shouldTheoHandleSocialDm({
    channel: "instagram",
    messageText: "Hmm what else do you have in inventory",
    contactId: "contact_5",
    threadId: "contact_5",
    senderName: "Lead Five",
    senderUsername: "lead.five",
    accountLabel: "Instagram",
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  });

  assert.equal(guard.allowed, true);
assert.equal(guard.needsHuman, false);
assert.equal(guard.intent, "real_estate_intent");
});

test("shouldTheoHandleDirectMetaDm: defaults direct channel DMs to the agent without human flag", () => {
  const guard = shouldTheoHandleDirectMetaDm({
    channel: "instagram",
    messageText: "Hmm what else do you have in inventory",
    contactId: "contact_5",
    threadId: "contact_5",
    senderName: "Lead Five",
    senderUsername: "lead.five",
    accountLabel: "Instagram",
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  });

  assert.equal(guard.allowed, true);
  assert.equal(guard.needsHuman, false);
  assert.equal(guard.intent, "real_estate_intent");
});

test("shouldTheoHandleDirectMetaDm: still blocks clearly human-required messages", () => {
  const guard = shouldTheoHandleDirectMetaDm({
    channel: "instagram",
    messageText: "I need a lawyer for contract terms",
    contactId: "contact_6",
    threadId: "contact_6",
    senderName: "Lead Six",
    senderUsername: "lead.six",
    accountLabel: "Instagram",
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  });

  assert.equal(guard.allowed, true);
  assert.equal(guard.needsHuman, true);
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

test("buildSocialRouterResult: safe needs-human replies stay sendable and flagged", () => {
  const result = buildSocialRouterResult({
    channel: "instagram",
    threadRef: "instagram:lead_1",
    reply: {
      shouldSend: true,
      reply: "I can help with that. What area and budget should I use?",
      mediaUrls: [],
      status: "needs_human",
      handoffReason: "lead requested nuanced guidance",
      classification: {
        intent: "property_details",
        leadRole: "buyer",
        handoffReason: "lead requested nuanced guidance",
        status: "needs_human",
      },
    },
  });

  assert.equal(result.should_send, true);
  assert.equal(result.needs_human, true);
  assert.equal(result.status, "ready_to_send");
  assert.equal(result.reply, "I can help with that. What area and budget should I use?");
  assert.equal(result.reason, "lead requested nuanced guidance");
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

test("shouldTheoHandleDirectMetaDm: low-confidence shared posts are review-only", () => {
  const guard = shouldTheoHandleDirectMetaDm({
    channel: "instagram",
    messageText: "Attachment context: motivational entrepreneurship reel instagram.com/reel/example",
    contactId: "contact_7",
    threadId: "contact_7",
    senderName: "Lead Seven",
    senderUsername: "lead.seven",
    accountLabel: "Instagram",
    routeReason: "",
    campaign: "",
    listingAddress: "",
    sourceUrl: "",
  });
  const result = buildSocialRouterResult({
    channel: "instagram",
    threadRef: "instagram:contact_7",
    guard,
    reply: {
      shouldSend: true,
      reply: "What would you like me to look for from that post?",
      mediaUrls: [],
      classification: { intent: "general_question", leadRole: "unknown", handoffReason: "", status: "ready_to_reply" },
    },
  });

  assert.equal(guard.allowed, true);
  assert.equal(guard.needsHuman, true);
  assert.equal(guard.intent, "low_confidence_media_or_dm");
  assert.equal(result.should_send, false);
  assert.equal(result.status, "needs_human");
  assert.equal(result.reply, "");
});
