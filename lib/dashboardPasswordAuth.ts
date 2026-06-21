import crypto from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

import { getAllowedAuthEmails, isAllowedAuthEmail } from "@/auth";
import { clientId, databaseEnabled, ensureClientInDatabase } from "@/lib/database";
import { createIrisGmailSession } from "@/lib/gmailConnection";

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_MIN_LENGTH = 10;
const RESET_TTL_MS = 30 * 60 * 1000;

let pool: Pool | null = null;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for password sign-in");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function normalizeEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

function appBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!secret) throw new Error("AUTH_SECRET is required for password reset tokens");
  return secret;
}

function tokenHash(token: string): string {
  return crypto.createHmac("sha256", authSecret()).update(token).digest("base64url");
}

export function passwordPolicyError(password: string): string {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return "";
}

async function ensureDashboardAuthSchema(): Promise<void> {
  if (!databaseEnabled()) throw new Error("DATABASE_URL is required for password sign-in");
  await ensureClientInDatabase();
  await getPool().query(`
    create table if not exists dashboard_users (
      client_id text not null references clients(id) on delete cascade,
      email text not null,
      password_hash text not null default '',
      reset_token_hash text not null default '',
      reset_expires_at timestamptz,
      last_login_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (client_id, email)
    );

    create index if not exists dashboard_users_reset_token_idx
      on dashboard_users (client_id, reset_token_hash)
      where reset_token_hash <> '';
  `);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [version, salt, storedKey] = stored.split(":");
  if (version !== "scrypt" || !salt || !storedKey) return false;
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  const actual = Buffer.from(storedKey, "base64url");
  return actual.length === derived.length && crypto.timingSafeEqual(actual, derived);
}

export async function authorizeDashboardPassword(emailInput: unknown, passwordInput: unknown) {
  const email = normalizeEmail(emailInput);
  const password = String(passwordInput || "");
  if (!email || !password || !isAllowedAuthEmail(email)) return null;
  await ensureDashboardAuthSchema();
  const result = await getPool().query(
    `select email, password_hash
       from dashboard_users
      where client_id = $1 and email = $2`,
    [clientId(), email],
  );
  const user = result.rows[0] as { email?: string; password_hash?: string } | undefined;
  if (!user?.password_hash) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  await getPool().query(
    `update dashboard_users
        set last_login_at = now(), updated_at = now()
      where client_id = $1 and email = $2`,
    [clientId(), email],
  );
  return { email: user.email || email, name: email.split("@")[0] };
}

async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const { gmail } = await createIrisGmailSession();
  const raw = Buffer.from([
    `To: ${email}`,
    "Subject: Reset your Lumenosis dashboard password",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Use this link to reset your Lumenosis dashboard password:",
    "",
    resetUrl,
    "",
    "This link expires in 30 minutes. If you did not request it, ignore this email.",
  ].join("\r\n")).toString("base64url");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

export async function requestDashboardPasswordReset(emailInput: unknown): Promise<{ sent: boolean; devResetUrl?: string }> {
  const email = normalizeEmail(emailInput);
  if (!email || !isAllowedAuthEmail(email)) {
    return { sent: true };
  }
  await ensureDashboardAuthSchema();
  const token = crypto.randomBytes(32).toString("base64url");
  const resetUrl = `${appBaseUrl()}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  await getPool().query(
    `insert into dashboard_users (client_id, email, reset_token_hash, reset_expires_at)
     values ($1, $2, $3, $4)
     on conflict (client_id, email) do update set
       reset_token_hash = excluded.reset_token_hash,
       reset_expires_at = excluded.reset_expires_at,
       updated_at = now()`,
    [clientId(), email, tokenHash(token), new Date(Date.now() + RESET_TTL_MS).toISOString()],
  );

  if (process.env.NODE_ENV === "production" || process.env.SEND_PASSWORD_RESET_EMAIL === "true") {
    await sendPasswordResetEmail(email, resetUrl);
    return { sent: true };
  }
  return { sent: true, devResetUrl: resetUrl };
}

export async function resetDashboardPassword(input: { email: unknown; token: unknown; password: unknown }) {
  const email = normalizeEmail(input.email);
  const token = String(input.token || "");
  const password = String(input.password || "");
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  if (!email || !token || !isAllowedAuthEmail(email)) throw new Error("Invalid reset link");
  await ensureDashboardAuthSchema();
  const hash = tokenHash(token);
  const result = await getPool().query(
    `select email
       from dashboard_users
      where client_id = $1
        and email = $2
        and reset_token_hash = $3
        and reset_expires_at > now()`,
    [clientId(), email, hash],
  );
  if (!result.rows[0]) throw new Error("Invalid or expired reset link");
  const passwordHash = await hashPassword(password);
  await getPool().query(
    `update dashboard_users
        set password_hash = $3,
            reset_token_hash = '',
            reset_expires_at = null,
            updated_at = now()
      where client_id = $1 and email = $2`,
    [clientId(), email, passwordHash],
  );
  return { ok: true };
}

export function passwordSignInEnabled(): boolean {
  return databaseEnabled() && getAllowedAuthEmails().size > 0;
}
