# Property RAG Plan

## Decision

Use Neon Postgres with pgvector as the property RAG store. Do not add LangChain to live channel handling.

## Why Neon

The property database already lives in Neon. Hybrid retrieval needs both exact filters and semantic ranking:

- SQL: price, beds, baths, city, zip, status, rental/sale, excluded addresses.
- Vector: fuzzy intent such as modern kitchen, natural light, cozy, open concept, quiet street, good for entertaining.

Keeping both in Postgres avoids syncing a second vector database and keeps retrieval debuggable with SQL.

## Why Not LangChain

LangChain is not needed for this repo's hot path because the channel code already has typed routing, typed property rows, and direct LLM calls. Adding LangChain would add another abstraction around:

- one embedding API call,
- one SQL/vector query,
- one existing reply generator.

The production path should stay small: parse channel input, retrieve candidate properties, generate reply, send or draft. LangChain can still be useful later for offline evals or experiments, but it should not own Twilio, Gmail, Vapi, or Meta webhook behavior.

## Implemented Foundation

- `db/migrations/023_property_embeddings.sql`
  - Enables `vector`.
  - Adds `property_embeddings`.
  - Adds an HNSW cosine index.

- `lib/propertyEmbeddings.ts`
  - Builds stable embedding text from property fields.
  - Calls OpenAI embeddings directly.
  - Uses `text-embedding-3-small` and 1536 dimensions by default.

- `lib/propertyRetrieval.ts`
  - Shared retrieval function for agents.
  - Preserves existing structured SQL results.
  - Reranks only within the structured candidate pool when `PROPERTY_RAG_ENABLED=true`.
  - Skips RAG for voice by default.

- `scripts/backfill-property-embeddings.mjs`
  - Backfills missing or stale property embeddings.

- `tests/ts/propertyRetrieval.test.ts`
  - Covers embedding text, structured fallback, vector rerank, and voice-channel skip.

## Remaining Wiring

Once tracked-file permissions are normal again:

1. Add package script:
   - `rag:backfill`: `node --import tsx scripts/backfill-property-embeddings.mjs`
2. Replace text-channel candidate calls with `retrievePropertiesForAgent(...)`:
   - SMS
   - WhatsApp
   - Instagram/Messenger social router
   - Meta social webhook
   - Website chat
   - Iris email
3. Keep Aria voice on cache/DB-only lookup unless a separate voice-safe vector path is explicitly enabled.
4. Add a channel-level regression test for prior-property exclusion after the text-channel wiring lands.

## Runtime Flags

- `PROPERTY_RAG_ENABLED=true`
- `PROPERTY_EMBEDDING_MODEL=text-embedding-3-small`
- Set `OPENAI_API_KEY` in the environment used by the backfill job.

Without `PROPERTY_RAG_ENABLED=true`, channels should keep current SQL-only behavior.
