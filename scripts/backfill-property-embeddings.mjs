import { Pool } from "pg";
import {
  PROPERTY_EMBEDDING_MODEL,
  embedTexts,
  embeddingTextHash,
  propertyEmbeddingText,
  vectorLiteral,
} from "../lib/propertyEmbeddings.ts";
import { PROPERTIES_HEADERS } from "../lib/sheetSchema.ts";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const batchArg = process.argv.find((arg) => arg.startsWith("--batch="));
const limit = Math.max(1, Math.min(Number(limitArg?.split("=")[1] || "500") || 500, 5000));
const batchSize = Math.max(1, Math.min(Number(batchArg?.split("=")[1] || "32") || 32, 96));

let pool;

function clientId() {
  return process.env.CLIENT_ID || "default";
}

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function rowToProperty(row) {
  return Object.fromEntries(PROPERTIES_HEADERS.map((header) => {
    const value = row[header];
    if (value == null) return [header, ""];
    if (typeof value === "object") return [header, JSON.stringify(value)];
    return [header, String(value)];
  }));
}

async function readPropertiesNeedingEmbeddings() {
  const result = await getPool().query(
    `select ${PROPERTIES_HEADERS.map((header) => `p.${header}`).join(", ")}
       from properties p
       left join property_embeddings pe
         on pe.client_id = p.client_id
        and pe.address = p.address
        and pe.embedding_model = $2
      where p.client_id = $1
        and (
          pe.address is null
          or p.updated_at > pe.updated_at
        )
      order by p.updated_at desc, p.address asc
      limit $3`,
    [clientId(), PROPERTY_EMBEDDING_MODEL, limit],
  );
  return result.rows.map(rowToProperty);
}

async function upsertPropertyEmbedding(input) {
  await getPool().query(
    `insert into property_embeddings (
       client_id, address, embedding_model, embedding_text_hash, embedding_text, embedding
     ) values ($1, $2, $3, $4, $5, $6::vector)
     on conflict (client_id, address, embedding_model) do update set
       embedding_text_hash = excluded.embedding_text_hash,
       embedding_text = excluded.embedding_text,
       embedding = excluded.embedding,
       updated_at = now()`,
    [
      clientId(),
      input.address.trim(),
      PROPERTY_EMBEDDING_MODEL,
      input.embeddingTextHash,
      input.embeddingText,
      vectorLiteral(input.embedding),
    ],
  );
}

async function main() {
  const rows = await readPropertiesNeedingEmbeddings();
  let written = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const texts = batch.map((property) => propertyEmbeddingText(property));
    const embeddings = await embedTexts(texts, PROPERTY_EMBEDDING_MODEL);
    for (let offset = 0; offset < batch.length; offset += 1) {
      const embedding = embeddings[offset];
      const embeddingText = texts[offset];
      if (!embedding?.length || !embeddingText) continue;
      await upsertPropertyEmbedding({
        address: batch[offset].address,
        embeddingText,
        embeddingTextHash: embeddingTextHash(embeddingText),
        embedding,
      });
      written += 1;
    }
    console.log(`embedded ${written}/${rows.length}`);
  }
  console.log(JSON.stringify({ ok: true, model: PROPERTY_EMBEDDING_MODEL, scanned: rows.length, written }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await pool?.end();
});
