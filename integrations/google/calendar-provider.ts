import type { CalendarEvent, CalendarEventInput, CalendarEventUpdate, CalendarListInput, CalendarListPage, CalendarProvider } from "../calendar-provider.interface";
import { providerUnavailable } from "../provider-errors";

export class GoogleCalendarProvider implements CalendarProvider {
  readonly provider = "google_calendar";

  private unavailable(): never {
    throw providerUnavailable(this.provider, "Direct Google Calendar provider is not wired yet. Use the Composio calendar provider or add Google API credentials/client wiring.");
  }

  listEvents(_input: CalendarListInput = {}): Promise<CalendarListPage> {
    this.unavailable();
  }

  createEvent(_input: CalendarEventInput): Promise<CalendarEvent> {
    this.unavailable();
  }

  updateEvent(_eventId: string, _update: CalendarEventUpdate): Promise<CalendarEvent> {
    this.unavailable();
  }

  cancelEvent(_eventId: string, _input: { calendarId?: string; etag?: string } = {}): Promise<void> {
    this.unavailable();
  }
}

export function createGoogleCalendarProvider(): CalendarProvider {
  return new GoogleCalendarProvider();
}
