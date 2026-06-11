#!/usr/bin/env node

const [messageArg, fromArg, urlArg] = process.argv.slice(2);
const message = messageArg || "I want to tour 12400 Cedar St";
const from = fromArg || process.env.TEST_SMS_FROM || process.env.AGENT_PHONE || "+15128152032";
const url = urlArg || process.env.THEO_SMS_TEST_URL || "http://localhost:3000/api/webhooks/theo-sms";

function addQueryParam(targetUrl, key, value) {
  const separator = targetUrl.includes("?") ? "&" : "?";
  return `${targetUrl}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

const payload = new URLSearchParams({
  From: from,
  To: process.env.TWILIO_FROM || "+15128469460",
  Body: message,
  MessageSid: `SM_TEST_${Date.now()}`,
});

const secret = process.env.CHANNEL_WEBHOOK_SECRET || "";
const debugUrl = addQueryParam(url, "debug", "json");
const requestUrl = secret ? addQueryParam(debugUrl, "secret", secret) : debugUrl;
const response = await fetch(requestUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: payload.toString(),
});

const body = await response.text();
console.log(`Theo SMS test -> ${response.status} ${response.statusText}`);
try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body);
}
