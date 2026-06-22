import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";

const LOCAL_UPLOAD_DIR = join(process.cwd(), "public", "uploads");

let pool: Pool | null = null;
let ensured = false;

export type StoredMediaUpload = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  data: Buffer;
};

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for media uploads");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureMediaUploadsTable(): Promise<void> {
  if (ensured) return;
  await getPool().query(`
    create table if not exists media_uploads (
      id text primary key,
      client_id text not null default 'default',
      thread_ref text not null default '',
      filename text not null,
      content_type text not null,
      size_bytes integer not null,
      data bytea not null,
      created_at timestamptz not null default now()
    )
  `);
  await getPool().query(`
    create index if not exists media_uploads_created_at_idx
      on media_uploads (created_at desc)
  `);
  ensured = true;
}

export function sanitizeUploadFilename(name: string): string {
  const fallback = "attachment";
  const cleaned = (name || fallback)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function publicBaseUrl(requestUrl: string): string {
  return (process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || new URL(requestUrl).origin).replace(/\/$/, "");
}

function blobWritable(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);
}

export async function saveMediaUpload(input: {
  file: File;
  threadRef: string;
  requestUrl: string;
}): Promise<{ url: string; filename: string; storage: "blob" | "database" | "local" }> {
  const filename = `${Date.now()}-${randomUUID()}-${sanitizeUploadFilename(input.file.name)}`;
  const contentType = input.file.type || "application/octet-stream";

  if (blobWritable()) {
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(`thread-uploads/${encodeURIComponent(input.threadRef)}/${filename}`, input.file, {
        access: "public",
        addRandomSuffix: false,
        contentType,
      });
      return { url: blob.url, filename, storage: "blob" };
    } catch (error) {
      if (!process.env.DATABASE_URL) throw error;
    }
  }

  if (process.env.DATABASE_URL) {
    const id = randomUUID();
    const bytes = Buffer.from(await input.file.arrayBuffer());
    await ensureMediaUploadsTable();
    await getPool().query(
      `insert into media_uploads (id, client_id, thread_ref, filename, content_type, size_bytes, data)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        process.env.CLIENT_ID || "default",
        input.threadRef,
        filename,
        contentType,
        input.file.size,
        bytes,
      ],
    );
    return {
      url: `${publicBaseUrl(input.requestUrl)}/api/media/uploads/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`,
      filename,
      storage: "database",
    };
  }

  await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  await writeFile(join(LOCAL_UPLOAD_DIR, filename), Buffer.from(await input.file.arrayBuffer()));
  return {
    url: `${publicBaseUrl(input.requestUrl)}/uploads/${encodeURIComponent(filename)}`,
    filename,
    storage: "local",
  };
}

export async function readMediaUpload(id: string): Promise<StoredMediaUpload | null> {
  if (!process.env.DATABASE_URL) return null;
  await ensureMediaUploadsTable();
  const result = await getPool().query(
    `select id, filename, content_type, size_bytes, data
       from media_uploads
      where id = $1
      limit 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    filename: String(row.filename),
    contentType: String(row.content_type || "application/octet-stream"),
    size: Number(row.size_bytes || 0),
    data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
  };
}
