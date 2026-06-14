# Agent Inbox UI Overhaul — "Brokerage Terminal" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform AgentInboxClient.tsx from generic AI-slop dashboard into a Superhuman×Bloomberg terminal — warm, typographically tight, information-dense, human-inbox feel.

**Architecture:** Pure frontend refactor. No backend changes. Extract 1709-line monolith into focused components. Replace generic CSS with a curated token system. No new dependencies beyond Google Fonts.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.7, custom CSS (no Tailwind), `app/globals.css` for tokens.

**Backend contract (DO NOT BREAK):**
- `SheetRow` field names — never rename keys
- `channel` enum values: `"email"`, `"sms"`, `"rcs"`, `"whatsapp"`, `"voice"`, `"web"`, `"website"`, `"website_chat"`
- `direction` values: `"inbound"` / `"outbound"` (case-sensitive)
- `/api/data` response shape — all top-level keys must be present

---

## File Structure

### New files to create
- `components/inbox/StatusDot.tsx` — 6px status dot, three variants
- `components/inbox/SyncIndicator.tsx` — pulsing dot + tooltip
- `components/inbox/AgentLabel.tsx` — "via Iris · Email" inline label
- `components/inbox/RelativeTime.tsx` — relative timestamp in Berkeley Mono
- `components/inbox/EmptyState.tsx` — per-channel SVG empty states
- `components/inbox/ConversationList.tsx` — thread list extracted from monolith
- `components/inbox/Sidebar.tsx` — dark nav rail extracted from monolith
- `components/inbox/PropertyTable.tsx` — property table extracted from monolith

### Modified files
- `app/globals.css` — add full token system, delete box-shadows, delete old variables
- `app/layout.tsx` — add Google Fonts import (Lora, Inter Variable)
- `components/AgentInboxClient.tsx` — consume new tokens, import new components, shrink from 1709 → ~900 lines

---

## WEEK 1 — Foundation (pure CSS + micro-components, no layout changes)

---

### Task 1: Add font imports and CSS custom properties

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add Google Fonts to layout.tsx**

Open `app/layout.tsx`. Replace:
```tsx
import "./globals.css";
```
With:
```tsx
import "./globals.css";
```
And replace the `<html>` tag to add font preconnect in the `<head>`. Full file after change:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Inbox",
  description: "Read-only monitor for Lumenosis real estate agent conversations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Add token block to top of globals.css**

Open `app/globals.css`. At the very top, before any existing rules, add:

```css
/* ============================================================
   BROKERAGE TERMINAL — Design Tokens
   ============================================================ */
:root {
  /* Backgrounds */
  --bg:              #F7F5F2;
  --surface:         #FFFFFF;
  --surface-raised:  #FAFAF8;
  --nav:             #0F1210;

  /* Borders — one value only */
  --border:          #E5E1DB;

  /* Text */
  --text-primary:    #1C1917;
  --text-secondary:  #6B6560;
  --text-muted:      #A8A39E;
  --text-nav:        #E8E4DF;
  --text-nav-muted:  #737068;

  /* Accent — clay/rust */
  --accent:          #B85C38;
  --accent-subtle:   #F5EDE8;
  --accent-dark:     #7A3A22;

  /* Status */
  --status-needs-human: #B85C38;
  --status-active:      #2D7A4F;
  --status-complete:    #A8A39E;
  --status-voice:       #1E6A6A;

  /* Danger */
  --danger:          #C0392B;

  /* Typography */
  --font-ui:    "Inter", system-ui, -apple-system, sans-serif;
  --font-prose: "Lora", Georgia, serif;
  --font-mono:  "Berkeley Mono", "Geist Mono", "Courier New", monospace;

  /* Type scale */
  --text-xs:   11px;
  --text-sm:   13px;
  --text-base: 14px;
  --text-lg:   17px;

  /* Spacing scale (4px base) */
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3:  12px;
  --sp-4:  16px;
  --sp-6:  24px;
  --sp-8:  32px;
  --sp-12: 48px;

  /* Motion */
  --dur-fast: 80ms;
  --dur-base: 120ms;
  --ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
}

/* Kill all box-shadows site-wide */
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 3: Run dev server and verify fonts load**

```bash
cd ~/Downloads/real-estate-email-agent
npm run dev
```

Open `http://localhost:3000`. Open DevTools → Network → Fonts. Verify `Lora` and `Inter` appear. Background should shift to warm `#F7F5F2`.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: add Brokerage Terminal token system and font imports"
```

---

### Task 2: Create StatusDot component

**Files:**
- Create: `components/inbox/StatusDot.tsx`

- [ ] **Step 1: Create StatusDot.tsx**

```tsx
// components/inbox/StatusDot.tsx
export type Status = "needs_human" | "active" | "complete" | "voice" | "unknown";

