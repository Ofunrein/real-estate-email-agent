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

export function paidCustomer(event: StripeEvent): { email: string; name: string; customerId: string; amount: number; currency: string } | null {
  if (!event.type || !["checkout.session.completed", "invoice.paid"].includes(event.type)) return null;
  const object = event.data?.object || {};
  if (event.type === "checkout.session.completed" && object.payment_status !== "paid") return null;
  const details = (object.customer_details && typeof object.customer_details === "object" ? object.customer_details : {}) as Record<string, unknown>;
  const email = text(details.email) || text(object.customer_email);
  if (!email) return null;
  return {
    email,
    name: text(details.name) || text(object.customer_name),
    customerId: text(object.customer),
    amount: Number(object.amount_total || object.amount_paid || 0),
    currency: text(object.currency).toUpperCase(),
  };
}

export function kickoffEmailHtml(input: { name: string; intakeUrl: string; bookingUrl: string }): string {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : "Hi,";
  return `<p>${greeting}</p><p>Your payment is confirmed. We can now prepare Iris for your business.</p><ol><li><strong>Onboarding form:</strong> <a href="${escapeHtml(input.intakeUrl)}">complete the short setup form</a>. It should take about 5 minutes.</li><li><strong>Kickoff call:</strong> <a href="${escapeHtml(input.bookingUrl)}">choose a kickoff time</a>. Invite the person who can approve inbox, CRM, calendar, website, and domain connections.</li><li><strong>Access:</strong> Do not email passwords or API keys. We will use OAuth, temporary administrator invites, or a secure temporary-access link.</li></ol><p>During kickoff, we will confirm scope, connect the required systems, set review and escalation rules, and agree on the sandbox test and launch approval.</p><p>Martin<br>Lumenosis</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}

export async function sendKickoffEmail(input: { to: string; name: string }): Promise<string> {
  const apiKey = process.env.AGENTMAIL_API_KEY || "";
  const inbox = process.env.ONBOARDING_EMAIL_INBOX || "olivia@trylumenosis.com";
  const intakeUrl = process.env.TYPEFORM_ONBOARDING_URL || "https://form.typeform.com/to/v3hPCHwT";
  const bookingUrl = process.env.ONBOARDING_KICKOFF_BOOKING_URL || "";
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY is required");
  if (!bookingUrl) throw new Error("ONBOARDING_KICKOFF_BOOKING_URL is required");
  const response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: input.to,
      subject: "Payment confirmed: complete your Iris kickoff steps",
      html: kickoffEmailHtml({ name: input.name, intakeUrl, bookingUrl }),
      labels: ["onboarding", "payment-confirmed"],
    }),
  });
  const body = await response.json() as { message_id?: string; id?: string; message?: string };
  const messageId = body.message_id || body.id;
  if (!response.ok || !messageId) throw new Error(`AgentMail failed (${response.status}): ${body.message || "unknown error"}`);
  return messageId;
}
