# Human Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Business owner can pause AI per-thread and send manual replies (with media) via SMS, WhatsApp, and Email from the dashboard.

**Architecture:** Add `human_takeover` flag to DB `conversation_events` threads table + new `thread_takeovers` table. API routes handle takeover toggle and outbound sending. Dashboard gets a per-thread "Take over" / "Release to AI" button + compose box (text + file upload). Incoming webhook handlers skip AI reply when takeover is active.

**Tech Stack:** Next.js API routes (TypeScript), Neon Postgres, Twilio REST API (SMS/WhatsApp), Gmail API via google-auth-library, React 19 state, native `<input type="file">` for media.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `db/migrations/004_human_takeover.sql` | **Create** | `thread_takeovers` table |
| `lib/humanTakeover.ts` | **Create** | DB reads/writes for takeover state |
| `lib/manualReply.ts` | **Create** | Send manual SMS/WA/email, upload media |
| `app/api/threads/[threadRef]/takeover/route.ts` | **Create** | POST toggle takeover on/off |
| `app/api/threads/[threadRef]/reply/route.ts` | **Create** | POST send manual reply + media |
| `app/api/threads/[threadRef]/upload/route.ts` | **Create** | POST upload media → get public URL |
| `app/api/webhooks/theo-sms/route.ts` | **Modify** | Skip AI if takeover active |
| `app/api/webhooks/theo-whatsapp/route.ts` | **Modify** | Skip AI if takeover active |
| `components/inbox/HumanTakeover.tsx` | **Create** | UI: button + compose box + file picker |
| `components/AgentInboxClient.tsx` | **Modify** | Wire HumanTakeover into thread view |

---

## Task 1: DB Migration — thread_takeovers table

**Files:**
- Create: `db/migrations/004_human_takeover.sql`

- [ ] **Step 1: Write migration**

```sql
-- 004_human_takeover.sql
create table if not exists thread_takeovers (
  id            bigserial primary key,
  client_id     text not null references clients(id) on delete cascade,
  thread_ref    text not null,
  channel       text not null,   -- 'sms' | 'whatsapp' | 'email'
  is_active     boolean not null default true,
  taken_by      text not null default 'owner',
  taken_at      timestamptz not null default now(),
  released_at   timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists idx_thread_takeovers_active
  on thread_takeovers(client_id, thread_ref)
  where is_active = true;

create index if not exists idx_thread_takeovers_client_thread
  on thread_takeovers(client_id, thread_ref);
```

- [ ] **Step 2: Run migration against Neon**

```bash
psql $DATABASE_URL -f db/migrations/004_human_takeover.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` x2

- [ ] **Step 3: Commit**

```bash
git add db/migrations/004_human_takeover.sql
git commit -m "feat: add thread_takeovers migration"
```

---

## Task 2: humanTakeover.ts — DB layer

**Files:**
- Create: `lib/humanTakeover.ts`

- [ ] **Step 1: Create the file**

```typescript
import { Pool } from "pg";

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function clientId() {
  return process.env.CLIENT_ID || "default";
}

export async function isTakeoverActive(threadRef: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const result = await getPool().query(
    `select id from thread_takeovers
     where client_id = $1 and thread_ref = $2 and is_active = true
     limit 1`,
    [clientId(), threadRef],
  );
  return result.rowCount > 0;
}

export async function getTakeover(threadRef: string): Promise<{ isActive: boolean; takenBy: string; takenAt: string } | null> {
  if (!process.env.DATABASE_URL) return null;
  const result = await getPool().query(
    `select is_active, taken_by, taken_at, channel
     from thread_takeovers
     where client_id = $1 and thread_ref = $2 and is_active = true
     limit 1`,
    [clientId(), threadRef],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { isActive: row.is_active, takenBy: row.taken_by, takenAt: row.taken_at };
}

export async function activateTakeover(threadRef: string, channel: string, takenBy = "owner"): Promise<void> {
  await getPool().query(
    `insert into thread_takeovers (client_id, thread_ref, channel, is_active, taken_by)
     values ($1, $2, $3, true, $4)
     on conflict on constraint idx_thread_takeovers_active
     do nothing`,
    [clientId(), threadRef, channel, takenBy],
  );
}

export async function releaseTakeover(threadRef: string): Promise<void> {
  await getPool().query(
    `update thread_takeovers
     set is_active = false, released_at = now()
     where client_id = $1 and thread_ref = $2 and is_active = true`,
    [clientId(), threadRef],
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/humanTakeover.ts
git commit -m "feat: humanTakeover DB layer"
```

