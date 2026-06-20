#!/usr/bin/env node

const BASE_URL = (process.env.PUBLIC_BASE_URL || process.argv.find((arg) => arg.startsWith("http")) || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CHANNEL_WEBHOOK_SECRET || "";

const samples = [
  {
    name: "instagram listing photo",
    format: "manychat",
    body: {
      channel: "instagram",
      message_text: "Can you send photos of 4309 Fairway Path?",
      contact_id: "mc_ig_123",
      sender_name: "Test Lead",
      route_reason: "listing_question",
      campaign: "listing_comment_dm",
      listing_address: "4309 Fairway Path",
    },
  },
  {
    name: "messenger showing",
    format: "manychat",
    body: {
      channel: "messenger",
      message_text: "Is this available for a tour tomorrow?",
      contact_id: "mc_fb_123",
      sender_name: "Test Lead",
      route_reason: "showing_request",
    },
  },
  {
    name: "personal handoff",
    format: "json",
    body: {
      channel: "instagram",
      message_text: "Happy birthday lol how are you?",
      contact_id: "mc_ig_personal",
      sender_name: "Friend",
    },
  },
];

for (const sample of samples) {
  const url = new URL(`${BASE_URL}/api/webhooks/theo-social-router`);
  if (sample.format === "manychat") url.searchParams.set("format", "manychat");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SECRET ? { "x-lumenosis-webhook-secret": SECRET } : {}),
    },
    body: JSON.stringify(sample.body),
  });
  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ name: sample.name, status: response.status, payload }, null, 2));
}
