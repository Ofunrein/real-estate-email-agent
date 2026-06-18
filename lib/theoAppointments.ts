import { bookAppointment } from "@/lib/ariaCalendar";
import { cancelGHLEvent, parseLocalDateTime, rescheduleGHLEvent } from "@/lib/ariaCalendar";
import { notifySlackOnBooking } from "@/lib/ariaSlack";
import {
  cancelAppointmentById,
  findUpcomingAppointmentByPhone,
  formatAppointmentForAgent,
  rescheduleAppointmentById,
} from "@/lib/appointmentStore";

export type AppointmentIntent = "book" | "reschedule" | "cancel" | "check" | "none";

export type TheoAppointmentLead = Partial<{
  full_name: string;
  email: string;
  property_interest: string;
}>;

export type TheoAppointmentResult = {
  handled: boolean;
  reply: string;
  nextAction?: string;
};

export function detectAppointmentIntent(message: string): AppointmentIntent {
  const text = message.toLowerCase();
  if (/\b(reschedule|change|move|push back|different time|different day|can we do)\b/.test(text)) return "reschedule";
  if (/\b(cancel|cancellation|won't be able|can't make|not going to make|nevermind)\b/.test(text)) return "cancel";
  if (/\b(when is|what time|do i have|my appointment|my showing|confirm my|still on)\b/.test(text)) return "check";
  if (/\b(schedule|book|set up|arrange|tour|showing|want to see|visit|walk.?through|can i come|can we meet)\b/.test(text)) return "book";
  return "none";
}

export function extractTimeFromSms(message: string, now = new Date()): { date: string; time: string } | null {
  const lower = message.toLowerCase();
  let targetDate: Date | null = null;

  if (/\btoday\b/.test(lower)) {
    targetDate = new Date(now);
  } else if (/\btomorrow\b/.test(lower)) {
    targetDate = new Date(now);
    targetDate.setDate(now.getDate() + 1);
  } else {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (dayMatch) {
      const targetDay = days.indexOf(dayMatch[1]);
      let daysAhead = targetDay - now.getDay();
      if (daysAhead <= 0) daysAhead += 7;
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + daysAhead);
    }
  }

  if (!targetDate) {
    const absoluteMatch = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/)
      || lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i);
    if (absoluteMatch) {
      const months: Record<string, number> = {
        january: 0,
        february: 1,
        march: 2,
        april: 3,
        may: 4,
        june: 5,
        july: 6,
        august: 7,
        september: 8,
        october: 9,
        november: 10,
        december: 11,
      };
      const month = months[absoluteMatch[1]?.toLowerCase()] ?? Number.parseInt(absoluteMatch[1], 10) - 1;
      const day = Number.parseInt(absoluteMatch[2], 10);
      targetDate = new Date(now.getFullYear(), month, day);
    }
  }

  if (!targetDate) return null;

  let time = "10:00 AM";
  const timeMatch = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    time = `${timeMatch[1]}:${timeMatch[2] || "00"} ${timeMatch[3].toUpperCase()}`;
  } else if (/\bafternoon\b/.test(lower)) {
    time = "2:00 PM";
  } else if (/\bevening\b/.test(lower)) {
    time = "5:00 PM";
  }

  const date = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
  return { date, time };
}

export async function handleTheoAppointmentMessage(
  phone: string,
  message: string,
  lead: TheoAppointmentLead | null,
): Promise<TheoAppointmentResult> {
  const intent = detectAppointmentIntent(message);
  if (intent === "none") return { handled: false, reply: "" };

  const firstName = (lead?.full_name || "").split(" ")[0] || "";
  const namePrefix = firstName ? `${firstName}, ` : "";

  if (intent === "check") {
    const appointment = await findUpcomingAppointmentByPhone(phone);
    if (!appointment) {
      return {
        handled: true,
        reply: `${namePrefix}you don't have any upcoming appointments on file. Want to schedule one?`,
        nextAction: "await_confirmation",
      };
    }
    return {
      handled: true,
      reply: `${namePrefix}your ${formatAppointmentForAgent(appointment)}. Reply "reschedule" or "cancel" if needed.`,
      nextAction: "done",
    };
  }

  if (intent === "cancel") {
    const appointment = await findUpcomingAppointmentByPhone(phone);
    if (!appointment) {
      return { handled: true, reply: "No upcoming appointment found to cancel. Want to book a new one?", nextAction: "done" };
    }
    await cancelAppointmentById(appointment.id);
    if (appointment.ghl_event_id) await cancelGHLEvent(appointment.ghl_event_id).catch(() => false);
    return {
      handled: true,
      reply: `${namePrefix}your appointment has been cancelled. Let me know when you'd like to reschedule.`,
      nextAction: "done",
    };
  }

  if (intent === "reschedule") {
    const appointment = await findUpcomingAppointmentByPhone(phone);
    if (!appointment) {
      return { handled: true, reply: "No upcoming appointment found. Want to book a new one?", nextAction: "await_confirmation" };
    }
    const timePreference = extractTimeFromSms(message);
    if (!timePreference) {
      return { handled: true, reply: `${namePrefix}what day and time works for you?`, nextAction: "needs_time" };
    }
    const timezone = process.env.CALENDAR_TIMEZONE || "America/Chicago";
    const calendarResult = appointment.ghl_event_id
      ? await rescheduleGHLEvent(appointment.ghl_event_id, timePreference.date, timePreference.time, timezone)
      : { success: true, confirmed_time: `${timePreference.date} at ${timePreference.time}` };
    if (!calendarResult.success) {
      return { handled: true, reply: "I had trouble updating that. I'll flag it for the agent to sort out.", nextAction: "done" };
    }
    await rescheduleAppointmentById(
      appointment.id,
      parseLocalDateTime(timePreference.date, timePreference.time, timezone),
      calendarResult.confirmed_time || `${timePreference.date} at ${timePreference.time}`,
      appointment.ghl_event_id,
    );
    return {
      handled: true,
      reply: `${namePrefix}done - rescheduled to ${calendarResult.confirmed_time}. Confirmation on the way.`,
      nextAction: "done",
    };
  }

  const timePreference = extractTimeFromSms(message);
  if (!timePreference) {
    return {
      handled: true,
      reply: `${namePrefix}what day and time works? Morning or afternoon is fine.`,
      nextAction: "needs_time",
    };
  }
  const propertyAddress = lead?.property_interest || "";
  const result = await bookAppointment({
    date: timePreference.date,
    time: timePreference.time,
    caller_phone: phone,
    caller_name: lead?.full_name || "",
    caller_email: lead?.email || "",
    property_address: propertyAddress,
    appointment_type: "showing",
    notes: "Booked via SMS",
    booked_via_channel: "sms",
  });
  if (!result.success) {
    return { handled: true, reply: "Sounds good. I'll have the agent confirm that time with you.", nextAction: "done" };
  }
  await notifySlackOnBooking({
    outcome: "BOOKED",
    caller_name: lead?.full_name,
    caller_phone: phone,
    appointment_time: result.confirmed_time,
    property_address: propertyAddress,
    channel: "sms",
  }).catch(() => null);
  return {
    handled: true,
    reply: `${namePrefix}you're set for ${result.confirmed_time}${propertyAddress ? ` at ${propertyAddress}` : ""}. Confirmation on the way.`,
    nextAction: "done",
  };
}
