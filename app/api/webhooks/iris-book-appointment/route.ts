import { NextRequest, NextResponse } from "next/server";

import { createAppointment, type AppointmentType } from "@/lib/appointmentStore";
import { notifySlackOnBooking } from "@/lib/ariaSlack";
import { sendTheoSms } from "@/lib/twilioSms";
import { assertWebhookSecret } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

function appointmentType(value: string): AppointmentType {
  if (value === "consultation" || value === "listing_appt" || value === "follow_up") return value;
  return "showing";
}

export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const body = await request.json() as Record<string, string>;
    const callerPhone = body.caller_phone || "";
    const scheduledAt = body.scheduled_at || "";
    if (!callerPhone || !scheduledAt) {
      return NextResponse.json({ success: false, error: "Missing caller_phone or scheduled_at" }, { status: 400 });
    }

    const record = await createAppointment({
      caller_phone: callerPhone,
      caller_name: body.caller_name || "",
      caller_email: body.caller_email || "",
      appointment_type: appointmentType(body.appointment_type || ""),
      property_address: body.property_address || "",
      scheduled_at: scheduledAt,
      scheduled_at_local: body.scheduled_at_local || scheduledAt,
      booked_via_channel: "email",
      notes: body.notes || "",
    });

    await notifySlackOnBooking({
      outcome: "BOOKED",
      caller_name: body.caller_name || "",
      caller_phone: callerPhone,
      appointment_time: body.scheduled_at_local || scheduledAt,
      property_address: body.property_address || "",
      channel: "email",
    }).catch(() => null);

    if (process.env.SEND_BOOKING_CONFIRMATION_SMS === "true") {
      const message = [
        "Showing confirmed.",
        body.scheduled_at_local || scheduledAt,
        body.property_address || "",
        "Questions? Reply to this text.",
      ].filter(Boolean).join("\n");
      await sendTheoSms(callerPhone, message).catch(() => null);
    }

    return NextResponse.json({ success: true, appointment_id: record.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("secret") ? 401 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