---

## Task 3: manualReply.ts — send via Twilio + Gmail

**Files:**
- Create: `lib/manualReply.ts`

- [ ] **Step 1: Create the file**

```typescript
import { sendTheoSms } from "@/lib/twilioSms";

export type ManualReplyInput = {
  channel: "sms" | "whatsapp" | "email";
  to: string;               // phone for sms/wa, email address for email
  body: string;
  mediaUrls?: string[];     // public URLs (already uploaded)
  // email-specific
  subject?: string;
  threadId?: string;        // Gmail thread ID for reply threading
  messageId?: string;       // In-Reply-To
  references?: string;
};

export type ManualReplyResult = { ok: true } | { ok: false; error: string };

export async function sendManualReply(input: ManualReplyInput): Promise<ManualReplyResult> {
  try {
    if (input.channel === "sms" || input.channel === "whatsapp") {
      const result = await sendTheoSms(input.to, input.body, input.mediaUrls ?? []);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true };
    }
    if (input.channel === "email") {
      return await sendManualEmail(input);
    }
    return { ok: false, error: `Unsupported channel: ${input.channel}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendManualEmail(input: ManualReplyInput): Promise<ManualReplyResult> {
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
  });
  // If using OAuth token stored in env (same as agent.py token.json approach):
  const credPath = process.env.GMAIL_TOKEN_PATH || "token.json";
  const { OAuth2Client } = await import("google-auth-library");
  const fs = await import("fs");
  const tokenData = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2.setCredentials(tokenData);
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const { MIMEMultipart, MIMEText } = await buildMimeParts(input);

  const raw = Buffer.from(MIMEMultipart).toString("base64url");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: input.threadId },
  });
  return { ok: true };
}

