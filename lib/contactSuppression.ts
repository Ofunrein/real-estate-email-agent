/**
 * Contact suppression — the single source of truth for "may an agent send to
 * this lead right now?".
 *
 * Why this module exists: the STOP keyword was being *recorded* correctly
 * (channelIngest writes sms_consent="no", next_action="do_not_contact") but
 * never *enforced* on the live reply path. `planAgentAction` does check
 * `lead.smsConsent`, but the value it saw came from job metadata that both SMS
 * and WhatsApp webhooks hardcoded to the literal "inbound_text" — a string
 * that can never match the opted-out pattern. The opt-out was a database row
 * nothing on the send path read.
 *
 * Two properties this module guarantees:
 *
 *   Sticky. `mergeNonEmpty` lets any later write with a non-empty value
 *   overwrite an earlier one, so the very next inbound message would set
 *   next_action back to "review_or_reply" and silently clear the opt-out.
 *   `do_not_contact` is therefore a dedicated boolean that only an explicit
 *   opt-IN may clear.
 *
 *   Cross-channel. A lead who texts STOP has withdrawn consent to be contacted
 *   by the agent, not merely to receive SMS. Automated outbound is blocked on
 *   every channel until they opt back in.
 *
 * Scope: this suppresses AUTOMATED agent sends (Iris/Theo/Aria replies and
 * cadence touches). It deliberately does not block a human operator's manual
 * reply from the dashboard — that is a person's accountable decision, and
 * blocking it would also block the operator from answering "why did I get
 * this?". Operators are told this in docs/runbooks/sms-delivery.md.
 */

import type { SheetRow } from "@/lib/sheetSchema";

export type SuppressibleChannel =
  | "sms"
  | "whatsapp"
  | "voice"
  | "email"
  | "instagram"
  | "messenger"
  | "website_chat";

export type SuppressionVerdict = {
  suppressed: boolean;
  /** Stable code for audit rows and tests. "" when not suppressed. */
  code: "" | "do_not_contact" | "sms_opted_out" | "email_opted_out";
  reason: string;
};

const ALLOWED = { suppressed: false, code: "", reason: "" } as const;

const TEXT_CHANNELS = new Set<SuppressibleChannel>(["sms", "whatsapp"]);

function text(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Mirrors the truthiness `boolDbValue` writes for the do_not_contact column. */
export function isDoNotContact(lead: Partial<SheetRow> | undefined): boolean {
  const value = text(lead?.do_not_contact);
  if (["true", "1", "yes", "y", "on"].includes(value)) return true;
  // Legacy rows encoded the same intent in these two free-text fields.
  return text(lead?.next_action) === "do_not_contact" || text(lead?.handoff_status) === "do_not_contact";
}

function consentWithdrawn(value: unknown): boolean {
  return ["no", "n", "false", "stop", "opted_out", "do_not_contact", "unsubscribed"].includes(text(value));
}

/**
 * May an automated agent send on this channel?
 *
 * Reads the STORED lead row. Callers must load it from the database rather
 * than pass through whatever the inbound webhook happened to attach.
 */
export function channelSuppression(
  lead: Partial<SheetRow> | undefined,
  channel: SuppressibleChannel,
): SuppressionVerdict {
  if (!lead) return { ...ALLOWED };

  if (isDoNotContact(lead)) {
    return {
      suppressed: true,
      code: "do_not_contact",
      reason: "Lead is marked do-not-contact. Automated outbound is blocked on every channel.",
    };
  }

  if (TEXT_CHANNELS.has(channel) || channel === "voice") {
    // A text opt-out withdraws consent to be contacted, not merely to receive
    // SMS, so it also stops the calling cadence.
    const smsWithdrawn = consentWithdrawn(lead.sms_consent);
    const whatsappWithdrawn = channel === "whatsapp" && consentWithdrawn(lead.whatsapp_consent);
    if (smsWithdrawn || whatsappWithdrawn) {
      return {
        suppressed: true,
        code: "sms_opted_out",
        reason: "Lead opted out of text messages. Automated texts and calls are blocked.",
      };
    }
  }

  if (channel === "voice" && consentWithdrawn(lead.call_consent)) {
    return { suppressed: true, code: "sms_opted_out", reason: "Lead withdrew call consent." };
  }

  if (channel === "email" && consentWithdrawn(lead.email_consent)) {
    return { suppressed: true, code: "email_opted_out", reason: "Lead unsubscribed from email." };
  }

  return { ...ALLOWED };
}

/**
 * Lead-memory patch recording an opt-out. Written on the STOP path so the flag
 * lands in a column no later merge can clear.
 */
export function optOutPatch(channel: SuppressibleChannel): Partial<SheetRow> {
  const patch: Partial<SheetRow> = {
    do_not_contact: "true",
    next_action: "do_not_contact",
    handoff_status: "human_review",
  };
  if (channel === "sms" || channel === "whatsapp" || channel === "voice") patch.sms_consent = "no";
  if (channel === "whatsapp") patch.whatsapp_consent = "no";
  if (channel === "voice") patch.call_consent = "no";
  if (channel === "email") patch.email_consent = "no";
  return patch;
}

/**
 * Lead-memory patch recording an explicit opt-IN (START/UNSTOP). The only
 * thing permitted to clear do_not_contact.
 */
export function optInPatch(channel: SuppressibleChannel): Partial<SheetRow> {
  // Must clear the legacy free-text encodings too. isDoNotContact() reads
  // next_action and handoff_status as opt-out signals, so leaving either at
  // "do_not_contact" would keep the lead suppressed after an explicit START.
  const patch: Partial<SheetRow> = {
    do_not_contact: "false",
    next_action: `continue_${channel}`,
    handoff_status: "",
  };
  if (channel === "sms" || channel === "whatsapp") patch.sms_consent = "yes";
  if (channel === "whatsapp") patch.whatsapp_consent = "yes";
  if (channel === "voice") patch.call_consent = "yes";
  if (channel === "email") patch.email_consent = "yes";
  return patch;
}

/**
 * Sticky-merge guard for lead_memory writes.
 *
 * `mergeNonEmpty` is last-write-wins per field. Without this, the inbound
 * message immediately after a STOP writes next_action="review_or_reply" and
 * the opt-out evaporates. Only an explicit opt-in (do_not_contact set to a
 * falsey value by optInPatch) may lift it.
 */
export function preserveSuppression(existing: SheetRow, incoming: Partial<SheetRow>, merged: SheetRow): SheetRow {
  if (!isDoNotContact(existing)) return merged;

  const explicitOptIn = String(incoming.do_not_contact ?? "").trim() !== ""
    && !isDoNotContact({ do_not_contact: incoming.do_not_contact });
  if (explicitOptIn) return merged;

  return {
    ...merged,
    do_not_contact: "true",
    next_action: "do_not_contact",
    sms_consent: consentWithdrawn(existing.sms_consent) ? "no" : merged.sms_consent,
  };
}