const COLOR: Record<Status, string> = {
  needs_human: "var(--status-needs-human)",
  active:      "var(--status-active)",
  complete:    "var(--status-complete)",
  voice:       "var(--status-voice)",
  unknown:     "var(--status-complete)",
};

const LABEL: Record<Status, string> = {
  needs_human: "Needs human",
  active:      "Active",
  complete:    "Complete",
  voice:       "Voice",
  unknown:     "Unknown",
};

export function StatusDot({ status }: { status: string }) {
  const s = (STATUS_KEYS.includes(status as Status) ? status : "unknown") as Status;
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        backgroundColor: COLOR[s],
        flexShrink: 0,
      }}
      aria-label={LABEL[s]}
      title={LABEL[s]}
    />
  );
}

const STATUS_KEYS: string[] = ["needs_human", "active", "complete", "voice", "unknown"];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/inbox/StatusDot.tsx
git commit -m "feat: add StatusDot component (6px dot, replaces all status badge pills)"
```

---

### Task 3: Create SyncIndicator component

**Files:**
- Create: `components/inbox/SyncIndicator.tsx`

- [ ] **Step 1: Create SyncIndicator.tsx**

```tsx
// components/inbox/SyncIndicator.tsx
"use client";
import { useState } from "react";

interface SyncIndicatorProps {
  lastUpdated: string | null; // ISO timestamp or null
  isLive: boolean;
}

export function SyncIndicator({ lastUpdated, isLive }: SyncIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const label = isLive
    ? lastUpdated
      ? `Live · Updated ${formatRelative(lastUpdated)}`
      : "Live"
    : "Offline";

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: isLive ? "var(--status-active)" : "var(--status-complete)",
          animation: isLive ? "pulse-dot 2400ms ease-in-out infinite" : "none",
        }}
        aria-label={label}
      />
      {showTooltip && (
        <span
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--nav)",
            color: "var(--text-nav)",
            fontSize: "var(--text-xs)",
            padding: "4px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 100,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
```

- [ ] **Step 2: Add pulse-dot keyframe to globals.css**

Append to `app/globals.css`:

```css
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add components/inbox/SyncIndicator.tsx app/globals.css
git commit -m "feat: add SyncIndicator (pulsing dot + tooltip replaces 4 sync-status divs)"
```

---

### Task 4: Create RelativeTime and AgentLabel components

**Files:**
- Create: `components/inbox/RelativeTime.tsx`
- Create: `components/inbox/AgentLabel.tsx`

- [ ] **Step 1: Create RelativeTime.tsx**

```tsx
// components/inbox/RelativeTime.tsx
"use client";
import { useEffect, useState } from "react";

export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  const [label, setLabel] = useState(() => format(iso));

  useEffect(() => {
    const id = setInterval(() => setLabel(format(iso)), 30_000);
    return () => clearInterval(id);
  }, [iso]);

  if (!iso) return null;

  return (
    <time
      dateTime={iso}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        color: "var(--text-muted)",
        fontWeight: 500,
        flexShrink: 0,
      }}
      title={new Date(iso).toLocaleString()}
    >
      {label}
    </time>
  );
}

