// Neon internal calendar adapter — wraps existing calendarOs.ts logic.
// Used as fallback when no external calendar provider is configured.
// No external API calls — reads/writes directly to Neon Postgres.

import type {
  AvailabilityInput,
  AvailabilitySlot,
  BookingInput,
  BookingResult,
  CalendarProvider,
  CancelResult,
  RescheduleResult,
} from "@/lib/calendar/types";

// Dynamic import to avoid the pg/tsx ESM resolution issue in non-Next.js contexts.
async function getCalendarOs() {
  const mod = await import("@/lib/calendarOs");
  // Handle tsx CJS-wrap: all named exports may be under .default
  const resolved = (mod as unknown as { default?: typeof mod }).default ?? mod;
  return resolved as typeof mod;
}

export function createNeonCalendarAdapter(): CalendarProvider {
  return {
    async queryAvailability(input: AvailabilityInput): Promise<AvailabilitySlot[]> {
      const { queryAvailability } = await getCalendarOs();
      return queryAvailability({
        calendarId: input.calendarId,
        from: input.from,
        to: input.to,
        durationMinutes: input.durationMinutes,
        timezone: input.timezone,
        limit: input.limit,
      });
    },

    async bookAppointment(input: BookingInput): Promise<BookingResult> {
      const { createCalendarAppointment } = await getCalendarOs();
      try {
        const event = await createCalendarAppointment({
          title: input.title,
          description: input.description,
          start: input.start,
          end: input.end,
          timezone: input.timezone,
          calendarId: input.calendarId,
          propertyAddress: input.propertyAddress,
          contact: input.attendeeEmail ? {
            fullName: input.attendeeName,
            emails: [input.attendeeEmail],
            phones: input.attendeePhone ? [input.attendeePhone] : [],
          } : undefined,
        });
        return {
          success: true,
          eventId: event.id,
          confirmedStart: event.start,
          confirmedEnd: event.end,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Neon booking failed" };
      }
    },

    async cancelEvent(eventId: string): Promise<CancelResult> {
      const { cancelCalendarAppointment } = await getCalendarOs();
      const ok = await cancelCalendarAppointment(eventId);
      return { success: ok };
    },

    async rescheduleEvent(eventId: string, newStart: string, newEnd: string): Promise<RescheduleResult> {
      const { updateCalendarAppointment } = await getCalendarOs();
      try {
        await updateCalendarAppointment(eventId, { start: newStart, end: newEnd });
        return { success: true, confirmedStart: newStart, confirmedEnd: newEnd };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Neon reschedule failed" };
      }
    },
  };
}
