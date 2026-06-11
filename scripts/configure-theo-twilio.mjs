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

loadDotEnv();

const accountSid = required("TWILIO_ACCOUNT_SID");
const authToken = required("TWILIO_AUTH_TOKEN");
const serviceSid = required("TWILIO_MESSAGING_SERVICE_SID");
const twilioFrom = required("TWILIO_FROM");
const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
const inboundUrl = `${publicBaseUrl}/api/webhooks/theo-sms`;
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