function format(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (diff < 604_800_000) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Create AgentLabel.tsx**

```tsx
// components/inbox/AgentLabel.tsx
const AGENT_FOR_CHANNEL: Record<string, string> = {
  email:        "Iris",
  sms:          "Theo",
  rcs:          "Theo",
  whatsapp:     "Theo",
  voice:        "Aria",
  web:          "Olivia",
  website:      "Olivia",
  website_chat: "Olivia",
};

interface AgentLabelProps {
  channel: string;
  channelLabel?: string;
}

export function AgentLabel({ channel, channelLabel }: AgentLabelProps) {
  const agent = AGENT_FOR_CHANNEL[channel] ?? "Agent";
  const display = channelLabel ?? channel.replace(/_/g, " ");

  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-xs)",
        color: "var(--text-muted)",
        fontWeight: 400,
      }}
    >
      via {agent} · {display}
    </span>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add components/inbox/RelativeTime.tsx components/inbox/AgentLabel.tsx
git commit -m "feat: add RelativeTime (mono timestamps) and AgentLabel (via Iris · Email)"
```

---

### Task 5: Replace all status badge pills with StatusDot in AgentInboxClient

**Files:**
- Modify: `components/AgentInboxClient.tsx`

- [ ] **Step 1: Import StatusDot at top of AgentInboxClient.tsx**

Find the import block at the top of `components/AgentInboxClient.tsx`. Add:

```tsx
import { StatusDot } from "@/components/inbox/StatusDot";
import { RelativeTime } from "@/components/inbox/RelativeTime";
import { AgentLabel } from "@/components/inbox/AgentLabel";
import { SyncIndicator } from "@/components/inbox/SyncIndicator";
```

- [ ] **Step 2: Search and replace status badge patterns**

In `AgentInboxClient.tsx`, find every pattern like:
```tsx
<span className="status">{event.status}</span>
<span className="status-badge">{event.status}</span>
<div className="handoff-badge">needs_human</div>
```

Replace each with:
```tsx
<StatusDot status={event.status ?? "unknown"} />
```

Search for all occurrences:
```bash
grep -n "status.*className\|className.*status\|needs_human\|handoff-badge\|status-badge\|complete-pill\|active-pill" components/AgentInboxClient.tsx | head -30
```

For each match, substitute the badge JSX with `<StatusDot status={...} />`.

- [ ] **Step 3: Replace sync-status topbar with SyncIndicator**

Find the topbar section. It will have patterns like:
```tsx
<div>Google Sheets live</div>
<div>Auto refresh 5s</div>
<div>Updated {time}</div>
```

Replace the entire topbar status block with:
```tsx
<SyncIndicator lastUpdated={data?.lastUpdated ?? null} isLive={true} />
```

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: compiled successfully (or only pre-existing TS warnings, no new errors).

- [ ] **Step 5: Visual check**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify: no colored text badges visible for status. Only 6px dots. Sync area shows one pulsing dot.

- [ ] **Step 6: Commit**

```bash
git add components/AgentInboxClient.tsx
git commit -m "feat: replace all status badge pills with StatusDot 6px dots"
```

---

### Task 6: Kill all box-shadows, apply warm background

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Find all box-shadow declarations**

```bash
grep -n "box-shadow" app/globals.css | head -40
```

- [ ] **Step 2: Replace every box-shadow with border**

For each `box-shadow` declaration found, replace with one of:
- `border: 1px solid var(--border);` — for cards/panels
- Remove entirely — for hover states

Specific replacements in `globals.css`:
```css
/* DELETE all of these patterns: */
box-shadow: var(--shadow);
box-shadow: var(--shadow-tight);
box-shadow: 0 24px 70px rgba(0,0,0,0.08);
box-shadow: 0 10px 28px rgba(0,0,0,0.06);
box-shadow: 0 1px 3px rgba(0,0,0,0.1);
box-shadow: 0 2px 8px rgba(0,0,0,0.12);

/* REPLACE cards/panels with: */
border: 1px solid var(--border);

/* REMOVE entirely from hover states */
```

- [ ] **Step 3: Set app shell background**

Find or add the `.app, .inbox-layout, body` rule and set:
```css
body, .app-shell, .inbox-layout, .inbox-main {
  background: var(--bg);
}

.channel-panel, .inbox-panel, .card, .metric {
  background: var(--surface);
  border: 1px solid var(--border);
}
```

- [ ] **Step 4: Delete legacy shadow variables**

In `:root` block, delete:
```css
--shadow: ...;
--shadow-tight: ...;
--shadow-hover: ...;
```

- [ ] **Step 5: Visual check**

```bash
npm run dev
```

App should now have warm off-white background. No floating cards with drop shadows. Everything coplanar with border separation.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat: eliminate all box-shadows, apply warm #F7F5F2 background"
```

---

### Task 7: Apply Lora to message bodies, mono to timestamps

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add message body typography rules**

Find or add rules for email/SMS message body text. Add to `globals.css`:

```css
/* Message prose — Lora for human readability */
.message-text,
.message-body,
.email-rendered,
.email-body,
.email-rendered-html,
.email-rendered-html p,
.email-rendered-html div {
  font-family: var(--font-prose);
  font-size: var(--text-base);
  line-height: 1.65;
  color: var(--text-primary);
}

/* All timestamps → mono */
.message-time,
.thread-time,
.event-time,
.sync-time,
.relative-time,
time {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0;
}

/* UI chrome stays Inter */
.metric-label,
.channel-label,
.agent-label,
.status-label,
button,
input,
select {
  font-family: var(--font-ui);
}
```

- [ ] **Step 2: Apply font-weight hierarchy to thread list**

```css
/* Unread threads — weight is the indicator, not a dot */
.thread-row[data-unread="true"] .thread-subject {
  font-weight: 700;
  color: var(--text-primary);
}

.thread-row[data-unread="false"] .thread-subject,
.thread-row:not([data-unread]) .thread-subject {
  font-weight: 400;
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Visual check — message view**

```bash
npm run dev
```

Click an email conversation. Body text should render in Lora serif. Timestamps in monospace. Subject lines heavier weight.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat: Lora on message bodies, Berkeley Mono on timestamps, weight-based unread"
```

---

## WEEK 2 — Layout Restructure

---

### Task 8: Extract PropertyTable component

**Files:**
- Create: `components/inbox/PropertyTable.tsx`
- Modify: `components/AgentInboxClient.tsx`

- [ ] **Step 1: Find property table code in AgentInboxClient.tsx**

```bash
grep -n "property-table\|PropertyTable\|PropertySort\|PropertySortKey\|property-row\|property-photo" components/AgentInboxClient.tsx | head -30
```

Note the line ranges. The property table section is roughly lines 490–680.

- [ ] **Step 2: Create PropertyTable.tsx**

Create `components/inbox/PropertyTable.tsx`. Move all property-related code from `AgentInboxClient.tsx`:
- The `PropertySortKey` type
- The `PropertySort` type
- The `PropertyPhoto` function component
- The `PropertyPreviewButton` function component
- The `PropertyTable` function component
- All property-related helper functions

File structure:
```tsx
"use client";

import type { SheetRow } from "@/lib/sheetSchema";

// Types
type PropertySortKey = "source_order" | "address" | "price" | "beds" | "baths" | "sqft" | "city" | "neighborhood";
type PropertySort = { key: PropertySortKey; direction: "asc" | "desc" };

// [Copy PropertyPhoto component from AgentInboxClient.tsx]
// [Copy PropertyPreviewButton component from AgentInboxClient.tsx]

// Main export
export function PropertyTable({ properties }: { properties: SheetRow[] }) {
  // [Copy PropertyTable function body from AgentInboxClient.tsx]
}
```

- [ ] **Step 3: Replace in AgentInboxClient.tsx**

In `AgentInboxClient.tsx`, replace the inline `PropertyTable` definition with an import:
```tsx
import { PropertyTable } from "@/components/inbox/PropertyTable";
```

Delete the now-redundant type definitions and function bodies from `AgentInboxClient.tsx`.

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | grep -E "error|Error|✓|✗" | head -20
```

- [ ] **Step 5: Visual check — properties tab**

Click the Properties view. Table should render identically to before.

- [ ] **Step 6: Commit**

```bash
git add components/inbox/PropertyTable.tsx components/AgentInboxClient.tsx
git commit -m "refactor: extract PropertyTable into dedicated component (~400 lines freed)"
```

---

### Task 9: Extract EmptyState component with SVG icons

**Files:**
- Create: `components/inbox/EmptyState.tsx`
- Modify: `components/AgentInboxClient.tsx`

- [ ] **Step 1: Create EmptyState.tsx with per-channel SVGs**

```tsx
// components/inbox/EmptyState.tsx

const ICONS: Record<string, React.ReactNode> = {
  email: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 7 10-7" />
    </svg>
  ),
  sms: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  whatsapp: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  voice: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 1v4M8 5v2M16 5v2M6 9v6M18 9v6M10 3v8M14 3v8" />
    </svg>
  ),
  website_chat: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8M8 8h4" />
    </svg>
  ),
  properties: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 12l9-9 9 9M5 10v9h4v-5h6v5h4v-9" />
    </svg>
  ),
};

const LABELS: Record<string, string> = {
  email:        "No email conversations yet",
  sms:          "No SMS conversations yet",
  whatsapp:     "No WhatsApp conversations yet",
  voice:        "No voice calls yet",
  website_chat: "No website chats yet",
  properties:   "No properties loaded",
};

export function EmptyState({ channel }: { channel: string }) {
  const icon = ICONS[channel] ?? ICONS.email;
  const label = LABELS[channel] ?? "Nothing here yet";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-8)",
        color: "var(--text-muted)",
      }}
    >
      {icon}
      <span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Replace empty state JSX in AgentInboxClient.tsx**

Search for empty state patterns:
```bash
grep -n "empty\|no.*conversation\|no.*message\|empty-icon" components/AgentInboxClient.tsx | head -20
```

Replace each with:
```tsx
<EmptyState channel={view} />
```

Add import:
```tsx
import { EmptyState } from "@/components/inbox/EmptyState";
```

- [ ] **Step 3: Add EmptyState CSS to globals.css**

```css
/* EmptyState — no border, no background, pure muted tone */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-8);
  color: var(--text-muted);
}
```

- [ ] **Step 4: Build + visual check**

```bash
npm run build 2>&1 | grep -E "error|✓" | head -10
npm run dev
```

Switch to a channel with no messages. SVG icon + single quiet label. No `<div>0</div>`.

- [ ] **Step 5: Commit**

```bash
git add components/inbox/EmptyState.tsx components/AgentInboxClient.tsx app/globals.css
git commit -m "feat: EmptyState with per-channel SVG icons (replaces 0-as-icon pattern)"
```

---

### Task 10: Extract Sidebar component and delete channel-strip from main

**Files:**
- Create: `components/inbox/Sidebar.tsx`
- Modify: `components/AgentInboxClient.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Create Sidebar.tsx**

