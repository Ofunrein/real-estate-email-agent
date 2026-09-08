import { Pool } from "pg";

import { emailHtml, emailText } from "@/lib/demoOutreachEmail";

/**
 * Demo/prospect/listing/outreach/engagement ownership, in this app's Neon database.
 *
 * This module is the SOLE WRITER for that data. lumenosis-site reads the same rows
 * directly through a least-privilege read-only role (db/migrations/034_demo_reader_role.sql)
 * and holds no application DATABASE_URL, so no public page view costs an app-to-app
 * request. The only remaining cross-app hop is the signed mutation/control API, kept
 * for the compatibility window (see lib/demoAdminClient.ts).
 *
 * Preservation rules enforced here, not merely documented:
 *
 *   - Ids, tokens, slugs, timestamps, and statuses are read and written verbatim. This
 *     module never derives, re-signs, or rotates a demo token, and never rewrites a
 *     created_at. `demoUrlForToken` reproduces the already-sent URL string exactly.
 *   - Every query is tenant-scoped by client_id. A caller cannot read or mutate another
 *     tenant's demo rows even by id.
 *
 * Nothing here logs bodies, tokens, recipients, prospect mailboxes, or secrets.
 */

let pool: Pool | null = null;

/** Same pooling convention as lib/commandCenterStore.ts. */
function getPool(): Pool {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for demo ownership reads");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon terminates TLS with a certificate chain the bundled Node CA store does not
      // include, so `rejectUnauthorized: false` is the setting every existing store in
      // this repo uses (lib/database.ts, lib/commandCenterStore.ts, lib/contactOs.ts).
      // Changing it here alone would break the pool while leaving the rest unchanged;
      // it is tracked as one repo-wide change, not a drive-by in this PR.
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.DEMO_STORE_POOL_MAX || 2),
    });
  }
  return pool;
}

export type DemoQuery = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

function defaultQuery(): DemoQuery {
  return (text, values) => getPool().query(text, values);
}

/**
 * Tenant id that owns the demo corpus. Turso was single-tenant, so the migration stamps
 * every imported row with this one id and it stays the owner afterwards.
 */
export function demoClientId(env: NodeJS.ProcessEnv = process.env) {
  return (env.DEMO_CLIENT_ID || env.CLIENT_ID || "default").trim() || "default";
}

/** True once this app owns the data — the cutover flag read by the legacy gate. */
export function demoOwnershipEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.DEMO_DATA_OWNER === "postgres";
}

export type DemoSummary = {
  id: string;
  fullName: string;
  businessName: string;
  emailDomain: string;
  address: string;
  status: string;
  outreachStatus: string;
  subject: string;
  demoUrl: string;
  createdAt: string;
};

/**
 * The public host owns this URL shape. Already-sent links are
 * https://lumenosis.com/demo/<token> and that exact string is reproduced; the token is
 * never re-derived, re-signed, or redirected. Byte-identical to the site's
 * lib/demo-admin-service.ts::demoUrlForToken.
 */
export function demoUrlForToken(token: string) {
  return `https://lumenosis.com/demo/${token}`;
}

/** Drops the prospect mailbox: only the domain is ever rendered or exported. */
export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function toDemoSummary(row: Record<string, unknown>): DemoSummary {
  return {
    id: String(row.id ?? ""),
    fullName: String(row.full_name ?? ""),
    businessName: String(row.business_name ?? ""),
    emailDomain: emailDomain(String(row.email ?? "")),
    address: String(row.address ?? ""),
    status: String(row.status ?? ""),
    outreachStatus: String(row.outreach_status ?? ""),
    subject: String(row.subject ?? ""),
    demoUrl: demoUrlForToken(String(row.access_token ?? "")),
    createdAt: String(row.created_at ?? ""),
  };
}

/**
 * Same column list, join shape, and ordering as the Turso query it replaces, so the
 * rendered list is identical row-for-row after cutover. created_at is the preserved text
 * column and orders lexicographically, which is what the original ORDER BY relied on.
 */
const LIST_SQL = `select d.id, p.full_name, p.business_name, p.email, l.address, d.status,
    d.access_token, o.subject, o.status as outreach_status, d.created_at
  from demo_rooms d
  join demo_prospects p on p.id = d.prospect_id and p.client_id = d.client_id
  join demo_listings l on l.id = d.listing_id and l.client_id = d.client_id
  join demo_outreach_drafts o on o.demo_room_id = d.id and o.client_id = d.client_id
  where d.client_id = $1
  order by d.created_at desc`;

export async function listDemos(
  clientId: string = demoClientId(),
  query: DemoQuery = defaultQuery(),
): Promise<DemoSummary[]> {
  const result = await query(LIST_SQL, [clientId]);
  return result.rows.map(toDemoSummary);
}

