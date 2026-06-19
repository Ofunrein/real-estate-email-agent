import fs from "node:fs";

function loadDotEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isRcsChannelSender(sender) {
  const sid = String(sender?.sid || "");
  const senderType = String(sender?.sender_type || "");
  const senderName = String(sender?.sender || "");
  return (
    senderType.toUpperCase() === "RCS"
    || senderName.toLowerCase().startsWith("rcs:")
    || sid.toLowerCase().startsWith("rcs:")
  );
}

async function twilioRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload.message || response.statusText || `Twilio request failed: ${url}`));
  }
  return payload;
}

async function listTwilioCollection(baseUrl) {
  const items = [];
  let nextUrl = baseUrl;
  while (nextUrl) {
    const payload = await twilioRequest(nextUrl, { headers: { Authorization: auth } });
    const key = Object.keys(payload).find((name) => Array.isArray(payload[name]));
    if (key) items.push(...payload[key]);
    nextUrl = payload.next_page_uri ? `https://messaging.twilio.com${payload.next_page_uri}` : "";
  }
  return items;
}

loadDotEnv();

const accountSid = required("TWILIO_ACCOUNT_SID");
const authToken = required("TWILIO_AUTH_TOKEN");
const serviceSid = required("TWILIO_MESSAGING_SERVICE_SID");
const twilioFrom = required("TWILIO_FROM");
const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
const webhookSecret = process.env.CHANNEL_WEBHOOK_SECRET || "";
const inbound = new URL(`${publicBaseUrl}/api/webhooks/theo-sms`);
if (webhookSecret) inbound.searchParams.set("secret", webhookSecret);
const inboundUrl = inbound.toString();
const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

const response = await fetch(`https://messaging.twilio.com/v1/Services/${encodeURIComponent(serviceSid)}`, {
  method: "POST",
  headers: {
    Authorization: auth,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    InboundRequestUrl: inboundUrl,
    InboundMethod: "POST",
    UseInboundWebhookOnNumber: "false",
  }).toString(),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(String(payload.message || response.statusText || "Twilio Messaging Service update failed"));
}

console.log(JSON.stringify({
  sid: payload.sid,
  friendly_name: payload.friendly_name,
  inbound_request_url: payload.inbound_request_url,
  inbound_method: payload.inbound_method,
  use_inbound_webhook_on_number: payload.use_inbound_webhook_on_number,
}, null, 2));

const channelSenders = await listTwilioCollection(
  `https://messaging.twilio.com/v1/Services/${encodeURIComponent(serviceSid)}/ChannelSenders?PageSize=100`,
);
const rcsSenders = channelSenders.filter(isRcsChannelSender);
const removedRcsSenders = [];

for (const sender of rcsSenders) {
  const deleteResponse = await fetch(
    `https://messaging.twilio.com/v1/Services/${encodeURIComponent(serviceSid)}/ChannelSenders/${encodeURIComponent(sender.sid)}`,
    {
      method: "DELETE",
      headers: { Authorization: auth },
    },
  );
  if (!deleteResponse.ok && deleteResponse.status !== 204) {
    const deletePayload = await deleteResponse.json().catch(() => ({}));
    throw new Error(String(deletePayload.message || deleteResponse.statusText || `Failed to remove RCS sender ${sender.sid}`));
  }
  removedRcsSenders.push({
    sid: sender.sid,
    sender_type: sender.sender_type,
    sender: sender.sender,
  });
}

console.log(JSON.stringify({
  rcs_senders_removed_count: removedRcsSenders.length,
  rcs_senders_removed: removedRcsSenders,
}, null, 2));

const numbersResponse = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(twilioFrom)}`,
  { headers: { Authorization: auth } },
);
const numbersPayload = await numbersResponse.json().catch(() => ({}));
if (!numbersResponse.ok) {
  throw new Error(String(numbersPayload.message || numbersResponse.statusText || "Twilio phone number lookup failed"));
}

const phoneNumber = numbersPayload.incoming_phone_numbers?.[0];
if (!phoneNumber?.sid) {
  throw new Error(`No Twilio incoming phone number found for ${twilioFrom}`);
}

const numberResponse = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumber.sid)}.json`,
  {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      SmsUrl: inboundUrl,
      SmsMethod: "POST",
    }).toString(),
  },
);
const numberPayload = await numberResponse.json().catch(() => ({}));
if (!numberResponse.ok) {
  throw new Error(String(numberPayload.message || numberResponse.statusText || "Twilio phone number update failed"));
}

console.log(JSON.stringify({
  phone_number: numberPayload.phone_number,
  phone_number_sid: numberPayload.sid,
  sms_url: numberPayload.sms_url,
  sms_method: numberPayload.sms_method,
  voice_url_preserved: numberPayload.voice_url,
}, null, 2));

const servicePhoneNumbers = await listTwilioCollection(
  `https://messaging.twilio.com/v1/Services/${encodeURIComponent(serviceSid)}/PhoneNumbers?PageSize=100`,
);
const remainingChannelSenders = await listTwilioCollection(
  `https://messaging.twilio.com/v1/Services/${encodeURIComponent(serviceSid)}/ChannelSenders?PageSize=100`,
);
const remainingRcs = remainingChannelSenders.filter(isRcsChannelSender);

console.log(JSON.stringify({
  sender_pool: {
    phone_numbers: servicePhoneNumbers.map((entry) => ({
      sid: entry.sid,
      phone_number: entry.phone_number,
      country_code: entry.country_code,
    })),
    channel_senders: remainingChannelSenders.map((entry) => ({
      sid: entry.sid,
      sender_type: entry.sender_type,
      sender: entry.sender,
    })),
    rcs_remaining_count: remainingRcs.length,
    sms_only: remainingRcs.length === 0,
  },
}, null, 2));

if (remainingRcs.length > 0) {
  throw new Error(`Messaging service still has ${remainingRcs.length} RCS sender(s) after cleanup`);
}
