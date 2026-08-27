import { createHmac, timingSafeEqual } from "node:crypto";

export const ONBOARDING_STATES = [
  "commercial_pending", "intake_sent", "intake_complete", "access_pending",
  "configured", "sandbox_ready", "launch_review", "live", "blocked",
] as const;
export type OnboardingState = typeof ONBOARDING_STATES[number];

export type TypeformAnswer = {
  field?: { id?: string; ref?: string; type?: string };
  text?: string;
  email?: string;
  url?: string;
  phone_number?: string;
  boolean?: boolean;
  number?: number;
  choice?: { label?: string };
  choices?: { labels?: string[] };
};

export type TypeformWebhook = {
  event_id?: string;
  event_type?: string;
  form_response?: {
    form_id?: string;
    token?: string;
    submitted_at?: string;
    hidden?: Record<string, string>;
    answers?: TypeformAnswer[];
  };
};

export const ONBOARDING_KEYS = [
  "primary_contact_name", "primary_contact_email", "company_name", "website_url", "contact_role",
  "team_size", "priority_workflow", "lead_sources", "mail_provider", "mailbox_address", "crm_system",
  "calendar_system", "human_review_rules", "urgent_handoff_owner", "urgent_handoff_channels", "voice_style",
  "source_material_links", "additional_notes", "connection_authorization", "systems_to_connect",
  "website_access_method", "website_admin_identifier", "connection_approver", "team_names", "phone_numbers",
] as const;
export type OnboardingKey = typeof ONBOARDING_KEYS[number];
export type OnboardingIntake = Record<OnboardingKey, string>;

const ALIASES: Record<string, OnboardingKey> = {
  name: "primary_contact_name", full_name: "primary_contact_name", primary_contact_name: "primary_contact_name",
  email: "primary_contact_email", work_email: "primary_contact_email", primary_contact_email: "primary_contact_email",
  company: "company_name", brokerage_name: "company_name", company_name: "company_name",
  website: "website_url", website_url: "website_url", role: "contact_role", contact_role: "contact_role",
  main_goal: "priority_workflow", priority_workflow: "priority_workflow", lead_sources: "lead_sources",
  inbox_provider: "mail_provider", mail_provider: "mail_provider",
  iris_inbox_address: "mailbox_address", mailbox_address: "mailbox_address", iris_inbox: "mailbox_address",
  crm: "crm_system", crm_system: "crm_system",
  calendar: "calendar_system", calendar_system: "calendar_system", human_review_rules: "human_review_rules",
  urgent_handoff_owner: "urgent_handoff_owner", urgent_handoff_channels: "urgent_handoff_channels",
  voice_style: "voice_style", source_material_links: "source_material_links", additional_notes: "additional_notes",
  connection_authorization: "connection_authorization", systems_to_connect: "systems_to_connect",
  website_access_method: "website_access_method", website_admin_identifier: "website_admin_identifier",
  connection_approver: "connection_approver", team_size: "team_size", team_names: "team_names",
  human_review: "human_review_rules", escalation: "urgent_handoff_owner", brand_voice: "voice_style",
  examples: "source_material_links", anything_else: "additional_notes",
  phone_numbers: "phone_numbers",
};

function answerValue(answer: TypeformAnswer): string {
  if (typeof answer.text === "string") return answer.text;
  if (typeof answer.email === "string") return answer.email;
  if (typeof answer.url === "string") return answer.url;
  if (typeof answer.phone_number === "string") return answer.phone_number;
  if (typeof answer.boolean === "boolean") return String(answer.boolean);
  if (typeof answer.number === "number") return String(answer.number);
  if (answer.choice?.label) return answer.choice.label;
  if (answer.choices?.labels) return answer.choices.labels.join(", ");
  return "";
}

export function normalizeTypeformResponse(payload: TypeformWebhook): OnboardingIntake {
  const normalized = Object.fromEntries(ONBOARDING_KEYS.map((key) => [key, ""])) as OnboardingIntake;
  for (const answer of payload.form_response?.answers || []) {
    const ref = String(answer.field?.ref || "").trim().toLowerCase();
    const key = ALIASES[ref];
    if (key) normalized[key] = answerValue(answer).trim();
  }
  return normalized;
}

export const REQUIRED_INTAKE_KEYS: OnboardingKey[] = [
  "primary_contact_name", "primary_contact_email", "company_name", "mailbox_address",
  "human_review_rules", "urgent_handoff_owner", "connection_approver",
];

export function missingIntakeFields(intake: OnboardingIntake): OnboardingKey[] {
  return REQUIRED_INTAKE_KEYS.filter((key) => !intake[key].trim());
}

export function slugifyChannelPart(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "client";
}

export function plannedPrivateChannels(intake: OnboardingIntake): string[] {
  const company = slugifyChannelPart(intake.company_name);
  const names = [`client-${company}-iris`];
  const teams = intake.team_names.split(/[,\n]/).map(slugifyChannelPart).filter(Boolean);
  const numbers = intake.phone_numbers.split(/[,\n]/).map((number) => number.replace(/\D/g, "").slice(-10)).filter(Boolean);
  for (const team of teams) names.push(`client-${company}-${team}`);
  for (const number of numbers) names.push(`client-${company}-${number}`);
  return [...new Set(names)].map((name) => name.slice(0, 80));
}

export function verifyTypeformSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("base64")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
