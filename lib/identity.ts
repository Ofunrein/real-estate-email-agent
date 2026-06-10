// Cross-channel caller identity (Q3-C).
//
// resolveCaller(phone): phone match is instant and covers prior SMS/WhatsApp/
// voice history. When the phone is cold, the voice agent asks for an email or
// name and calls stitchByEmailOrName(); before trusting a stitched record it
// confirms a detail (buildConfirmation + confirmationMatches) so two different
// people who share a name are never silently merged.
//
// DB access is injected (IdentityDeps) so the resolver is unit-testable without
// a live Postgres connection. Pure helpers below take plain data.

import { findLeadInDatabase, readEventsForLeadFromDatabase } from "@/lib/database";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadIdentity";
import type { SheetRow } from "@/lib/sheetSchema";

export type IdentityDeps = {
  findLead: (incoming: Partial<SheetRow>) => Promise<SheetRow | null>;
  readEvents: (lead: { phone?: string; email?: string }, limit?: number) => Promise<SheetRow[]>;
};

const defaultDeps: IdentityDeps = {
  findLead: findLeadInDatabase,
  readEvents: readEventsForLeadFromDatabase,
};

export type CallerIdentity = {
  matched: boolean;
  lead: SheetRow | null;
  events: SheetRow[];
  channelsSeen: string[];
  lastTouchAt: string;
  // when matched=false the caller is cold; the agent should ask for email/name
  needsStitch: boolean;
};

// Distinct channels present in a lead's cross-channel history, most-used first.
export function summarizeChannels(events: SheetRow[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const channel = (event.channel || "").trim().toLowerCase();
    if (!channel) continue;
    counts.set(channel, (counts.get(channel) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([channel]) => channel);
}

// Most recent timestamp across events (event_at preferred, else empty).
export function lastTouchAt(events: SheetRow[]): string {
  let latest = "";
  for (const event of events) {
    const stamp = (event.event_at || "").trim();
    if (stamp && stamp > latest) latest = stamp;
  }
  return latest;
}

// Pick one non-sensitive detail the caller can verify to confirm a stitched
// record is really theirs. Returns null when nothing safe is available.
export function buildConfirmation(
  lead: SheetRow | null,
): { field: string; value: string; question: string } | null {
  if (!lead) return null;
  const candidates: Array<[string, string]> = [
    ["property_interest", "Which property were you asking about?"],
    ["area", "What area were you looking in?"],
    ["budget", "What budget did you mention?"],
  ];
  for (const [field, question] of candidates) {
    const value = (lead[field] || "").trim();
    if (value) return { field, value, question };
  }
  return null;
}

// Loose match for a spoken confirmation answer against the stored value.
// Substring either direction, case/space-insensitive — speech-to-text is fuzzy.
export function confirmationMatches(expected: string, spoken: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const want = norm(expected);
  const got = norm(spoken);
  if (!want || !got) return false;
  return want.includes(got) || got.includes(want);
}

// Among stitch candidates, prefer exact email match, then exact name match.
export function chooseStitchCandidate(
  candidates: SheetRow[],
  stated: { email?: string; name?: string },
): SheetRow | null {
  const email = normalizeEmail(stated.email);
  const name = normalizeName(stated.name);
  if (email) {
    const byEmail = candidates.find((lead) => normalizeEmail(lead.email) === email);
    if (byEmail) return byEmail;
  }
  if (name) {
    const byName = candidates.find((lead) => normalizeName(lead.full_name) === name);
    if (byName) return byName;
  }
  return candidates[0] || null;
}

// Phone-first resolution. Instant for any channel that shared this phone.
export async function resolveCaller(phone: string, deps: IdentityDeps = defaultDeps): Promise<CallerIdentity> {
  const normalized = normalizePhone(phone);
  const lead = normalized ? await deps.findLead({ phone }) : null;
  const events = lead ? await deps.readEvents({ phone: lead.phone, email: lead.email }) : [];
  return {
    matched: Boolean(lead),
    lead,
    events,
    channelsSeen: summarizeChannels(events),
    lastTouchAt: lastTouchAt(events),
    needsStitch: !lead,
  };
}

export type StitchResult = {
  lead: SheetRow | null;
  events: SheetRow[];
  // detail to verify before trusting the match; null when no match or nothing to confirm
  confirm: { field: string; value: string; question: string } | null;
};

// Cold-phone fallback: find a lead by stated email/name and surface a detail to
// confirm. Caller must verify (confirmationMatches) before the record is trusted.
export async function stitchByEmailOrName(
  stated: { email?: string; name?: string },
  deps: IdentityDeps = defaultDeps,
): Promise<StitchResult> {
  const candidates: SheetRow[] = [];
  if (stated.email) {
    const byEmail = await deps.findLead({ email: stated.email });
    if (byEmail) candidates.push(byEmail);
  }
  if (!candidates.length && stated.name) {
    const byName = await deps.findLead({ full_name: stated.name });
    if (byName) candidates.push(byName);
  }
  const lead = chooseStitchCandidate(candidates, stated);
  const events = lead ? await deps.readEvents({ phone: lead.phone, email: lead.email }) : [];
  return { lead, events, confirm: buildConfirmation(lead) };
}