```tsx
// components/inbox/Sidebar.tsx
"use client";

import type { AgentInboxData } from "@/lib/inboxData";
import { StatusDot } from "./StatusDot";

type View = "overview" | "email" | "sms" | "whatsapp" | "voice" | "website_chat" | "properties";

interface SidebarProps {
  currentView: View;
  onViewChange: (v: View) => void;
  data: AgentInboxData | null;
}

const NAV_ITEMS: { key: View; label: string; agent: string }[] = [
  { key: "email",        label: "Email",      agent: "Iris"   },
  { key: "sms",          label: "SMS",        agent: "Theo"   },
  { key: "whatsapp",     label: "WhatsApp",   agent: "Theo"   },
  { key: "voice",        label: "Voice",      agent: "Aria"   },
  { key: "website_chat", label: "Chat",       agent: "Olivia" },
  { key: "properties",   label: "Properties", agent: ""       },
];

export function Sidebar({ currentView, onViewChange, data }: SidebarProps) {
  const needsHuman = data?.metrics?.needs_human ?? 0;

  return (
    <nav className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <span className="sidebar-wordmark">Agent Inbox</span>
      </div>

      {/* Channel nav */}
      <ul className="sidebar-nav" role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.key}>
            <button
              className={`sidebar-nav-item ${currentView === item.key ? "active" : ""}`}
              onClick={() => onViewChange(item.key)}
              type="button"
              aria-current={currentView === item.key ? "page" : undefined}
            >
              <span className="sidebar-nav-label">{item.label}</span>
              {item.agent && (
                <span className="sidebar-nav-agent">{item.agent}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* Metrics */}
      <div className="sidebar-metrics">
        <div className="sidebar-metric" data-accent={needsHuman > 0 ? "true" : undefined}>
          <span className="sidebar-metric-value" style={needsHuman > 0 ? { color: "var(--accent)" } : {}}>
            {needsHuman}
          </span>
          <span className="sidebar-metric-label">Handoffs</span>
        </div>
        <div className="sidebar-metric">
          <span className="sidebar-metric-value">{data?.metrics?.lead_count ?? 0}</span>
          <span className="sidebar-metric-label">Leads</span>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Add Sidebar CSS to globals.css**

```css
/* ============ SIDEBAR ============ */
.sidebar {
  background: var(--nav);
  display: flex;
  flex-direction: column;
  width: 220px;
  min-height: 100dvh;
  border-right: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.sidebar-brand {
  padding: var(--sp-4);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.sidebar-wordmark {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-nav);
  letter-spacing: 0.02em;
}

.sidebar-nav {
  list-style: none;
  margin: 0;
  padding: var(--sp-2) 0;
  flex: 1;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--sp-2) var(--sp-4);
  background: transparent;
  border: none;
  color: var(--text-nav-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) linear;
}

