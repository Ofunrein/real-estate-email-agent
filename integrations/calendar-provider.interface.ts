export type CalendarProviderName = "composio_google_calendar" | "composio_outlook_calendar" | "google_calendar" | "outlook_calendar";

export type CalendarAttendee = {
  email: string;
  name?: string;
  responseStatus?: string;
};

export type CalendarEvent = {
  id: string;
  provider: CalendarProviderName | string;
  sourceId: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime?: string;
  timezone?: string;
  status?: string;
  attendees: CalendarAttendee[];
  htmlLink?: string;
  updatedAt?: string;
  etag?: string;
  raw?: Record<string, unknown>;
};

export type CalendarEventInput = {
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime?: string;
  timezone?: string;
  attendees?: CalendarAttendee[];
  idempotencyKey?: string;
};

export type CalendarEventUpdate = Partial<Omit<CalendarEventInput, "idempotencyKey">> & {
  status?: string;
  etag?: string;
};

export type CalendarListInput = {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  syncToken?: string;
  pageToken?: string;
  limit?: number;
};

export type CalendarListPage = {
  events: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export interface CalendarProvider {
  readonly provider: CalendarProviderName | string;

  listEvents(input?: CalendarListInput): Promise<CalendarListPage>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, update: CalendarEventUpdate): Promise<CalendarEvent>;
  cancelEvent(eventId: string, input?: { calendarId?: string; etag?: string }): Promise<void>;
}
