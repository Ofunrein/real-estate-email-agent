import "server-only";

type Arg = string | number | null;
type Row = Record<string, string | number | null>;

function value(arg: Arg) {
  if (arg === null) return { type: "null" };
  if (typeof arg === "number")
    return Number.isInteger(arg)
      ? { type: "integer", value: String(arg) }
      : { type: "float", value: arg };
  return { type: "text", value: arg };
}

function config() {
  const rawUrl = process.env.LUMENOSIS_TURSO_DATABASE_URL;
  const token = process.env.LUMENOSIS_TURSO_AUTH_TOKEN;
  if (!rawUrl || !token) return null;
  return { url: rawUrl.replace(/^libsql:/, "https:").replace(/\/$/, ""), token };
}

export function tursoConfigured() {
  return Boolean(config());
}

export async function sql(query: string, args: Arg[] = []): Promise<Row[]> {
  const db = config();
  if (!db) throw new Error("Lumenosis Turso database is not configured");
  const response = await fetch(`${db.url}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${db.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql: query, args: args.map(value) } },
        { type: "close" },
      ],
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Turso request failed: ${response.status}`);
  const payload = await response.json();
  const result = payload.results?.[0]?.response?.result;
  if (!result) {
    const error = payload.results?.[0]?.error?.message;
    if (error) throw new Error(error);
    return [];
  }
  const columns: string[] = result.cols?.map((column: { name: string }) => column.name) ?? [];
  return (result.rows ?? []).map((row: { type: string; value?: string | number }[]) =>
    Object.fromEntries(
      columns.map((column, index) => [
        column,
        row[index]?.type === "null" ? null : (row[index]?.value ?? null),
      ]),
    ),
  );
}