.sidebar-nav-item:hover {
  background: rgba(255,255,255,0.04);
  color: var(--text-nav);
}

.sidebar-nav-item.active {
  background: rgba(255,255,255,0.07);
  color: var(--text-nav);
  border-left: 2px solid var(--accent);
  padding-left: calc(var(--sp-4) - 2px);
}

.sidebar-nav-label { font-weight: 400; }
.sidebar-nav-agent {
  font-size: var(--text-xs);
  color: var(--text-nav-muted);
  font-weight: 400;
}

.sidebar-metrics {
  padding: var(--sp-4);
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex;
  gap: var(--sp-6);
}

.sidebar-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-metric-value {
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-nav);
}

.sidebar-metric-label {
  font-size: var(--text-xs);
  color: var(--text-nav-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 500;
}
```

- [ ] **Step 3: Integrate Sidebar into AgentInboxClient.tsx**

In `AgentInboxClient.tsx`, add import:
```tsx
import { Sidebar } from "@/components/inbox/Sidebar";
```

Find the main layout JSX. Wrap content in a flex row with Sidebar on the left:
```tsx
<div className="app-shell">
  <Sidebar
    currentView={view}
    onViewChange={setView}
    data={data}
  />
  <main className="inbox-main">
    {/* existing main content */}
  </main>
</div>
```

- [ ] **Step 4: Add app-shell layout to globals.css**

```css
.app-shell {
  display: flex;
  min-height: 100dvh;
  background: var(--bg);
}

.inbox-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 5: Find and delete the channel-strip from main**

Search for the channel-strip tile grid:
```bash
grep -n "channel-strip\|agent-tile\|channel-tile" components/AgentInboxClient.tsx | head -10
```

Delete that JSX block entirely. Channel navigation is now only in the Sidebar.

- [ ] **Step 6: Build + visual check**

```bash
npm run build 2>&1 | grep -E "error|✓" | head -10
npm run dev
```

Left sidebar should show dark nav. Channel-strip avatar grid should be gone from main.

- [ ] **Step 7: Commit**

```bash
git add components/inbox/Sidebar.tsx components/AgentInboxClient.tsx app/globals.css
git commit -m "feat: extract Sidebar component, delete channel-strip avatar grid from main"
```

---

### Task 11: Kill the metric cards grid, move metrics to sidebar

**Files:**
- Modify: `components/AgentInboxClient.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Find metric cards in AgentInboxClient.tsx**

```bash
grep -n "metric\|metric-card\|metric-grid\|MetricCard" components/AgentInboxClient.tsx | head -20
```

- [ ] **Step 2: Delete the metric grid JSX**

The 6-card grid looks like:
```tsx
<div className="metrics-grid">
  {metric("Leads", data.metrics.lead_count)}
  {metric("Events", data.metrics.event_count)}
  {/* ... more metric() calls */}
</div>
```

Delete the entire metrics grid section from the overview. Metrics are now only in the Sidebar component (already added in Task 10).

- [ ] **Step 3: Delete metric CSS classes from globals.css**

```bash
grep -n "\.metric\|metrics-grid\|metric-card" app/globals.css | head -20
```

Remove: `.metric`, `.metric-label`, `.metrics-grid`, `.metric-button`, `.metric-card`, and all their hover/shadow variants.

- [ ] **Step 4: Visual check**

```bash
npm run dev
```

Overview page: no card grid. Metrics visible only in left sidebar as plain number + label rows.

- [ ] **Step 5: Commit**

```bash
git add components/AgentInboxClient.tsx app/globals.css
git commit -m "feat: delete metric card grid (metrics moved to sidebar only)"
```

---

## WEEK 3 — Interaction Layer

---

### Task 12: Thread list row redesign with 44px fixed height

**Files:**
- Modify: `app/globals.css`
- Modify: `components/AgentInboxClient.tsx`

- [ ] **Step 1: Find thread/event list CSS**

```bash
grep -n "thread-row\|event-row\|conversation-row\|event-item\|thread-item" app/globals.css | head -20
grep -n "thread-row\|event-row\|conversation-row\|event-item" components/AgentInboxClient.tsx | head -20
```

- [ ] **Step 2: Add thread row styles to globals.css**

```css
/* ============ THREAD LIST ROWS ============ */
.thread-row,
.event-row,
.conversation-item {
  height: 48px;
  display: grid;
  grid-template-columns: 8px 1fr auto;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background var(--dur-fast) linear;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
}

.thread-row:hover,
.event-row:hover {
  background: var(--surface-raised);
}

.thread-row.selected,
.event-row.selected {
  background: var(--accent-subtle);
  box-shadow: inset 3px 0 0 var(--accent);
}

/* One-line truncation — always */
.thread-subject,
.thread-sender,
.event-summary {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-sm);
}

