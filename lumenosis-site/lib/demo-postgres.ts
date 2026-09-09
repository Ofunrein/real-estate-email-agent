import "server-only";

import { createHash } from "node:crypto";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

type DemoDatabaseEnv = Record<string, string | undefined>;

type DemoQuery = <Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Row>>;

export type PostgresDemoRoom = {
  id: string;
  config_json: string;
  expires_at: string;
};

let readPool: Pool | undefined;
let writePool: Pool | undefined;

export function demoPostgresEnabled(env: DemoDatabaseEnv = process.env) {
  return env.DEMO_DATA_SOURCE === "postgres";
}

function pool(kind: "read" | "write") {
  const variable = kind === "read" ? "DEMO_READ_DATABASE_URL" : "DEMO_WRITE_DATABASE_URL";
  const connectionString = process.env[variable];
  if (!connectionString) throw new Error(`${variable} is required when DEMO_DATA_SOURCE=postgres`);
  const existing = kind === "read" ? readPool : writePool;
  if (existing) return existing;
  const created = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
  });
  if (kind === "read") readPool = created;
  else writePool = created;
  return created;
}

const readQuery: DemoQuery = (text, values) => pool("read").query(text, values as unknown[]);
const writeQuery: DemoQuery = (text, values) => pool("write").query(text, values as unknown[]);

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function postgresDemoRoomForToken(
  token: string,
  query: DemoQuery = readQuery,
): Promise<PostgresDemoRoom | null> {
  const result = await query<PostgresDemoRoom>(
    "select id, config_json, expires_at from demo_public_api.lookup_room($1)",
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function recordPostgresDemoEngagement(
  token: string,
  event: string,
  durationSeconds: number | null,
  query: DemoQuery = writeQuery,
) {
  const result = await query<{ accepted: boolean }>(
    "select demo_public_api.record_engagement($1, $2, $3) as accepted",
    [tokenHash(token), event, durationSeconds],
  );
  return result.rows[0]?.accepted === true;
}

export async function reservePostgresDemoGeneration(token: string, query: DemoQuery = writeQuery) {
  const result = await query<{ accepted: boolean }>(
    "select demo_public_api.reserve_email_generation($1) as accepted",
    [tokenHash(token)],
  );
  return result.rows[0]?.accepted === true;
}

export async function reservePostgresVoiceSession(token: string, query: DemoQuery = writeQuery) {
  const result = await query<{ remaining: number }>(
    "select demo_public_api.reserve_voice_session_v2($1) as remaining",
    [tokenHash(token)],
  );
  return result.rows[0]?.remaining ?? -1;
}
