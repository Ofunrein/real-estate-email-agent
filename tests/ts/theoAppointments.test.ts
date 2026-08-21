import { test } from "node:test";
import assert from "node:assert/strict";

import { detectAppointmentIntent, handleTheoAppointmentMessage } from "@/lib/theoAppointments";

test("handleTheoAppointmentMessage asks for showing time in Iris voice", async () => {
  const result = await handleTheoAppointmentMessage(
    "+15125712595",
    "Can I tour this one?",
    { full_name: "Priya Shah", property_interest: "6814 Old Quarry Ln" },
  );

  assert.equal(result.handled, true);
  assert.equal(result.nextAction, "needs_time");
  // Names the listing so "this one" is unambiguous, and asks exactly one question.
  assert.equal(result.reply, "Priya, happy to get you into 6814 Old Quarry Ln. What day works best?");
});

test("handleTheoAppointmentMessage names the in-context listing when the lead has no saved interest", async () => {
  const result = await handleTheoAppointmentMessage(
    "+15125712595",
    "Can I tour the first one?",
    { full_name: "Chad Reyes" },
    "70 Rainey St #1509",
  );

  assert.equal(result.nextAction, "needs_time");
  assert.match(result.reply, /70 Rainey St #1509/);
  assert.equal((result.reply.match(/\?/g) || []).length, 1);
});

test("handleTheoAppointmentMessage still asks for timing with no property context", async () => {
  const result = await handleTheoAppointmentMessage("+15125712595", "Can I tour this one?", {});

  assert.equal(result.nextAction, "needs_time");
  assert.equal(result.reply, "happy to set that up. What day works best?");
  assert.doesNotMatch(result.reply, /agent/i);
});

// Caught live on chat 1984: "I need to move in TOMORROW" matched \bmove\b, routed into the
// appointment scheduler, and an urgent housing message came back as "No upcoming appointment
// found. Want to book a new one?". Reschedule/cancel now need an actual booking referent.
test("detectAppointmentIntent does not treat move-in urgency as rescheduling", () => {
  const expectations: Array<[string, string]> = [
    ["EMERGENCY my lease ends tonight I need to move in TOMORROW please help", "none"],
    ["I'm moving to Austin next month, what do you have?", "none"],
    ["what's the weather in austin tomorrow", "none"],
    ["Can we move the showing to Friday?", "reschedule"],
    ["Can you reschedule my appointment?", "reschedule"],
    ["Need to move it to a different day", "reschedule"],
    ["I can't make the tour tomorrow", "cancel"],
    ["cancel my appointment", "cancel"],
    ["when is my showing?", "check"],
    ["Can I tour the first one?", "book"],
  ];
  for (const [message, expected] of expectations) {
    assert.equal(detectAppointmentIntent(message), expected, `wrong intent for: ${message}`);
  }
});