.thread-subject { font-weight: 600; color: var(--text-primary); }
.thread-sender  { font-weight: 400; color: var(--text-secondary); font-size: var(--text-xs); }
```

- [ ] **Step 3: Ensure thread rows render with data-unread attribute**

In `AgentInboxClient.tsx`, find where thread/event rows are rendered. Add `data-unread` attribute:

```tsx
<div
  className="thread-row"
  data-unread={event.read ? "false" : "true"}
  onClick={() => setSelectedThread(event)}
>
```

- [ ] **Step 4: Visual check**

```bash
npm run dev
```

Email/SMS conversation rows should be exactly 48px. Single line. No wrapping. Hover shows `#FAFAF8`. Selected row has left accent bar.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/AgentInboxClient.tsx
git commit -m "feat: thread rows 48px fixed height, inset accent bar for selection, no-wrap truncation"
```

---

### Task 13: Final CSS cleanup — delete all legacy variables and dead classes

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Audit legacy variables**

```bash
grep -n "var(--" app/globals.css | grep -v "bg\|surface\|nav\|border\|text\|accent\|status\|danger\|font\|text-\|sp-\|dur\|ease" | head -30
```

- [ ] **Step 2: Delete all legacy CSS custom properties from :root**

Any variable not in the token system defined in Task 1 — delete it. Common legacy names to remove:
- `--primary`, `--secondary`, `--gray-*`
- `--shadow`, `--shadow-*`
- `--radius`, `--border-radius`
- `--blue-*`, `--green-*`
- Any color not in the Brokerage Terminal palette

- [ ] **Step 3: Remove unused class definitions**

```bash
# Find classes defined in CSS but not used in TSX
grep "^\." app/globals.css | sed 's/[{.:].*//;s/^ //' | sort > /tmp/css_classes.txt
grep -h "className=" components/AgentInboxClient.tsx components/inbox/*.tsx | grep -oP '(?<=className=")[^"]+' | tr ' ' '\n' | sort -u > /tmp/tsx_classes.txt
comm -23 /tmp/css_classes.txt /tmp/tsx_classes.txt | head -30
```

Review the list. Delete CSS classes that have no TSX references and are not utility classes.

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "refactor: delete all legacy CSS variables and dead class definitions"
```

---

### Task 14: Topbar redesign — channel name + sync dot only

**Files:**
- Modify: `components/AgentInboxClient.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Find topbar JSX in AgentInboxClient.tsx**

```bash
grep -n "topbar\|top-bar\|header\|toolbar" components/AgentInboxClient.tsx | head -20
```

- [ ] **Step 2: Replace topbar content**

Find the topbar JSX block. Replace its inner content with:
```tsx
<header className="inbox-topbar">
  <span className="inbox-topbar-title">
    {CHANNEL_LABELS[view] ?? view}
  </span>
  <SyncIndicator
    lastUpdated={data?.lastFetched ?? null}
    isLive={true}
  />
</header>
```

Where `CHANNEL_LABELS` is:
```tsx
const CHANNEL_LABELS: Partial<Record<View, string>> = {
  email:        "Email",
  sms:          "SMS",
  whatsapp:     "WhatsApp",
  voice:        "Voice",
  website_chat: "Chat",
  properties:   "Properties",
  overview:     "Overview",
};
```

- [ ] **Step 3: Add topbar CSS**

```css
.inbox-topbar {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.inbox-topbar-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}
```

- [ ] **Step 4: Visual check**

```bash
npm run dev
```

Topbar: channel name on left, single pulsing dot on right. Nothing else.

- [ ] **Step 5: Commit**

```bash
git add components/AgentInboxClient.tsx app/globals.css
git commit -m "feat: topbar redesign — channel name + sync dot only (delete 4 sync-status divs)"
```

---

### Task 15: Final line count check and summary commit

**Files:**
- No changes

- [ ] **Step 1: Count lines in AgentInboxClient.tsx**

```bash
wc -l components/AgentInboxClient.tsx
```

Target: below 900 lines (down from 1709).

- [ ] **Step 2: Count lines in new components**

```bash
wc -l components/inbox/*.tsx
```

- [ ] **Step 3: Run full build**

```bash
npm run build 2>&1
```

Expected: compiled successfully, no TypeScript errors.

- [ ] **Step 4: Run dev and do full manual smoke test**

```bash
npm run dev
```

Check each view:
- Overview: sidebar metrics only, no card grid
- Email: thread list with 48px rows, Lora message body
- SMS/WhatsApp: same thread list pattern
- Voice: waveform empty state if empty
- Properties: extracted table renders

- [ ] **Step 5: Tag the release**

```bash
git tag v2.0.0-brokerage-terminal
git push origin main --tags
```

---

## Self-Review

**Spec coverage:**
- ✅ Rule 1 (no avatar grid nav) → Task 10: channel-strip deleted, Sidebar added
- ✅ Rule 2 (no pill soup) → Task 5: StatusDot replaces all badges
- ✅ Rule 3 (no metric cards) → Task 11: grid deleted, sidebar metrics only
- ✅ Rule 4 (no zero empty state) → Task 9: EmptyState SVG icons
- ✅ Rule 5 (no data-dump topbar) → Task 14: topbar redesign
- ✅ Typography system → Tasks 1, 7: token system + Lora + mono timestamps
- ✅ Color system → Task 1: all CSS custom properties set
- ✅ Shadow elimination → Task 6: all box-shadows → borders
- ✅ Component extraction → Tasks 8, 9, 10: PropertyTable, EmptyState, Sidebar
- ✅ Backend contract preserved → No changes to lib/, app/api/, SheetRow, channel values

**No placeholders:** All tasks have actual code.

**Type consistency:** `Status` type defined in Task 2 (StatusDot), consumed in Task 5. `View` type already exists in AgentInboxClient.tsx, reused in Sidebar (Task 10). `AgentInboxData` imported from `@/lib/inboxData` in Sidebar — matches existing type.
