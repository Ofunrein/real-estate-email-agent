const ATTIO_BASE = "https://api.attio.com/v2";

type PaidCustomer = {
  eventId: string;
  email: string;
  name: string;
  phone: string;
  companyName: string;
  plan: string;
  agreementVersion: string;
  customerId: string;
  amount: number;
  currency: string;
  emailProvider?: string;
  emailMessageId?: string;
  smsMessageId?: string;
};

export type AttioOnboardingResult = {
  personId: string;
  companyId: string;
  dealId: string;
  noteId: string;
  taskId: string;
};

async function attioRequest(path: string, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const token = process.env.ATTIO_API_KEY || "";
  const response = await fetchImpl(`${ATTIO_BASE}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ data: body }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Attio request failed (${response.status})`);
  return (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
}

function nestedId(payload: Record<string, unknown>, key: string): string {
  const id = payload.id && typeof payload.id === "object" ? payload.id as Record<string, unknown> : {};
  return String(id[key] || "");
}

function nameValue(name: string): Record<string, string> {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || "",
    last_name: parts.join(" "),
    full_name: name.trim(),
  };
}

function domainFromEmail(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return /^(gmail|outlook|hotmail|yahoo|icloud|aol)\./.test(domain) ? "" : domain;
}

export async function syncPaidCustomerToAttio(input: PaidCustomer, fetchImpl: typeof fetch = fetch, createActivities = true): Promise<AttioOnboardingResult | null> {
  if (!process.env.ATTIO_API_KEY) return null;

  const companyName = input.companyName || domainFromEmail(input.email) || input.name || input.email;
  const companyValues: Record<string, unknown> = { name: companyName };
  const domain = domainFromEmail(input.email);
  if (domain) companyValues.domains = [domain];
  const company = await attioRequest(`/objects/companies/records?matching_attribute=${domain ? "domains" : "name"}`, { values: companyValues }, fetchImpl);
  const companyId = nestedId(company, "record_id");

  const personValues: Record<string, unknown> = {
    email_addresses: [input.email],
    name: [nameValue(input.name || input.email.split("@")[0])],
  };
  if (input.phone) personValues.phone_numbers = [input.phone];
  if (companyId) personValues.company = [companyId];
  const person = await attioRequest("/objects/people/records?matching_attribute=email_addresses", { values: personValues }, fetchImpl);
  const personId = nestedId(person, "record_id");

  const dealName = `Lumenosis onboarding · ${input.customerId || input.email}`;
  const dealValues: Record<string, unknown> = {
    name: dealName,
    value: [{ currency_value: input.amount / 100, currency_code: input.currency || "USD" }],
  };
  if (personId) dealValues.associated_people = [personId];
  if (companyId) dealValues.associated_company = [companyId];
  const deal = await attioRequest("/objects/deals/records?matching_attribute=name", { values: dealValues }, fetchImpl);
  const dealId = nestedId(deal, "record_id");

  if (!createActivities) return { personId, companyId, dealId, noteId: "", taskId: "" };

  const noteLines = [
    `Stripe event: ${input.eventId}`,
    `Stripe customer: ${input.customerId || "not supplied"}`,
    `Plan: ${input.plan || "not supplied"}`,
    `Agreement version: ${input.agreementVersion || "not supplied"}`,
    `Payment: ${(input.amount / 100).toFixed(2)} ${input.currency || "USD"}`,
    "Onboarding status: payment confirmed",
    `Email delivery: ${input.emailProvider || "pending"}${input.emailMessageId ? ` (${input.emailMessageId})` : ""}`,
    `SMS delivery: ${input.smsMessageId || "not sent"}`,
  ];
  const note = await attioRequest("/notes", {
    parent_object: "people",
    parent_record_id: personId,
    title: "Lumenosis onboarding payment confirmed",
    format: "plaintext",
    content: noteLines.join("\n"),
  }, fetchImpl);

  const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const task = await attioRequest("/tasks", {
    content: `Review onboarding for ${companyName}`,
    format: "plaintext",
    deadline_at: deadline,
    is_completed: false,
    linked_records: [
      { target_object: "people", target_record_id: personId },
      ...(dealId ? [{ target_object: "deals", target_record_id: dealId }] : []),
    ],
  }, fetchImpl);

  return {
    personId,
    companyId,
    dealId,
    noteId: nestedId(note, "note_id"),
    taskId: nestedId(task, "task_id"),
  };
}
