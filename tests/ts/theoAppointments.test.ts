import { test } from "node:test";
import assert from "node:assert/strict";

import { handleTheoAppointmentMessage } from "@/lib/theoAppointments";

test("handleTheoAppointmentMessage asks for showing time in Iris voice", async () => {
  const result = await handleTheoAppointmentMessage(
    "+15125712595",
    "Can I tour this one?",
    { full_name: "Priya Shah", property_interest: "6814 Old Quarry Ln" },
  );

  assert.equal(result.handled, true);
  assert.equal(result.nextAction, "needs_time");
  assert.equal(result.reply, "Priya, what day and time works for the showing? Morning or afternoon is fine.");
  assert.doesNotMatch(result.reply, /agent/i);
});
