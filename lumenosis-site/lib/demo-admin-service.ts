import { emailHtml, emailText } from "@/lib/email-html";

/**
 * Shared demo-administration behavior. Both the existing shared-password routes
 * under /api/admin/* and the signed server-to-server routes under
 * /api/platform/* call this module, so the two surfaces cannot fork.
 *
 * Nothing here logs anything: no bodies, tokens, prospect data, or secrets.
 */

/**
 * Turso executor signature. Injected rather than imported so this module stays
 * runtime-agnostic and unit-testable; routes pass `sql` from lib/turso.
 */
export type SqlExecutor = (
  query: string,
  args?: (string | number | null)[],
) => Promise<Record<string, string | number | null>[]>;

export type DemoRow = {
  id: string;
  full_name: string;
  business_name: string;
  email: string;
  address: string;
  status: string;
  access_token: string;
  subject: string;
  body: string;
  outreach_status: string;
  created_at: string;
};

/** Public list shape consumed by the primary app's demoAdminClient. */
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

const LIST_QUERY = `SELECT d.id, p.full_name, p.business_name, p.email, l.address, d.status,
    d.access_token, o.subject, o.body, o.status AS outreach_status, d.created_at
    FROM demo_rooms d JOIN prospects p ON p.id = d.prospect_id
    JOIN listings l ON l.id = d.listing_id JOIN outreach_drafts o ON o.demo_room_id = d.id
    ORDER BY d.created_at DESC`;

export async function listDemoRows(exec: SqlExecutor) {
  return (await exec(LIST_QUERY)) as unknown as DemoRow[];
}

/**
 * The public host owns the demo URL shape. Already-sent links are
 * https://lumenosis.com/demo/<token> and that string is reproduced exactly; the
 * token is never re-derived, re-signed, or redirected.
 */
export function demoUrlForToken(token: string) {
  return `https://lumenosis.com/demo/${token}`;
}

/** Drops the prospect mailbox: only the domain crosses the repo boundary. */
export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function toDemoSummary(row: DemoRow): DemoSummary {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    businessName: String(row.business_name),
    emailDomain: emailDomain(String(row.email)),
    address: String(row.address),
    status: String(row.status),
    outreachStatus: String(row.outreach_status),
    subject: String(row.subject),
    demoUrl: demoUrlForToken(String(row.access_token)),
    createdAt: String(row.created_at),
  };
}

export type ApproveResult =
  | { ok: true; approved: true; alreadyApproved: boolean }
  | { ok: false; reason: "not_found" };

/**
 * Idempotent by construction: the UPDATE only matches a draft, then the row is
 * re-read. An already-approved room returns ok with alreadyApproved, never an
 * error, so a retried request cannot look like a failure.
 */
export async function approveDemoRoom(id: string, exec: SqlExecutor): Promise<ApproveResult> {
  await exec(
    "UPDATE demo_rooms SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'",
    [id],
  );
  const rows = await exec("SELECT status, approved_at FROM demo_rooms WHERE id = ? LIMIT 1", [id]);
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (String(row.status) !== "approved") return { ok: false, reason: "not_found" };
  return { ok: true, approved: true, alreadyApproved: false };
}

export type SendResult =
  | { ok: true; alreadySent: boolean }
  | { ok: false; reason: "not_found" | "not_configured" | "provider_failed" };

/**
 * Idempotent send. The draft lookup requires a pre-send status, so a replayed
 * request finds nothing to send; if the draft is already 'sent' we return ok
 * with alreadySent instead of double-sending or reporting a failure.
 *
 * Two pre-send statuses exist in the corpus: 'draft' (what the current code writes)
 * and 'scheduled' (older rows). Both are sendable and neither is terminal — see
 * db/migrations/037_demo_outreach_scheduled_status.sql.
 */
export const SENDABLE_OUTREACH_STATUSES = ["draft", "scheduled"] as const;

export async function sendDemoOutreach(
  id: string,
  exec: SqlExecutor,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const rows = await exec(
    `SELECT o.id, o.sender_inbox, o.recipient, o.subject, o.body FROM outreach_drafts o
    JOIN demo_rooms d ON d.id = o.demo_room_id WHERE o.demo_room_id = ? AND o.status IN ('draft', 'scheduled') AND d.status = 'approved' LIMIT 1`,
    [id],
  );
  const draft = rows[0];
  if (!draft) {
    const sentRows = await exec(
      "SELECT status FROM outreach_drafts WHERE demo_room_id = ? LIMIT 1",
      [id],
    );
    if (sentRows[0] && String(sentRows[0].status) === "sent")
      return { ok: true, alreadySent: true };
    return { ok: false, reason: "not_found" };
  }

  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const inbox = String(draft.sender_inbox);
  const response = await fetchImpl(
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
  if (!response.ok) return { ok: false, reason: "provider_failed" };
  const sent = await response.json();
  await exec(
    "UPDATE outreach_drafts SET status = 'sent', sent_at = CURRENT_TIMESTAMP, provider_message_id = ? WHERE id = ? AND status = 'draft'",
    [sent.message_id ?? "", String(draft.id)],
  );
  await exec(
    "UPDATE prospects SET status = 'contacted' WHERE id = (SELECT prospect_id FROM demo_rooms WHERE id = ?)",
    [id],
  );
  return { ok: true, alreadySent: false };
}
