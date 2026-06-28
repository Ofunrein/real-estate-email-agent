// Follow Up Boss CRM adapter stub — implements CrmAdapter interface.
// Set CRM_PROVIDER=fub + FUB_API_KEY to activate.
// API docs: https://docs.followupboss.com/reference
//
// Status: interface-complete stub. All methods degrade gracefully.
// Implement endpoint calls when a Follow Up Boss client is onboarded.

import type { CrmAdapter, CrmActivity, CrmAppointment, CrmAppointmentInput, CrmAppointmentUpdate, CrmContact, CrmContactInput } from "@/lib/crm/types";

export function createFollowUpBossAdapter(config: { apiKey: string }): CrmAdapter {
  const base = "https://api.followupboss.com/v1";
  const authHeader = `Basic ${Buffer.from(`${config.apiKey}:`).toString("base64")}`;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "X-System": "Lumenosis Agent OS",
        "X-System-Key": config.apiKey,
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FUB ${init.method || "GET"} ${path} failed (${response.status}): ${body}`);
    }
    if (response.status === 204) return {};
    return response.json();
  }

  function mapContact(data: Record<string, unknown>): CrmContact {
    const emails = (data.emails as Array<{ value?: string }> | undefined) || [];
    const phones = (data.phones as Array<{ value?: string }> | undefined) || [];
    return {
      id: String(data.id || ""),
      fullName: [data.firstName, data.lastName].filter(Boolean).join(" ") || String(data.name || ""),
      email: emails[0]?.value,
      phone: phones[0]?.value,
    };
  }

  return {
    provider: "fub",

    async findContactByPhone(phone: string): Promise<CrmContact | null> {
      try {
        const data = await request(`/people?phone=${encodeURIComponent(phone)}&limit=1`) as { people?: Record<string, unknown>[] };
        const person = data.people?.[0];
        return person ? mapContact(person) : null;
      } catch { return null; }
    },

    async findContactByEmail(email: string): Promise<CrmContact | null> {
      try {
        const data = await request(`/people?email=${encodeURIComponent(email)}&limit=1`) as { people?: Record<string, unknown>[] };
        const person = data.people?.[0];
        return person ? mapContact(person) : null;
      } catch { return null; }
    },

    async upsertContact(input: CrmContactInput): Promise<CrmContact> {
      const nameParts = (input.fullName || "").split(" ");
      const data = await request("/people", {
        method: "POST",
        body: JSON.stringify({
          firstName: input.firstName || nameParts[0] || "",
          lastName: input.lastName || nameParts.slice(1).join(" ") || "",
          emails: input.email ? [{ value: input.email, isPrimary: true }] : [],
          phones: input.phone ? [{ value: input.phone, isPrimary: true }] : [],
          source: input.source || "lumenosis_agent_os",
          tags: input.tags?.join(",") || "",
        }),
      }) as Record<string, unknown>;
      return mapContact(data);
    },

    async listAppointments(contactId: string): Promise<CrmAppointment[]> {
      try {
        const data = await request(`/appointments?personId=${encodeURIComponent(contactId)}`) as { appointments?: Record<string, unknown>[] };
        return (data.appointments || []).map((a) => ({
          id: String(a.id || ""),
          contactId,
          startTime: String(a.start || ""),
          endTime: String(a.end || ""),
          title: String(a.title || ""),
          status: String(a.status || ""),
        }));
      } catch { return []; }
    },

    async createAppointment(input: CrmAppointmentInput): Promise<CrmAppointment> {
      const data = await request("/appointments", {
        method: "POST",
        body: JSON.stringify({
          personId: Number(input.contactId),
          start: input.startTime,
          end: input.endTime,
          title: input.title || "Appointment",
          notes: input.notes,
          location: input.address,
        }),
      }) as Record<string, unknown>;
      return { id: String(data.id || ""), contactId: input.contactId, startTime: String(data.start || input.startTime), endTime: String(data.end || input.endTime), title: input.title };
    },

    async updateAppointment(appointmentId: string, update: CrmAppointmentUpdate): Promise<CrmAppointment> {
      const data = await request(`/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "PUT",
        body: JSON.stringify({ start: update.startTime, end: update.endTime, title: update.title, notes: update.notes, location: update.address }),
      }) as Record<string, unknown>;
      return { id: String(data.id || appointmentId), contactId: "", startTime: String(data.start || update.startTime || "") };
    },

    async cancelAppointment(appointmentId: string): Promise<void> {
      await request(`/appointments/${encodeURIComponent(appointmentId)}`, { method: "DELETE" });
    },

    async logActivity(activity: CrmActivity): Promise<void> {
      await request("/notes", {
        method: "POST",
        body: JSON.stringify({
          personId: Number(activity.contactId),
          subject: `[${activity.channel || "voice"}/${activity.direction || "inbound"}]`,
          body: activity.body,
          isPublic: false,
        }),
      });
    },
  };
}
