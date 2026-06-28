// KvCORE (Lofty) CRM adapter stub — implements CrmAdapter interface.
// Set CRM_PROVIDER=kvcore + KVCORE_API_KEY + KVCORE_BASE_URL to activate.
// API docs: https://api.kvcore.com/docs
//
// Status: interface-complete stub. All methods degrade gracefully.
// Implement endpoint calls when a KvCORE client is onboarded.

import type { CrmAdapter, CrmActivity, CrmAppointment, CrmAppointmentInput, CrmAppointmentUpdate, CrmContact, CrmContactInput } from "@/lib/crm/types";

export function createKvcoreAdapter(config: { apiKey: string; baseUrl?: string }): CrmAdapter {
  const base = (config.baseUrl || "https://api.kvcore.com/v2").replace(/\/$/, "");

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`KvCORE ${init.method || "GET"} ${path} failed (${response.status}): ${body}`);
    }
    return response.json();
  }

  function mapContact(data: Record<string, unknown>): CrmContact {
    return {
      id: String(data.id || ""),
      fullName: [data.first_name, data.last_name].filter(Boolean).join(" ") || String(data.name || ""),
      email: String(data.email || ""),
      phone: String(data.phone || ""),
    };
  }

  return {
    provider: "kvcore",

    async findContactByPhone(phone: string): Promise<CrmContact | null> {
      try {
        const data = await request(`/contacts?phone=${encodeURIComponent(phone)}&limit=1`) as { data?: Record<string, unknown>[] };
        const contact = data.data?.[0];
        return contact ? mapContact(contact) : null;
      } catch { return null; }
    },

    async findContactByEmail(email: string): Promise<CrmContact | null> {
      try {
        const data = await request(`/contacts?email=${encodeURIComponent(email)}&limit=1`) as { data?: Record<string, unknown>[] };
        const contact = data.data?.[0];
        return contact ? mapContact(contact) : null;
      } catch { return null; }
    },

    async upsertContact(input: CrmContactInput): Promise<CrmContact> {
      // ponytail: POST /contacts — KvCORE deduplicates by email/phone
      const data = await request("/contacts", {
        method: "POST",
        body: JSON.stringify({
          email: input.email,
          phone: input.phone,
          first_name: input.firstName || (input.fullName?.split(" ")[0] ?? ""),
          last_name: input.lastName || (input.fullName?.split(" ").slice(1).join(" ") ?? ""),
          source: input.source || "lumenosis_agent_os",
          tags: input.tags || [],
        }),
      }) as Record<string, unknown>;
      return mapContact(data);
    },

    async listAppointments(_contactId: string): Promise<CrmAppointment[]> {
      // ponytail: stub — implement GET /appointments?contact_id= when needed
      return [];
    },

    async createAppointment(input: CrmAppointmentInput): Promise<CrmAppointment> {
      const data = await request("/appointments", {
        method: "POST",
        body: JSON.stringify({
          contact_id: input.contactId,
          start_time: input.startTime,
          end_time: input.endTime,
          title: input.title || "Appointment",
          notes: input.notes,
          address: input.address,
        }),
      }) as Record<string, unknown>;
      return { id: String(data.id || ""), contactId: input.contactId, startTime: input.startTime, endTime: input.endTime, title: input.title };
    },

    async updateAppointment(appointmentId: string, update: CrmAppointmentUpdate): Promise<CrmAppointment> {
      const data = await request(`/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      }) as Record<string, unknown>;
      return { id: String(data.id || appointmentId), contactId: "", startTime: String(data.start_time || "") };
    },

    async cancelAppointment(appointmentId: string): Promise<void> {
      await request(`/appointments/${encodeURIComponent(appointmentId)}`, { method: "DELETE" });
    },

    async logActivity(activity: CrmActivity): Promise<void> {
      await request(`/contacts/${encodeURIComponent(activity.contactId)}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: `[${activity.channel || "voice"}/${activity.direction || "inbound"}] ${activity.body}`, type: activity.type || "note" }),
      });
    },
  };
}
