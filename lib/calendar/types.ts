// CalendarProvider interface — all calendar adapters implement this.
// Swap providers per client via CALENDAR_PROVIDER env var with zero code changes.

export type AvailabilitySlot = {
  start: string; // ISO 8601
  end: string;   // ISO 8601
  durationMinutes: number;
};

export type BookingInput = {
  start: string;        // ISO 8601
  end: string;          // ISO 8601
  timezone: string;
  title: string;
  description?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  attendeePhone?: string;
  propertyAddress?: string;
  calendarId?: string;  // override default calendar for this provider
};

export type BookingResult = {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  confirmedStart?: string;
  confirmedEnd?: string;
  error?: string;
};

export type CancelResult = {
  success: boolean;
  error?: string;
};

export type RescheduleResult = {
  success: boolean;
  confirmedStart?: string;
  confirmedEnd?: string;
  error?: string;
};

export type AvailabilityInput = {
  from: string;         // ISO 8601
  to: string;           // ISO 8601
  durationMinutes?: number;
  timezone?: string;
  calendarId?: string;
  limit?: number;
};

export interface CalendarProvider {
  /** Return open time slots within the window. */
  queryAvailability(input: AvailabilityInput): Promise<AvailabilitySlot[]>;
  /** Book an appointment and return the created event. */
  bookAppointment(input: BookingInput): Promise<BookingResult>;
  /** Cancel an existing event by provider event ID. */
  cancelEvent(eventId: string, calendarId?: string): Promise<CancelResult>;
  /** Reschedule an existing event. */
  rescheduleEvent(eventId: string, newStart: string, newEnd: string, calendarId?: string): Promise<RescheduleResult>;
}
