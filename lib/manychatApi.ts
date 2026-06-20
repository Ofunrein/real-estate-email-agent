export type ManyChatResource = {
  id?: string | number;
  name?: string;
  title?: string;
  type?: string;
};

export type ManyChatSetupSnapshot = {
  page: Record<string, unknown>;
  tags: ManyChatResource[];
  fields: ManyChatResource[];
  flows: ManyChatResource[];
};

export const MANYCHAT_REQUIRED_TAGS = [
  "theo:routed",
  "theo:auto-sent",
  "theo:needs-human",
  "theo:media",
];

export const MANYCHAT_REQUIRED_FIELDS = [
  "lumenosis_channel",
  "lumenosis_thread_ref",
  "lumenosis_route_reason",
  "lumenosis_theo_status",
  "lumenosis_theo_reply",
  "lumenosis_theo_media_urls",
  "lumenosis_theo_intent",
];

function manyChatApiBase(): string {
  return (process.env.MANYCHAT_API_BASE || "https://api.manychat.com").replace(/\/$/, "");
}

function normalizeManyChatList(payload: unknown, keys: string[]): ManyChatResource[] {
  if (Array.isArray(payload)) return payload as ManyChatResource[];
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) return value as ManyChatResource[];
  }
  const data = object.data;
  if (Array.isArray(data)) return data as ManyChatResource[];
  if (data && typeof data === "object") {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as ManyChatResource[];
    }
  }
  return [];
}

export function resourceNames(resources: ManyChatResource[]): string[] {
  return resources.map((resource) => String(resource.name || resource.title || "")).filter(Boolean);
}

export function missingManyChatResources(required: string[], existing: ManyChatResource[]): string[] {
  const names = new Set(resourceNames(existing).map((name) => name.toLowerCase()));
  return required.filter((name) => !names.has(name.toLowerCase()));
}

export class ManyChatApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = process.env.MANYCHAT_API_KEY || "", baseUrl = manyChatApiBase()) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error("MANYCHAT_API_KEY is required");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload ? String((payload as { message?: string }).message) : response.statusText;
      throw new Error(`ManyChat ${response.status}: ${message}`);
    }
    return payload;
  }

  async getPageInfo(): Promise<Record<string, unknown>> {
    return await this.request("/fb/page/getInfo") as Record<string, unknown>;
  }

  async listTags(): Promise<ManyChatResource[]> {
    return normalizeManyChatList(await this.request("/fb/page/getTags"), ["tags"]);
  }

  async createTag(name: string): Promise<unknown> {
    return await this.request("/fb/page/createTag", { method: "POST", body: JSON.stringify({ name }) });
  }

  async listCustomFields(): Promise<ManyChatResource[]> {
    return normalizeManyChatList(await this.request("/fb/page/getCustomFields"), ["custom_fields", "fields"]);
  }

  async createCustomField(name: string): Promise<unknown> {
    return await this.request("/fb/page/createCustomField", { method: "POST", body: JSON.stringify({ name, type: "text" }) });
  }

  async listFlows(): Promise<ManyChatResource[]> {
    return normalizeManyChatList(await this.request("/fb/page/getFlows"), ["flows"]);
  }

  async snapshot(): Promise<ManyChatSetupSnapshot> {
    const [page, tags, fields, flows] = await Promise.all([
      this.getPageInfo().catch((error) => ({ error: error instanceof Error ? error.message : "page info failed" })),
      this.listTags().catch(() => []),
      this.listCustomFields().catch(() => []),
      this.listFlows().catch(() => []),
    ]);
    return { page, tags, fields, flows };
  }
}
