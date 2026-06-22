import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventUpdate,
  CalendarListInput,
  CalendarListPage,
  CalendarProvider,
  CalendarProviderName,
} from "../calendar-provider.interface";
import { normalizeCalendarEvent } from "../provider-normalizers";
import { executeComposioTool, resultItems, resultString, type ComposioProviderContext } from "./client";

type ComposioCalendarKind = "google" | "outlook";

const PROVIDERS: Record<ComposioCalendarKind, CalendarProviderName> = {
  google: "composio_google_calendar",
  outlook: "composio_outlook_calendar",
};

const TOOL_SLUGS: Record<ComposioCalendarKind, Record<string, string[]>> = {
  google: {
    list: ["GOOGLECALENDAR_LIST_EVENTS", "GOOGLE_CALENDAR_LIST_EVENTS", "GOOGLECALENDAR_EVENTS_LIST"],
    create: ["GOOGLECALENDAR_CREATE_EVENT", "GOOGLE_CALENDAR_CREATE_EVENT"],
    update: ["GOOGLECALENDAR_UPDATE_EVENT", "GOOGLE_CALENDAR_UPDATE_EVENT"],
    cancel: ["GOOGLECALENDAR_DELETE_EVENT", "GOOGLE_CALENDAR_DELETE_EVENT", "GOOGLECALENDAR_PATCH_EVENT"],
  },
  outlook: {
    list: ["OUTLOOK_CALENDAR_LIST_EVENTS", "MICROSOFT_OUTLOOK_CALENDAR_LIST_EVENTS", "OUTLOOK_LIST_EVENTS"],
    create: ["OUTLOOK_CALENDAR_CREATE_EVENT", "MICROSOFT_OUTLOOK_CALENDAR_CREATE_EVENT", "OUTLOOK_CREATE_EVENT"],
    update: ["OUTLOOK_CALENDAR_UPDATE_EVENT", "MICROSOFT_OUTLOOK_CALENDAR_UPDATE_EVENT", "OUTLOOK_UPDATE_EVENT"],
    cancel: ["OUTLOOK_CALENDAR_DELETE_EVENT", "MICROSOFT_OUTLOOK_CALENDAR_DELETE_EVENT", "OUTLOOK_DELETE_EVENT"],
  },
};

function envName(kind: ComposioCalendarKind, action: string): string {
  return `COMPOSIO_${kind.toUpperCase()}_CALENDAR_${action.toUpperCase()}_TOOL_SLUG`;
}

function createArgs(input: CalendarEventInput): Record<string, unknown> {
  return {
    calendar_id: input.calendarId,
    summary: input.title,
    title: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startTime, timeZone: input.timezone },
    end: input.endTime ? { dateTime: input.endTime, timeZone: input.timezone } : undefined,
    attendees: input.attendees?.map((attendee) => ({ email: attendee.email, displayName: attendee.name })),
    idempotency_key: input.idempotencyKey,
  };
}

function updateArgs(eventId: string, update: CalendarEventUpdate): Record<string, unknown> {
  return {
    event_id: eventId,
    calendar_id: update.calendarId,
    summary: update.title,
    title: update.title,
    description: update.description,
    location: update.location,
    start: update.startTime ? { dateTime: update.startTime, timeZone: update.timezone } : undefined,
    end: update.endTime ? { dateTime: update.endTime, timeZone: update.timezone } : undefined,
    attendees: update.attendees?.map((attendee) => ({ email: attendee.email, displayName: attendee.name })),
    status: update.status,
    etag: update.etag,
  };
}

export class ComposioCalendarProvider implements CalendarProvider {
  readonly provider: CalendarProviderName;
  private readonly kind: ComposioCalendarKind;
  private readonly context: ComposioProviderContext;

  constructor(kind: ComposioCalendarKind, input: { userEmail: string; connectedAccountId?: string }) {
    this.kind = kind;
    this.provider = PROVIDERS[kind];
    this.context = { ...input, provider: this.provider };
  }

  async listEvents(input: CalendarListInput = {}): Promise<CalendarListPage> {
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "list")],
      fallbackSlugs: TOOL_SLUGS[this.kind].list,
      args: {
        calendar_id: input.calendarId,
        time_min: input.timeMin,
        time_max: input.timeMax,
        sync_token: input.syncToken,
        page_token: input.pageToken,
        max_results: input.limit,
      },
    });
    return {
      events: resultItems(result).map((item) => normalizeCalendarEvent(this.provider, item)),
      nextPageToken: resultString(result, "nextPageToken", "next_page_token"),
      nextSyncToken: resultString(result, "nextSyncToken", "next_sync_token"),
    };
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "create")],
      fallbackSlugs: TOOL_SLUGS[this.kind].create,
      args: createArgs(input),
    });
    return normalizeCalendarEvent(this.provider, result.event || result.data || result);
  }

  async updateEvent(eventId: string, update: CalendarEventUpdate): Promise<CalendarEvent> {
    const result = await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "update")],
      fallbackSlugs: TOOL_SLUGS[this.kind].update,
      args: updateArgs(eventId, update),
    });
    return normalizeCalendarEvent(this.provider, result.event || result.data || result);
  }

  async cancelEvent(eventId: string, input: { calendarId?: string; etag?: string } = {}): Promise<void> {
    await executeComposioTool({
      context: this.context,
      envSlug: process.env[envName(this.kind, "cancel")],
      fallbackSlugs: TOOL_SLUGS[this.kind].cancel,
      args: { event_id: eventId, calendar_id: input.calendarId, etag: input.etag },
    });
  }
}

export function createComposioGoogleCalendarProvider(input: { userEmail: string; connectedAccountId?: string }): CalendarProvider {
  return new ComposioCalendarProvider("google", input);
}

export function createComposioOutlookCalendarProvider(input: { userEmail: string; connectedAccountId?: string }): CalendarProvider {
  return new ComposioCalendarProvider("outlook", input);
}
