import { test } from "node:test";
import assert from "node:assert/strict";

import { composeInboxData } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

test("composeInboxData hides reserved SMS smoke-test numbers", () => {
  const data = composeInboxData(
    [
      { phone: "+15551230008" } as SheetRow,
      { phone: "+15128152032" } as SheetRow,
    ],
    [
      { channel: "sms", phone: "+15551230008", thread_ref: "sms:+15551230008", direction: "outbound" } as SheetRow,
      { channel: "sms", phone: "+15128152032", thread_ref: "sms:+15128152032", direction: "outbound" } as SheetRow,
    ],
    [],
  );

  assert.equal(data.leads.length, 1);
  assert.equal(data.leads[0].phone, "+15128152032");
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].phone, "+15128152032");
  assert.equal(data.metrics.event_count, 1);
});

test("composeInboxData hides raw voice tool events and counts voice calls", () => {
  const data = composeInboxData(
    [],
    [
      {
        channel: "voice",
        phone: "+15128152032",
        thread_ref: "voice:verify_lookupProperty",
        event_type: "voice_property_lookup",
        direction: "inbound",
      } as SheetRow,
      {
        channel: "sms",
        phone: "+15128152032",
        thread_ref: "sms:+15128152032",
        direction: "inbound",
      } as SheetRow,
    ],
    [],
    [{ phone: "+15128152032", thread_ref: "voice:+15128152032" } as SheetRow],
  );

  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].channel, "sms");
  assert.equal(data.metrics.channels.voice, 1);
  assert.equal(data.metrics.channels.sms, 1);
});
