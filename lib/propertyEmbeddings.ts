import { createHash } from "node:crypto";

import type { SheetRow } from "@/lib/sheetSchema";

export const PROPERTY_EMBEDDING_MODEL = process.env.PROPERTY_EMBEDDING_MODEL || "text-embedding-3-small";
export const PROPERTY_EMBEDDING_DIMENSIONS = 1536;

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function propertyEmbeddingText(property: Partial<SheetRow>): string {
  return [
    clean(property.address),
    clean(property.neighborhood),
    clean(property.city),
    clean(property.zip),
    clean(property.property_type),
    clean(property.price) ? `Price ${clean(property.price)}` : "",
    clean(property.beds) ? `${clean(property.beds)} beds` : "",
    clean(property.baths) ? `${clean(property.baths)} baths` : "",
    clean(property.sqft) ? `${clean(property.sqft)} sqft` : "",
    clean(property.status),
    clean(property.features),
    clean(property.utilities_included) ? `Utilities ${clean(property.utilities_included)}` : "",
    clean(property.appliances_included) ? `Appliances ${clean(property.appliances_included)}` : "",
    clean(property.parking) ? `Parking ${clean(property.parking)}` : "",
    clean(property.pet_policy) ? `Pets ${clean(property.pet_policy)}` : "",
    clean(property.deposit) ? `Deposit ${clean(property.deposit)}` : "",
    clean(property.fees) ? `Fees ${clean(property.fees)}` : "",
    clean(property.lease_terms) ? `Lease ${clean(property.lease_terms)}` : "",
    clean(property.floor) ? `Floor ${clean(property.floor)}` : "",
    clean(property.unit_number) ? `Unit ${clean(property.unit_number)}` : "",
    clean(property.available_date) ? `Available ${clean(property.available_date)}` : "",
    clean(property.showing_instructions),
    clean(property.negotiability_notes),
    clean(property.listing_agent_name) ? `Agent ${clean(property.listing_agent_name)}` : "",
    clean(property.description),
  ].filter(Boolean).join("\n");
}

export function embeddingTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function embeddingApiKey(): string {
  return process.env.OPENAI_API_KEY || process.env.PROPERTY_EMBEDDING_OPENAI_API_KEY || "";
}

export function ragEnabled(): boolean {
  return process.env.PROPERTY_RAG_ENABLED === "true";
}

export function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number.isFinite(value) ? String(value) : "0").join(",")}]`;
}

export async function embedText(input: string, model = PROPERTY_EMBEDDING_MODEL): Promise<number[] | null> {
  const text = clean(input);
  const key = embeddingApiKey();
  if (!text || !key) return null;
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ embedding?: number[] }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Embedding request failed with ${response.status}`);
  }
  const embedding = payload.data?.[0]?.embedding || [];
  if (embedding.length !== PROPERTY_EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${PROPERTY_EMBEDDING_DIMENSIONS} embedding dimensions, got ${embedding.length}`);
  }
  return embedding;
}

export async function embedTexts(inputs: string[], model = PROPERTY_EMBEDDING_MODEL): Promise<number[][]> {
  const key = embeddingApiKey();
  const texts = inputs.map(clean).filter(Boolean);
  if (!texts.length || !key) return [];
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ embedding?: number[] }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Embedding request failed with ${response.status}`);
  }
  return (payload.data || []).map((item) => {
    const embedding = item.embedding || [];
    if (embedding.length !== PROPERTY_EMBEDDING_DIMENSIONS) {
      throw new Error(`Expected ${PROPERTY_EMBEDDING_DIMENSIONS} embedding dimensions, got ${embedding.length}`);
    }
    return embedding;
  });
}
