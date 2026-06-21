import { test } from "node:test";
import assert from "node:assert/strict";

import { createGhlAdapter, type GhlRequest } from "@/lib/crm/ghl";

type Call = { path: string; method: string; body?: unknown; query?: Record<string, string | undefined> };

function recorder(responses: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const request: GhlRequest = async (path, method, body, query) => {
    calls.push({ path, method, body, query });
    const key = `${method} ${path}`;
    return (responses[key] ?? responses[path] ?? {}) as Record<string, unknown>;
  };
  return { calls, request };
}

const config = { token: "tok", locationId: "loc_1", contactTag: "tag" };

test("findContactByPhone: hits duplicate search with number", async () => {
  const { calls, request } = recorder({ "GET /contacts/search/duplicate": { contact: { id: "c1", phone: "+15125550000" } } });
  const adapter = createGhlAdapter(config, request);
  const contact = await adapter.findContactByPhone("+15125550000");
  assert.equal(contact?.id, "c1");
  assert.equal(calls[0].query?.number, "+15125550000");
  assert.equal(calls[0].query?.locationId, "loc_1");
});

test("findContactByEmail: null when no contact", async () => {
  const { request } = recorder({ "GET /contacts/search/duplicate": {} });
  const adapter = createGhlAdapter(config, request);
  assert.equal(await adapter.findContactByEmail("none@x.com"), null);
});

test("upsertContact: splits name, applies tag, returns id", async () => {
  const { calls, request } = recorder({ "POST /contacts/upsert": { contact: { id: "c2", email: "sam@x.com" } } });
  const adapter = createGhlAdapter(config, request);
  const contact = await adapter.upsertContact({ fullName: "Sam Lee", email: "sam@x.com" });
  assert.equal(contact.id, "c2");
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.firstName, "Sam");
  assert.equal(body.lastName, "Lee");
  assert.equal(body.locationId, "loc_1");
  assert.deepEqual(body.tags, ["tag"]);
});

test("createAppointment: posts required fields", async () => {
  const { calls, request } = recorder({ "POST /calendars/events/appointments": { id: "appt1", contactId: "c1", startTime: "2026-06-12T19:00:00Z" } });
  const adapter = createGhlAdapter(config, request);
  const appt = await adapter.createAppointment({ calendarId: "cal_1", contactId: "c1", startTime: "2026-06-12T19:00:00Z", address: "123 Main St" });
  assert.equal(appt.id, "appt1");
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.calendarId, "cal_1");
  assert.equal(body.locationId, "loc_1");
  assert.equal(body.contactId, "c1");
  assert.equal(body.startTime, "2026-06-12T19:00:00Z");
});

test("updateAppointment: PUT to appointments/{id}", async () => {
  const { calls, request } = recorder();
  const adapter = createGhlAdapter(config, request);
  await adapter.updateAppointment("appt1", { startTime: "2026-06-13T20:00:00Z" });
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].path, "/calendars/events/appointments/appt1");
});

test("cancelAppointment: DELETE to events/{id}", async () => {
  const { calls, request } = recorder();
  const adapter = createGhlAdapter(config, request);
  await adapter.cancelAppointment("appt1");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].path, "/calendars/events/appt1");
});

test("listAppointments: maps events array", async () => {
  const { request } = recorder({ "GET /contacts/c1/appointments": { events: [{ id: "a1", contactId: "c1", startTime: "2026-06-12T19:00:00Z", appointmentStatus: "confirmed" }] } });
  const adapter = createGhlAdapter(config, request);
  const appts = await adapter.listAppointments("c1");
  assert.equal(appts.length, 1);
  assert.equal(appts[0].id, "a1");
  assert.equal(appts[0].status, "confirmed");
});

test("logActivity: posts InternalComment by default", async () => {
  const { calls, request } = recorder();
  const adapter = createGhlAdapter(config, request);
  await adapter.logActivity({ contactId: "c1", body: "called about 123 Main" });
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(calls[0].path, "/conversations/messages");
  assert.equal(body.type, "InternalComment");
  assert.equal(body.contactId, "c1");
});

test("listImportableLeads: maps GHL contacts into import leads", async () => {
  const { calls, request } = recorder({
    "GET /contacts/": {
      contacts: [
        {
          id: "c9",
          firstName: "Nia",
          lastName: "Patel",
          email: "nia@example.com",
          phone: "+15125550123",
          tags: ["hot buyer"],
          pipelineStage: "Showing",
          assignedTo: "agent_1",
          dateUpdated: "2026-06-20T12:00:00Z",
        },
      ],
      startAfterId: "next_1",
    },
  });
  const adapter = createGhlAdapter(config, request);
  const page = await adapter.listImportableLeads({ limit: 25, cursor: "cursor_1", updatedAfter: "2026-06-01T00:00:00Z" });

  assert.equal(calls[0].path, "/contacts/");
  assert.equal(calls[0].query?.locationId, "loc_1");
  assert.equal(calls[0].query?.limit, "25");
  assert.equal(calls[0].query?.startAfterId, "cursor_1");
  assert.equal(calls[0].query?.updatedAfter, "2026-06-01T00:00:00Z");
  assert.equal(page.nextCursor, "next_1");
  assert.equal(page.leads[0].sourceId, "c9");
  assert.equal(page.leads[0].fullName, "Nia Patel");
  assert.equal(page.leads[0].stage, "Showing");
  assert.equal(page.leads[0].owner, "agent_1");
});