export type ApproveResult =
  | { ok: true; approved: true; alreadyApproved: boolean }
  | { ok: false; reason: "not_found" };

/**
 * Idempotent by construction. The UPDATE matches only a draft; the row is then re-read.
 * A replayed approve of an already-approved room returns ok with alreadyApproved rather
 * than an error, so a retry cannot look like a failure. Matches the site's
 * approveDemoRoom semantics exactly, including that approved_at is only stamped on the
 * transition.
 */
export async function approveDemo(
  id: string,
  clientId: string = demoClientId(),
  query: DemoQuery = defaultQuery(),
): Promise<ApproveResult> {
  const updated = await query(
    `update demo_rooms
       set status = 'approved',
           approved_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
     where id = $1 and client_id = $2 and status = 'draft'
     returning id`,
    [id, clientId],
  );
  if (updated.rows.length) return { ok: true, approved: true, alreadyApproved: false };

  const current = await query(
    "select status from demo_rooms where id = $1 and client_id = $2 limit 1",
    [id, clientId],
  );
  const status = current.rows[0] ? String(current.rows[0].status) : "";
  if (status !== "approved") return { ok: false, reason: "not_found" };
  return { ok: true, approved: true, alreadyApproved: true };
}

export type SendResult =
  | { ok: true; alreadySent: boolean }
  | { ok: false; reason: "not_found" | "not_configured" | "provider_failed" };

/**
 * Idempotent send, and the send is ordered so a crash cannot double-send:
 *
 *   1. Claim the draft with a conditional UPDATE to status = 'sending'. Only one caller
 *      can win that row, so two concurrent sends cannot both reach the provider.
 *   2. Call the provider.
 *   3. On success mark 'sent'. On failure release the claim back to 'draft' so a retry
 *      is possible — a provider failure never leaves a draft looking sent.
 *
 * The status check constraint in 033 allows only 'draft'/'sent', so the transient claim
 * is held in `idempotency_key` rather than by widening the status domain: the key is
 * set to the claim token and cleared on release. This keeps the preserved status values
 * exactly as Turso had them.
 */
export async function sendDemoOutreach(
  id: string,
  clientId: string = demoClientId(),
  query: DemoQuery = defaultQuery(),
  fetchImpl: typeof fetch = fetch,
  claimToken: string = `send-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
): Promise<SendResult> {
  const claimed = await query(
    `update demo_outreach_drafts o
       set idempotency_key = $3
     where o.demo_room_id = $1
       and o.client_id = $2
       and o.status = 'draft'
       and o.idempotency_key is null
       and exists (
         select 1 from demo_rooms d
          where d.id = o.demo_room_id and d.client_id = o.client_id and d.status = 'approved'
       )
     returning o.id, o.sender_inbox, o.recipient, o.subject, o.body`,
    [id, clientId, claimToken],
  );

  const draft = claimed.rows[0];
  if (!draft) {
    const existing = await query(
      "select status from demo_outreach_drafts where demo_room_id = $1 and client_id = $2 limit 1",
      [id, clientId],
    );
    const status = existing.rows[0] ? String(existing.rows[0].status) : "";
    if (status === "sent") return { ok: true, alreadySent: true };
    return { ok: false, reason: "not_found" };
  }

  const release = async () => {
    await query(
      "update demo_outreach_drafts set idempotency_key = null where id = $1 and idempotency_key = $2",
      [String(draft.id), claimToken],
    );
  };

  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    await release();
    return { ok: false, reason: "not_configured" };
  }

  const inbox = String(draft.sender_inbox);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: String(draft.recipient),
          subject: String(draft.subject),
          text: emailText(String(draft.body)),
          html: emailHtml(String(draft.body)),
          labels: ["outreach", "demo-room"],
          headers: { "List-Unsubscribe": `<mailto:${inbox}?subject=unsubscribe>` },
        }),
      },
    );
  } catch {
    await release();
    return { ok: false, reason: "provider_failed" };
  }

  if (!response.ok) {
    await release();
    return { ok: false, reason: "provider_failed" };
  }

  let messageId = "";
  try {
    const sent = (await response.json()) as { message_id?: string };
    messageId = String(sent.message_id ?? "");
  } catch {
    // A malformed provider body does not un-send the email. Fall through and mark sent
    // without a provider id rather than releasing the claim and risking a second send.
  }

  await query(
    `update demo_outreach_drafts
       set status = 'sent',
           sent_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
           provider_message_id = $3,
           idempotency_key = null
     where id = $1 and client_id = $2`,
    [String(draft.id), clientId, messageId],
  );
  await query(
    `update demo_prospects
       set status = 'contacted'
     where client_id = $2
       and id = (select prospect_id from demo_rooms where id = $1 and client_id = $2)`,
    [id, clientId],
  );

  return { ok: true, alreadySent: false };
}
