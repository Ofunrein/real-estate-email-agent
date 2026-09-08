// Local verification harness for scripts/migrate-demo-data.mjs.
//
// Stands up a fake Turso HTTP endpoint (/v2/pipeline) backed by a real SQLite database
// created with lumenosis-site's ORIGINAL db/0001_demo_rooms.sql schema, so the migrator
// is exercised against the true source shape rather than a mock of its own design.
//
// Not part of the app or CI: a scratch harness invoked by hand during review.
// Usage: node scripts/dev/fake-turso.mjs <sqlite-path> <port> [--fail-every N]

import http from "node:http";
import { DatabaseSync } from "node:sqlite";

const [, , dbPath, portArg, ...rest] = process.argv;
const port = Number(portArg || 8787);
const failEvery = Number(
  (rest.find((arg) => arg.startsWith("--fail-every")) || "").split("=")[1] || 0,
);

const db = new DatabaseSync(dbPath);
let requests = 0;

function toTursoValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  return { type: "text", value: String(value) };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    requests += 1;

    // Inject transient failures so the migrator's retry + checkpoint paths are exercised
    // for real rather than argued for.
    if (failEvery && requests % failEvery === 0) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "injected transient failure" }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end("{}");
      return;
    }

    const results = [];
    for (const request of payload.requests ?? []) {
      if (request.type !== "execute") {
        results.push({ type: "ok", response: { type: "close" } });
        continue;
      }
      const sql = request.stmt.sql;
      const args = (request.stmt.args ?? []).map((arg) =>
        arg.type === "null"
          ? null
          : arg.type === "integer"
            ? Number(arg.value)
            : arg.type === "float"
              ? Number(arg.value)
              : arg.value,
      );
      try {
        const statement = db.prepare(sql);
        const rows = statement.all(...args);
        const cols = rows.length ? Object.keys(rows[0]) : inferColumns(sql);
        results.push({
          type: "ok",
          response: {
            type: "execute",
            result: {
              cols: cols.map((name) => ({ name })),
              rows: rows.map((row) => cols.map((col) => toTursoValue(row[col]))),
            },
          },
        });
      } catch (error) {
        results.push({ type: "error", error: { message: String(error.message) } });
      }
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ results }));
  });
});

function inferColumns(sql) {
  const match = /select\s+(.+?)\s+from/is.exec(sql);
  if (!match) return [];
  return match[1].split(",").map((part) => part.trim().split(/\s+as\s+/i).pop().trim());
}

server.listen(port, "127.0.0.1", () => {
  console.log(`fake-turso listening on 127.0.0.1:${port} (db=${dbPath}, failEvery=${failEvery})`);
});