async function buildMimeParts(input: ManualReplyInput): Promise<{ MIMEMultipart: string }> {
  const subject = input.subject || "(no subject)";
  const lines = [
    `To: ${input.to}`,
    `Subject: ${subject.startsWith("Re:") ? subject : `Re: ${subject}`}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ...(input.messageId ? [`In-Reply-To: ${input.messageId}`, `References: ${input.references || ""} ${input.messageId}`.trim()] : []),
    ``,
    input.body,
  ];
  return { MIMEMultipart: lines.join("\r\n") };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/manualReply.ts
git commit -m "feat: manualReply send via Twilio + Gmail"
```

---

## Task 4: API — takeover toggle route

**Files:**
- Create: `app/api/threads/[threadRef]/takeover/route.ts`

- [ ] **Step 1: Create directories and file**

```bash
mkdir -p app/api/threads/\[threadRef\]/takeover
```

```typescript
// app/api/threads/[threadRef]/takeover/route.ts
import { NextRequest, NextResponse } from "next/server";
import { activateTakeover, releaseTakeover, getTakeover } from "@/lib/humanTakeover";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  const state = await getTakeover(threadRef);
  return NextResponse.json({ isActive: state?.isActive ?? false, takenBy: state?.takenBy ?? null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  const body = await req.json() as { action: "take" | "release"; channel?: string; takenBy?: string };
  if (body.action === "take") {
    if (!body.channel) return NextResponse.json({ ok: false, error: "channel required" }, { status: 400 });
    await activateTakeover(threadRef, body.channel, body.takenBy ?? "owner");
    return NextResponse.json({ ok: true, isActive: true });
  }
  if (body.action === "release") {
    await releaseTakeover(threadRef);
    return NextResponse.json({ ok: true, isActive: false });
  }
  return NextResponse.json({ ok: false, error: "action must be take|release" }, { status: 400 });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/threads/
git commit -m "feat: takeover toggle API route"
```

---

## Task 5: API — media upload route

**Files:**
- Create: `app/api/threads/[threadRef]/upload/route.ts`

- [ ] **Step 1: Create file**

```typescript
// app/api/threads/[threadRef]/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "application/pdf"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  await params; // threadRef available if needed for namespacing
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ ok: false, error: "File too large (max 10MB)" }, { status: 413 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ ok: false, error: "File type not allowed" }, { status: 415 });

  const ext = file.name.split(".").pop() ?? "bin";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(UPLOAD_DIR, filename), buffer);

  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
  const publicUrl = `${baseUrl}/uploads/${filename}`;
  return NextResponse.json({ ok: true, url: publicUrl, filename });
}
```

- [ ] **Step 2: Add uploads to .gitignore**

```bash
echo "public/uploads/" >> .gitignore
```

- [ ] **Step 3: Commit**

```bash
git add app/api/threads/ .gitignore
git commit -m "feat: media upload API for manual replies"
```

---

## Task 6: API — manual reply route

**Files:**
- Create: `app/api/threads/[threadRef]/reply/route.ts`

- [ ] **Step 1: Create file**

```typescript
// app/api/threads/[threadRef]/reply/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { sendManualReply } from "@/lib/manualReply";
import { recordChannelInteraction } from "@/lib/channelIngest";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  const body = await req.json() as {
    channel: "sms" | "whatsapp" | "email";
    to: string;
    body: string;
    mediaUrls?: string[];
    subject?: string;
    threadId?: string;
    messageId?: string;
    references?: string;
  };

  if (!body.channel || !body.to || !body.body) {
    return NextResponse.json({ ok: false, error: "channel, to, and body required" }, { status: 400 });
  }

  const active = await isTakeoverActive(threadRef);
  if (!active) {
    return NextResponse.json({ ok: false, error: "No active takeover for this thread" }, { status: 403 });
  }

  const result = await sendManualReply({
    channel: body.channel,
    to: body.to,
    body: body.body,
    mediaUrls: body.mediaUrls,
    subject: body.subject,
    threadId: body.threadId,
    messageId: body.messageId,
    references: body.references,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }

  // Record the outbound event
  await recordChannelInteraction({
    channel: body.channel === "whatsapp" ? "whatsapp" : body.channel === "email" ? "email" : "sms",
    direction: "outbound",
    agentName: "Owner",
    source: "human_takeover",
    phone: body.channel !== "email" ? body.to : undefined,
    email: body.channel === "email" ? body.to : undefined,
    threadRef,
    messageText: body.body,
    preferredChannel: body.channel,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/threads/
git commit -m "feat: manual reply API route"
```

---

## Task 7: Webhook guards — skip AI when takeover active

**Files:**
- Modify: `app/api/webhooks/theo-sms/route.ts`
- Modify: `app/api/webhooks/theo-whatsapp/route.ts` (if exists, else same file handles both via `From` prefix)

- [ ] **Step 1: Find where Theo generates reply in SMS webhook**

```bash
grep -n "generateTheoReply\|theoAgent" app/api/webhooks/theo-sms/route.ts | head -10
```

- [ ] **Step 2: Add import + guard in theo-sms/route.ts**

At top of file, add import:
```typescript
import { isTakeoverActive } from "@/lib/humanTakeover";
```

Find the line just before `generateTheoReply` is called. Wrap it:
```typescript
// Check human takeover BEFORE generating AI reply
const threadRef = /* existing threadRef variable */;
if (await isTakeoverActive(threadRef)) {
  logTheo("human takeover active — skipping AI reply", { threadRef });
  return webhookResponse(request, { ok: true, skipped: "human_takeover" });
}
// ... existing generateTheoReply call ...
```

- [ ] **Step 3: Repeat for theo-whatsapp webhook**

```bash
grep -n "generateTheoReply\|theoAgent" app/api/webhooks/theo-whatsapp/route.ts | head -10
```

Add same import + guard pattern.

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/theo-sms/route.ts app/api/webhooks/theo-whatsapp/route.ts
git commit -m "feat: skip AI reply when human takeover active"
```

---

## Task 8: HumanTakeover UI component

**Files:**
- Create: `components/inbox/HumanTakeover.tsx`

- [ ] **Step 1: Create component**

```tsx
"use client";

import { useRef, useState } from "react";

export type TakeoverState = { isActive: boolean; takenBy: string | null };

export function HumanTakeover({
  threadRef,
  channel,
  to,
  subject,
  gmailThreadId,
  messageId,
  references,
  initialState,
}: {
  threadRef: string;
  channel: "sms" | "whatsapp" | "email";
  to: string;
  subject?: string;
  gmailThreadId?: string;
  messageId?: string;
  references?: string;
  initialState: TakeoverState;
}) {
  const [state, setState] = useState<TakeoverState>(initialState);
  const [body, setBody] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function toggleTakeover() {
    const action = state.isActive ? "release" : "take";
    const res = await fetch(`/api/threads/${encodeURIComponent(threadRef)}/takeover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, channel, takenBy: "owner" }),
    });
    const data = await res.json();
    if (data.ok) setState({ isActive: data.isActive, takenBy: data.isActive ? "owner" : null });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/threads/${encodeURIComponent(threadRef)}/upload`, { method: "POST", body: form });
    const data = await res.json();
    setUploading(false);
    if (data.ok) setMediaUrls((prev) => [...prev, data.url]);
    else setError(data.error || "Upload failed");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (!body.trim() && mediaUrls.length === 0) return;
    setSending(true);
    setError("");
    const res = await fetch(`/api/threads/${encodeURIComponent(threadRef)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        to,
        body: body.trim(),
        mediaUrls,
        subject,
        threadId: gmailThreadId,
        messageId,
        references,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (data.ok) {
      setBody("");
      setMediaUrls([]);
    } else {
      setError(data.error || "Send failed");
    }
  }

  return (
    <div className="human-takeover-bar">
      <div className="human-takeover-header">
        <div className="human-takeover-status">
          <span className={`takeover-dot ${state.isActive ? "active" : ""}`} />
          <span className="takeover-label">
            {state.isActive ? `You have control — AI paused` : "AI active"}
          </span>
        </div>
        <button
          className={`takeover-toggle-btn ${state.isActive ? "release" : "take"}`}
          onClick={toggleTakeover}
          type="button"
        >
          {state.isActive ? "Release to AI" : "Take over"}
        </button>
      </div>

      {state.isActive && (
        <div className="human-compose">
          <textarea
            className="human-compose-textarea"
            placeholder={`Reply as ${channel === "email" ? "email" : channel.toUpperCase()}…`}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          {mediaUrls.length > 0 && (
            <div className="human-compose-attachments">
              {mediaUrls.map((url, i) => (
                <div key={url} className="human-compose-attachment">
                  <span>{url.split("/").pop()}</span>
                  <button
                    type="button"
                    onClick={() => setMediaUrls((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Remove attachment"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          {error && <div className="human-compose-error">{error}</div>}
          <div className="human-compose-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/mp4,application/pdf"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <button
              className="human-compose-attach-btn"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Attach media"
            >
              {uploading ? "Uploading…" : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
              )}
            </button>
            <button
              className="human-compose-send-btn"
              type="button"
              onClick={send}
              disabled={sending || (!body.trim() && mediaUrls.length === 0)}
            >
              {sending ? "Sending…" : `Send via ${channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : "Email"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add CSS to globals.css**

Append to `app/globals.css`:

```css
/* ── Human Takeover Bar ── */
.human-takeover-bar {
  border-top: 1px solid var(--s-card-border);
  background: var(--s-card);
  padding: var(--sp-3) var(--sp-4);
}
.human-takeover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.human-takeover-status {
  display: flex;
  align-items: center;
  gap: 8px;
}
.takeover-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--s-text-3);
  flex-shrink: 0;
}
.takeover-dot.active {
  background: var(--s-warn);
  box-shadow: 0 0 0 3px rgba(251,185,72,0.25);
}
.takeover-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--s-text-2);
}
.takeover-toggle-btn {
  border-radius: var(--s-r-sm);
  border: 1px solid var(--s-card-border);
  background: var(--s-surface);
  color: var(--s-text-1);
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.takeover-toggle-btn.take {
  border-color: var(--s-accent);
  background: var(--s-accent-soft);
  color: var(--s-accent);
}
.takeover-toggle-btn.release {
  border-color: var(--s-warn);
  background: var(--s-warn-soft);
  color: var(--s-warn);
}
.human-compose {
  margin-top: var(--sp-3);
  display: grid;
  gap: var(--sp-2);
}
.human-compose-textarea {
  width: 100%;
  border: 1px solid var(--s-card-border);
  border-radius: var(--s-r-sm);
  background: var(--s-bg);
  color: var(--s-text-1);
  padding: var(--sp-3);
  font-size: 13px;
  resize: vertical;
  outline: none;
  font-family: var(--s-font);
}
.human-compose-textarea:focus {
  border-color: var(--s-accent);
  box-shadow: 0 0 0 3px rgba(124,106,245,0.12);
}
.human-compose-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.human-compose-attachment {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--s-card-border);
  border-radius: 6px;
  background: var(--s-surface);
  padding: 3px 8px;
  font-size: 11px;
  color: var(--s-text-2);
}
.human-compose-attachment button {
  border: 0;
  background: none;
  color: var(--s-danger);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.human-compose-error {
  font-size: 12px;
  color: var(--s-danger);
}
.human-compose-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  justify-content: flex-end;
}
.human-compose-attach-btn {
  border: 1px solid var(--s-card-border);
  border-radius: var(--s-r-sm);
  background: var(--s-surface);
  color: var(--s-text-2);
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.human-compose-attach-btn:hover { color: var(--s-text-1); }
.human-compose-send-btn {
  border: 0;
  border-radius: var(--s-r-sm);
  background: var(--s-accent);
  color: #fff;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.human-compose-send-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
```

- [ ] **Step 3: Commit**

```bash
git add components/inbox/HumanTakeover.tsx app/globals.css
git commit -m "feat: HumanTakeover UI component + CSS"
```

---

## Task 9: Wire HumanTakeover into AgentInboxClient

**Files:**
- Modify: `components/AgentInboxClient.tsx`

- [ ] **Step 1: Find where thread view renders for SMS/WA/email**

```bash
grep -n "thread-messages\|conversation-panel\|message\.outbound\|activeThread\|ThreadView\|renderThread" components/AgentInboxClient.tsx | head -20
```

- [ ] **Step 2: Import HumanTakeover**

At top of `AgentInboxClient.tsx`:
```typescript
import { HumanTakeover } from "@/components/inbox/HumanTakeover";
```

- [ ] **Step 3: Add takeover state per thread**

Inside the component that renders a thread conversation (wherever `activeThread` is displayed), add:

```tsx
{/* Human takeover bar — shown for SMS, WhatsApp, email threads */}
{(currentView === "sms" || currentView === "whatsapp" || currentView === "email") && activeThread && (
  <HumanTakeover
    threadRef={activeThread[0]}   // threadRef is first element of [threadRef, events[]] tuple
    channel={currentView as "sms" | "whatsapp" | "email"}
    to={activeThread[1][0]?.phone || activeThread[1][0]?.email || ""}
    subject={activeThread[1][0]?.source || ""}
    initialState={{ isActive: false, takenBy: null }}
  />
)}
```

- [ ] **Step 4: Build**

```bash
cd /Users/martinofunrein/Downloads/real-estate-email-agent-human-takeover && npm run build 2>&1 | tail -15
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add components/AgentInboxClient.tsx
git commit -m "feat: wire HumanTakeover into thread view"
```

---

## Task 10: Final push

- [ ] **Step 1: Push branch**

```bash
git push -u origin feature/human-takeover
```

- [ ] **Step 2: Verify API routes exist**

```bash
curl -s http://localhost:3000/api/threads/test-thread/takeover | python3 -m json.tool
```

Expected: `{"isActive": false, "takenBy": null}`

---

## Self-Review

**Spec coverage:**
- ✅ Take over / release toggle per thread
- ✅ Manual reply with text body
- ✅ Media upload → attach to reply
- ✅ SMS channel (Twilio)
- ✅ WhatsApp channel (Twilio, same sendTheoSms with `whatsapp:+1...` to field)
- ✅ Email channel (Gmail API, same token as agent.py)
- ✅ AI skip guard in Theo SMS webhook
- ✅ Event recorded as outbound human_takeover

**Gaps:**
- WhatsApp `to` address needs `whatsapp:` prefix — `sendTheoSms` in `twilioSms.ts` already handles this if `to` is passed with prefix; caller must ensure this. Note in Task 9 step 3.
- Iris email webhook guard (Python `agent.py`) — not covered here (Python daemon). Add guard in `agent.py`: check `thread_takeovers` table before calling LLM/send.
- Persistent takeover state on page reload — `initialState` is always `{isActive:false}`. Production: fetch from `/api/threads/[threadRef]/takeover` on mount. Add `useEffect` fetch in HumanTakeover.tsx after Task 8.
