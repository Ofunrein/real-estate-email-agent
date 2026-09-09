/**
 * Call-time awareness for the demo voice agent.
 *
 * Without this the assistant has no idea when "now" is, so it will happily offer "Tuesday at
 * 3" during a Sunday 2am call, or talk about a listing that went live "yesterday" when it was
 * three weeks ago. An LLM cannot infer the wall clock; it has to be told, in speech-ready
 * form, on every call.
 *
 * Everything here is computed server-side per request and rendered as words rather than
 * timestamps, because the agent must never read an ISO string aloud.
 */

/** Local wall-clock parts for a timezone, derived without pulling in a date library. */
function zonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    month: get("month"),
    day: get("day"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
    dayPeriod: get("dayPeriod").toLowerCase(),
  };
}

/** 0-23 local hour, needed for the business-hours decision. */
function zonedHour24(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now),
  ) % 24;
}

function zonedWeekday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
}

export type CallClock = {
  /** e.g. "Tuesday, March 4th, 2026" */
  spokenDate: string;
  /** e.g. "2:15 in the afternoon" */
  spokenTime: string;
  weekday: string;
  timeZoneLabel: string;
  isWeekend: boolean;
  /** Inside 9am-6pm local, Monday to Friday. */
  isBusinessHours: boolean;
  /** Before 8am or after 9pm local — a human is definitely not picking up. */
  isLateNight: boolean;
  /** The next weekday a human is likely reachable, spoken. */
  nextBusinessDay: string;
};

/**
 * Day-of-month as a spoken word. TTS reads "4th" inconsistently (sometimes "four th"), so the
 * date is spelled out. All 31 are listed rather than half-mapped, otherwise the same prompt
 * mixes "fourth" and "4th" depending on the day.
 */
const ORDINAL_WORDS = [
  "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
  "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth",
  "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second",
  "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh",
  "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first",
];

function ordinal(day: string): string {
  return ORDINAL_WORDS[Number(day)] ?? day;
}

/**
 * "2:15 in the afternoon" reads better on a call than "2:15 PM", and "on the hour" avoids
 * the assistant saying "two o'clock zero zero".
 */
function spokenClock(hour: string, minute: string, dayPeriod: string): string {
  const part = dayPeriod === "am" ? "in the morning" : Number(hour) >= 5 ? "in the evening" : "in the afternoon";
  if (minute === "00") return `${hour} o'clock ${part}`;
  return `${hour}:${minute} ${part}`;
}

export function callClock(now: Date, timeZone: string, timeZoneLabel: string): CallClock {
  const parts = zonedParts(now, timeZone);
  const hour24 = zonedHour24(now, timeZone);
  const isWeekend = parts.weekday === "Saturday" || parts.weekday === "Sunday";

  // Next day a human is plausibly reachable. Friday evening rolls to Monday, not Saturday.
  let cursor = new Date(now.getTime());
  let nextBusinessDay = "";
  for (let i = 1; i <= 4; i += 1) {
    cursor = new Date(cursor.getTime() + 86400000);
    const weekday = zonedWeekday(cursor, timeZone);
    if (weekday !== "Saturday" && weekday !== "Sunday") {
      nextBusinessDay = i === 1 ? `tomorrow, ${weekday}` : weekday;
      break;
    }
  }

  return {
    spokenDate: `${parts.weekday}, ${parts.month} ${ordinal(parts.day)}, ${parts.year}`,
    spokenTime: spokenClock(parts.hour, parts.minute, parts.dayPeriod),
    weekday: parts.weekday,
    timeZoneLabel,
    isWeekend,
    isBusinessHours: !isWeekend && hour24 >= 9 && hour24 < 18,
    isLateNight: hour24 < 8 || hour24 >= 21,
    nextBusinessDay,
  };
}

/**
 * The prompt block. Phrased as behaviour rather than data so the model applies it instead of
 * reciting it: the point is that it stops offering "Tuesday at 3" on a Sunday at 2am.
 */
export function callTimePromptSection(clock: CallClock): string {
  const availability = clock.isBusinessHours
    ? `The office is open right now, so the team may be able to follow up shortly.`
    : clock.isLateNight
      ? `It is outside business hours and nobody is in the office. Do not imply anyone will reply tonight. The realistic follow-up is ${clock.nextBusinessDay} during business hours.`
      : `It is outside normal business hours (the team works weekdays, roughly nine to six). Do not imply an immediate human reply. The realistic follow-up is ${clock.nextBusinessDay} during business hours.`;

  return `CURRENT DATE AND TIME
- Right now it is ${clock.spokenTime} on ${clock.spokenDate}, ${clock.timeZoneLabel}. This is the real current time, not an example.
- ${availability}
- Never invent a day, date, or time. When you mention a day, it must be consistent with today being ${clock.weekday}. "Tomorrow" and "this weekend" must be calculated from today, not guessed.
- Never offer or imply a specific appointment slot as booked or held. You have no calendar access. Say the team will confirm the actual time, and offer to note the caller's preference.
- If the caller proposes a time that has already passed today, say so plainly and offer the next realistic window instead of accepting it.
- If the caller asks when someone will get back to them, answer using the real availability above rather than a generic "shortly" or "right away".
- Only mention the date or time when it is relevant to what the caller asked. Do not open the call by announcing it.`;
}
