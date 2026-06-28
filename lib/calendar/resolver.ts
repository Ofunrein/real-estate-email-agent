// CalendarProvider resolver — picks the active adapter from CALENDAR_PROVIDER env var.
// Priority: explicit CALENDAR_PROVIDER > auto-detect from credentials > neon fallback.
//
// Per-client config: set CALENDAR_PROVIDER in the client's .env file.
// Valid values: "google" | "outlook" | "neon"
//
// Google is the recommended default for new clients.
// Neon is the internal fallback (no external API, uses Postgres appointments table).

import type { CalendarProvider } from "@/lib/calendar/types";
import { createGoogleCalendarAdapter, isGoogleCalendarConfigured } from "@/lib/calendar/google";
import { createOutlookCalendarAdapter, isOutlookConfigured } from "@/lib/calendar/outlook";
import { createNeonCalendarAdapter } from "@/lib/calendar/neon";

export type CalendarProviderName = "google" | "outlook" | "neon";

let _cachedProvider: CalendarProvider | null = null;
let _cachedProviderName: string | null = null;

export function resolveCalendarProvider(forceProvider?: CalendarProviderName): CalendarProvider {
  const requested = forceProvider || (process.env.CALENDAR_PROVIDER as CalendarProviderName | undefined) || "";

  // Cache bust if provider changed (e.g. between test runs)
  if (_cachedProvider && _cachedProviderName === requested) return _cachedProvider;

  let provider: CalendarProvider;
  let name: string;

  if (requested === "google" || (!requested && isGoogleCalendarConfigured())) {
    provider = createGoogleCalendarAdapter();
    name = "google";
  } else if (requested === "outlook" || (!requested && isOutlookConfigured())) {
    provider = createOutlookCalendarAdapter();
    name = "outlook";
  } else {
    provider = createNeonCalendarAdapter();
    name = "neon";
  }

  _cachedProvider = provider;
  _cachedProviderName = name;
  return provider;
}

export function activeCalendarProviderName(): CalendarProviderName {
  const requested = process.env.CALENDAR_PROVIDER as CalendarProviderName | undefined;
  if (requested === "google" || (!requested && isGoogleCalendarConfigured())) return "google";
  if (requested === "outlook" || (!requested && isOutlookConfigured())) return "outlook";
  return "neon";
}

// Re-export types so callers only need one import
export type { CalendarProvider, AvailabilitySlot, BookingInput, BookingResult, CancelResult, RescheduleResult, AvailabilityInput } from "@/lib/calendar/types";
