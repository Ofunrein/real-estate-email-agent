import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyStripeSignature(rawBody: string, header: string, secret: string, now = Date.now()): boolean {
  if (!rawBody || !header || !secret) return false;
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1] || "";
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return signatures.some((signature) => safeEqual(expected, signature));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function paidCustomer(event: StripeEvent): { email: string; name: string; phone: string; companyName: string; plan: string; agreementVersion: string; smsConsent: boolean; customerId: string; amount: number; currency: string } | null {
  if (!event.type || !["checkout.session.completed", "invoice.paid"].includes(event.type)) return null;
  const object = event.data?.object || {};
  if (event.type === "checkout.session.completed" && object.payment_status !== "paid") return null;
  if (event.type === "invoice.paid" && object.billing_reason !== "subscription_create") return null;
  const details = (object.customer_details && typeof object.customer_details === "object" ? object.customer_details : {}) as Record<string, unknown>;
  const metadata = (object.metadata && typeof object.metadata === "object" ? object.metadata : {}) as Record<string, unknown>;
  const email = text(details.email) || text(object.customer_email);
  if (!email) return null;
  return {
    email,
    name: text(details.name) || text(object.customer_name),
    phone: text(details.phone) || text(object.customer_phone),
    companyName: text(metadata.company_name),
    plan: text(metadata.plan) || text(metadata.plan_name),
    agreementVersion: text(metadata.agreement_version),
    smsConsent: text(metadata.onboarding_sms_consent).toLowerCase() === "true",
    customerId: text(object.customer),
    amount: Number(object.amount_total || object.amount_paid || 0),
    currency: text(object.currency).toUpperCase(),
  };
}

export function kickoffEmailHtml(input: { name: string; intakeUrl: string; bookingUrl: string }): string {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : "Hi,";
  const intakeUrl = escapeHtml(input.intakeUrl);
  const bookingUrl = escapeHtml(input.bookingUrl);
  const buttonStyle = "display:inline-block;background:#20201e;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:9px;";
  return `<div style="margin:0;background:#f6f3ee;padding:32px 16px;font-family:Arial,sans-serif;color:#20201e;line-height:1.6;"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e5ded4;border-radius:14px;overflow:hidden;"><div style="padding:24px 32px;border-bottom:1px solid #eee8df;"><img src="https://lumenosis.com/images/lumenosis-logo-warm-rounded.png" width="170" alt="Lumenosis" style="display:block;max-width:170px;height:auto;"></div><div style="padding:32px;"><p style="margin:0 0 18px;">${greeting}</p><p style="margin:0 0 22px;">Your payment is confirmed. We can now prepare Iris for your business.</p><h2 style="font-size:18px;margin:0 0 10px;">1. Complete your onboarding form</h2><p style="margin:0 0 16px;">Tell us how your business works and where Iris should begin. It should take about 5 minutes.</p><p style="margin:0 0 28px;"><a href="${intakeUrl}" style="${buttonStyle}">Complete onboarding form</a></p><h2 style="font-size:18px;margin:0 0 10px;">2. Choose your kickoff time</h2><p style="margin:0 0 16px;">Invite the person who can approve inbox, CRM, calendar, website, and domain connections.</p><p style="margin:0 0 28px;"><a href="${bookingUrl}" style="${buttonStyle}">Schedule kickoff call</a></p><div style="background:#f6f3ee;border-radius:10px;padding:16px 18px;margin:0 0 24px;"><strong>Keep access secure</strong><br>Do not email passwords or API keys. We will use OAuth, temporary administrator invites, or a secure temporary-access link.</div><p style="margin:0 0 22px;">During kickoff, we will confirm scope, connect the required systems, set review and escalation rules, and agree on the sandbox test and launch approval.</p><p style="margin:0;">Olivia<br><span style="color:#6e675f;">Client Onboarding, Lumenosis</span></p></div></div></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}

export async function sendKickoffEmail(input: { to: string; name: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.ONBOARDING_EMAIL_FROM || "Olivia <olivia@trylumenosis.com>";
  const intakeUrl = process.env.TYPEFORM_ONBOARDING_URL || "https://form.typeform.com/to/v3hPCHwT";
  const bookingUrl = process.env.ONBOARDING_KICKOFF_BOOKING_URL || "";
  if (!bookingUrl) throw new Error("ONBOARDING_KICKOFF_BOOKING_URL is required");
  if (!apiKey) throw new Error("RESEND_API_KEY is required");
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Payment confirmed: complete your Iris kickoff steps",
      html: kickoffEmailHtml({ name: input.name, intakeUrl, bookingUrl }),
      tags: [
        { name: "workflow", value: "onboarding" },
        { name: "trigger", value: "payment-confirmed" },
      ],
    }),
  });
  const body = await response.json() as { id?: string; message?: string };
  const messageId = body.id;
  if (!response.ok || !messageId) throw new Error(`Resend failed (${response.status}): ${body.message || "unknown error"}`);
  return messageId;
}

export async function sendKickoffSms(
  input: { to: string; name: string; consent: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<{ skipped: boolean; id: string }> {
  if (!input.consent || !input.to) return { skipped: true, id: "" };
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.ONBOARDING_TWILIO_FROM || "";
  const messagingServiceSid = process.env.ONBOARDING_TWILIO_MESSAGING_SERVICE_SID || "";
  const intakeUrl = process.env.TYPEFORM_ONBOARDING_URL || "https://form.typeform.com/to/v3hPCHwT";
  const bookingUrl = process.env.ONBOARDING_KICKOFF_BOOKING_URL || "";
  // Onboarding must never borrow Iris/Theo's production demo sender. It requires
  // a dedicated number or Messaging Service configured specifically for onboarding.
  if (!accountSid || !authToken || (!from && !messagingServiceSid) || !bookingUrl) return { skipped: true, id: "" };
  const form = new URLSearchParams({
    To: input.to,
    Body: `Hi${input.name ? ` ${input.name}` : ""}, payment is confirmed. Complete onboarding: ${intakeUrl} Book kickoff: ${bookingUrl} Reply STOP to opt out.`,
  });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from);
  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: ["Basic", Buffer.from(`${accountSid}:${authToken}`).toString("base64")].join(" "),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const payload = await response.json().catch(() => ({})) as { sid?: string };
  if (!response.ok || !payload.sid) throw new Error(`Twilio onboarding SMS failed (${response.status})`);
  return { skipped: false, id: payload.sid };
}
