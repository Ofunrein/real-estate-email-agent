import test from "node:test";
import assert from "node:assert/strict";
import { syncPaidCustomerToAttio } from "../../lib/attioOnboarding";

test("syncs a paid customer into Attio people, companies, deals, note, and task", async () => {
  process.env.ATTIO_API_KEY = "example-attio-key";
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method || "GET", body: JSON.parse(String(init?.body || "{}")) };
    calls.push(call);
    if (call.url.endsWith("/self")) return new Response(JSON.stringify({ authorized_by_workspace_member_id: "member_1" }), { status: 200 });
    if (call.url.endsWith("/records/query")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    const slug = call.url.includes("/people/") ? "person" : call.url.includes("/companies/") ? "company" : "deal";
    if (call.url.includes("/notes")) return new Response(JSON.stringify({ data: { id: { note_id: "note_1" } } }), { status: 200 });
    if (call.url.includes("/tasks")) return new Response(JSON.stringify({ data: { id: { task_id: "task_1" } } }), { status: 200 });
    return new Response(JSON.stringify({ data: { id: { record_id: `${slug}_1` } } }), { status: 200 });
  };
  const result = await syncPaidCustomerToAttio({ eventId: "evt_1", email: "client@clientrealty.com", name: "A Client", phone: "+15125550123", companyName: "Client Realty", plan: "growth", agreementVersion: "2026-09", customerId: "cus_1", amount: 30000, currency: "USD" }, fetchImpl as typeof fetch);
  assert.deepEqual(result, { personId: "person_1", companyId: "company_1", dealId: "deal_1", noteId: "note_1", taskId: "task_1" });
  assert.equal(calls.some((call) => call.url.endsWith("/objects/deals/records")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/notes")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/tasks")), true);
  assert.equal(JSON.stringify(calls).includes("evt_1"), true);
  assert.equal(JSON.stringify(calls).includes("member_1"), true);
});

test("Attio sync is an explicit no-op when unconfigured", async () => {
  delete process.env.ATTIO_API_KEY;
  const result = await syncPaidCustomerToAttio({ eventId: "evt", email: "a@example.com", name: "", phone: "", companyName: "", plan: "", agreementVersion: "", customerId: "", amount: 0, currency: "USD" });
  assert.equal(result, null);
});
