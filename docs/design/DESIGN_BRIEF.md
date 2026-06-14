# AgentInboxClient UI Overhaul Design Brief

---

## 1. DESIGN DIRECTION

**Name: "Brokerage Terminal"**

This inbox belongs to a human operator managing AI agents — it is a triage tool, not an AI showcase. The aesthetic is Superhuman crossed with a Bloomberg terminal: warm, typographically tight, deeply information-dense without visual clutter. Every pixel earns its place by reducing triage time, not by communicating "AI-powered." The agents (Iris, Theo, Aria, Olivia) are infrastructure — they appear as ambient metadata, never as featured characters.

---

## 2. ANTI-SLOP RULES

**Rule 1 — No avatar grids as navigation.**
The `channel-strip` (5 agent tiles inside `<main>`) is deleted. Agent identity appears exactly once: a 20px avatar + name in the thread header (`via Iris · Email`). Navigation is a left rail with unread counts, not a gallery of faces.

**Rule 2 — No colored status pill soup.**
Zero instances of `needs_human`, `active`, `complete` as colored badge pills rendered inline. Status is expressed through a single 6px dot (amber = needs human, green = active, gray = complete) placed left of the conversation list item. The word "needs_human" with underscores never renders in the UI.

**Rule 3 — No symmetric metric cards.**
The 6-card metrics grid with identical borders, identical shadows, and identical typographic weight is gone. Metrics exist only in the left rail as quiet number + label pairs. One dominant stat (Handoffs needing human) gets accent treatment. Everything else is secondary text.

**Rule 4 — No zero as an empty state icon.**
`<div className="empty-icon">0</div>` is replaced with a 24px single-weight SVG (inbox silhouette for email, waveform for voice, speech bubble for SMS/WhatsApp). No text inside decorative containers. One quiet line below: `"No email conversations yet"` in `--text-secondary`.

**Rule 5 — No data-dump topbar.**
The four inline sync-status divs (`"Google Sheets live"`, `"Auto refresh 5s"`, `"Updated 9:41:00 AM"`, `"Sort source_order asc"`) are replaced by a single pulsing 6px dot with a tooltip on hover. The topbar shows: channel name (left), dot + relative timestamp (right). Nothing else.

---

## 3. VISUAL SYSTEM

### Typography

```
--font-prose:  "Lora", Georgia, serif;           /* message body, email HTML */
--font-ui:     "Inter Variable", system-ui;      /* all chrome, metadata, labels */
--font-mono:   "Berkeley Mono", "Geist Mono", monospace; /* timestamps, phone numbers, IDs */
```

**Scale (4 tiers only):**

```
--text-xs:   11px / line-height 1.2  / Inter 500 uppercase + 0.06em tracking  → labels, badges
--text-sm:   13px / line-height 1.4  / Inter 400                               → metadata, secondary
--text-base: 14px / line-height 1.6  / Inter 400 (prose: Lora 400)            → body, messages
--text-lg:   17px / line-height 1.3  / Inter 600                               → panel titles, headers
```

**Weight system — 4 values only:**

```
400 → body, message prose, sidebar labels
500 → uppercase labels, timestamps (mono)
600 → panel titles, conversation subject lines
700 → unread conversation subjects, active nav items
```

Eliminate 750, 800, 850, 900. Never use font-weight above 700 except `--metric-hero` (one dominant number: 28px / 700).

### Colors

```css
/* Backgrounds */
--bg:              #F7F5F2;   /* warm off-white, entire app shell */
--surface:         #FFFFFF;   /* panels, cards */
--surface-raised:  #FAFAF8;   /* conversation list rows on hover */
--nav:             #0F1210;   /* sidebar — near-black, warm tint */

/* Borders */
--border:          #E5E1DB;   /* all borders — one value, no variants */

/* Text */
--text-primary:    #1C1917;   /* near-black warm */
--text-secondary:  #6B6560;   /* metadata, labels */
--text-muted:      #A8A39E;   /* timestamps, tertiary */
--text-nav:        #E8E4DF;   /* text on dark sidebar */
--text-nav-muted:  #737068;   /* secondary text on dark sidebar */

/* Accent — clay/rust, single accent */
--accent:          #B85C38;   /* primary CTA, unread dot, handoff warning */
--accent-subtle:   #F5EDE8;   /* accent background tint */
--accent-dark:     #7A3A22;   /* accent hover state */

/* Status dots only — no text badges */
--status-needs-human: #B85C38;  /* amber-rust */
--status-active:      #2D7A4F;  /* muted green */
--status-complete:    #A8A39E;  /* gray */
--status-voice:       #1E6A6A;  /* teal for voice channel */

/* Danger */
--danger:          #C0392B;
```

**What is deleted:** Every `color-mix()` hover state. Replace with explicit `--surface-raised` on hover. No `box-shadow` anywhere in the inbox — borders only.

### Spacing

**Base unit: 4px.**

```
4px   → icon padding, dot margins
8px   → inline element gaps
12px  → within-component padding (tight)
16px  → standard component padding
24px  → between sections
32px  → section-to-section in main
48px  → conversation list row height (fixed)
264px → sidebar width (fixed, collapses to 48px at <1100px)
```

No padding above 32px inside the inbox chrome. Density is a feature.

### Motion

**Philosophy:** Functional only. No spring physics. No stagger animations. If a transition takes longer than 150ms the user notices it.

```
/* Pane open/close */
transition: transform 120ms ease-out, opacity 120ms ease-out;

/* Row hover */
transition: background-color 80ms linear;

/* Sync dot pulse (only animation in the product) */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}
animation: pulse-dot 2400ms ease-in-out infinite;

/* Thread list item selection */
transition: background-color 80ms linear;

/* Inline drawer expand (property context) */
transition: height 140ms ease-out;
```

**Forbidden:** `spring`, `bounce`, staggered list entry, scale transforms on hover (the `1.02` scale on metric cards is deleted), any animation above 150ms except the sync dot.

---

## 4. LAYOUT OVERHAUL

### Shell Structure

```
.app-shell {
  display: grid;
  grid-template-columns: 264px 1fr;  /* collapses to 48px at <1100px */
  height: 100dvh;
  background: var(--bg);
}
```

### Sidebar (Left Rail — Dark)

```
.sidebar {
  background: var(--nav);
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
}
```

**Sidebar anatomy (top to bottom):**

1. **Logomark** — SVG wordmark, 16px height, white. Not a letter in a div.
2. **`⌘K` command bar trigger** — a quiet `Search & navigate` input placeholder, 32px height, `--nav` background with 1px border at 12% white opacity. Clicking opens the command palette.
3. **Channel nav** — channels listed as rows, not tabs. Each row: `[6px status dot] [channel label] [unread count pill]`. Labels: Email, SMS, WhatsApp, Voice, Chat, Properties. Active row: `background: rgba(255,255,255,0.07)`, left border: `2px solid var(--accent)`. Keyboard: `G then E/S/W/V/C/P`.
4. **Section divider** — 1px horizontal rule at 8% white opacity.
5. **Metrics (sidebar-only)** — quiet stat rows: `Leads 47 · Handoffs 3` inline. Handoffs count is `var(--accent)` colored when > 0. No cards. No grid.
6. **Agent section** — `Agents` label + list: `[20px avatar] [Iris · Email]` per row. Status dot right-aligned. This is the only place agent avatars appear.

### Main Area — Three-State Layout

**State A: Overview (no conversation selected)**
```
.main {
  display: flex;
  flex-direction: column;
}
.topbar { height: 52px; border-bottom: 1px solid var(--border); }
.workspace { display: grid; grid-template-columns: minmax(320px, 2fr) minmax(280px, 1fr); }
```

**State B: Thread open (conversation selected)**
```
.workspace { grid-template-columns: 320px 1fr 280px; }
/* left: conversation list (fixed) */
/* center: thread pane (dominant) */
/* right: context rail (collapsible) */
```

**State C: Properties view**
```
.workspace { grid-template-columns: 1fr; }
/* full-width PropertyTable with horizontal scroll container */
```

### Conversation List Pane

- Fixed 320px width
- `border-right: 1px solid var(--border)` — no shadow
- Row height: 48px fixed
- Row anatomy: `[6px status dot] [subject 600/700] [agent label sm] [relative timestamp mono right-aligned]`
- Unread: subject is `font-weight: 700`, row has `background: var(--surface)`. Read: `font-weight: 400`, row is `background: transparent`.
- `J/K` to move, `Enter` to open, `E` to resolve, `R` to reply

### Thread Pane (Center)

- Dominant. Takes remaining space.
- Thread header: `[property address breadcrumb] [via Iris · Email] [⌘R Reply]`
- Message bubbles: inbound left, outbound right. No sender label repeated per bubble — show once on direction change only. Timestamps on hover only (tooltip, not inline).
- Message body font: `var(--font-prose)` (Lora). 14px / 1.6 line-height. This is the single biggest quality signal.
- AI-sent badge: a subtle `AI` monospace label in `--text-muted`, 11px, on outbound bubbles. Not a colored pill.

### Context Rail (Right — Collapsible)

- 280px. Closes via `⌘.`. Pushes thread pane, does not overlay.
- Contains: lead name + stage, property address + thumbnail, shared memory fields.
- `Tab` cycles focus between list, thread, rail.
- No `LeadDetail` + `ContextRail` as separate stacked panels. They merge into one scrollable column with clear section headers (11px uppercase, `--text-muted`).

---

## 5. COMPONENT BREAKDOWN

### File Structure

```
src/
  components/
    inbox/
      AgentInboxClient.tsx     ← state + routing only (~250 lines)
      Sidebar.tsx              ← nav, brand, channel list, agent list, metrics
      TopBar.tsx               ← channel title, sync dot, command bar
      ConversationList.tsx     ← thread list, search, keyboard nav
      ThreadViewer.tsx         ← thread pane, bubbles, reply composer
      ContextRail.tsx          ← lead detail + property context merged
      VoiceViewer.tsx          ← voice call cards, transcript drawer
      PropertyTable.tsx        ← full-width table + detail drawer
      EmptyState.tsx           ← per-channel empty states with SVG icons
      CommandPalette.tsx       ← ⌘K modal, channel switching, search
    ui/
      StatusDot.tsx            ← 6px dot, three variants
      SyncIndicator.tsx        ← pulsing dot + tooltip
      AgentLabel.tsx           ← "via Iris · Email" inline label
      RelativeTime.tsx         ← relative timestamp in mono
  hooks/
    useInboxState.ts           ← all useState/useEffect/useMemo extracted
    useKeyboardNav.ts          ← J/K/E/R/G-then-* bindings
    useInboxData.ts            ← data fetching, polling, sheet sync
```

### Extraction Priority

| Component | Lines freed | Dependency risk | Ship this week |
|---|---|---|---|
| `useInboxState.ts` + `useInboxData.ts` | ~150 | None — pure extraction | Yes |
| `EmptyState.tsx` | ~80 | None | Yes |
| `PropertyTable.tsx` (+ all property utils) | ~400 | Props only | Yes |
| `ConversationList.tsx` | ~180 | Needs `useInboxState` first | Week 2 |
| `Sidebar.tsx` | ~120 | Needs `useInboxState` first | Week 2 |
| `CommandPalette.tsx` | ~100 | New component | Week 3 |
| `VoiceViewer.tsx` | ~200 | Isolated | Week 2 |

---

## 6. QUICK WINS (ship this week)

### Win 1 — Typography swap (2 hours, zero layout risk)

Add to global CSS:

```css
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap');

.message-bubble .message-body,
.email-body,
.email-rendered-html {
  font-family: "Lora", Georgia, serif;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-primary);
}
```

All timestamps to mono:

```css
.message-time, .thread-time, .sync-time, .relative-time {
  font-family: "Berkeley Mono", "Geist Mono", monospace;
  font-size: 11px;
  color: var(--text-muted);
}
```

**Effect:** The inbox immediately reads as a letter-handling tool, not a ticket system. This is the single highest-leverage change in the product.

---

### Win 2 — Kill box-shadow, add warmth (1 hour)

**Find-replace in CSS:**

```css
/* DELETE every instance of: */
box-shadow: var(--shadow);
box-shadow: var(--shadow-tight);
box-shadow: 0 24px 70px ...;
box-shadow: 0 10px 28px ...;

/* REPLACE with: */
border: 1px solid var(--border);
```

**Set root background:**

```css
:root {
  --bg: #F7F5F2;
  --border: #E5E1DB;
}

body, .app-shell {
  background: var(--bg);
}
```

**Effect:** Removes the "landing page widget" feeling. All panels look coplanar with deliberate separation — not floating. The warm off-white immediately distinguishes from generic SaaS gray.

---

### Win 3 — Status dots replace pill badges (2 hours)

**Delete:**

```css
.status-badge, .handoff-badge, .complete-pill, .missing-pill {
  /* all of it */
}
```

**Replace inline in ConversationListItem:**

```tsx
// Before
<span className="status">needs_human</span>

// After
<StatusDot status={thread.status} />
```

```tsx
// StatusDot.tsx
const STATUS_COLORS = {
  needs_human: '#B85C38',
  active:      '#2D7A4F',
  complete:    '#A8A39E',
} as const;

export function StatusDot({ status }: { status: keyof typeof STATUS_COLORS }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: STATUS_COLORS[status] ?? '#A8A39E',
        flexShrink: 0,
      }}
      aria-label={status.replace(/_/g, ' ')}
    />
  );
}
```

**Effect:** Removes every colored pill, every underscore-named status string, and every badge container from visible UI in one pass.

---

## 7. IMPLEMENTATION ORDER

### Week 1 — Foundation (no new features, pure quality)

1. **Day 1:** Typography swap (Win 1). Lora in message bodies, mono timestamps. Commit, deploy, screenshot.
2. **Day 2:** Color system + shadow removal (Win 2). Add CSS custom properties, set `--bg: #F7F5F2`, kill all `box-shadow`, replace with `border`. Commit.
3. **Day 3:** StatusDot component (Win 3). Delete all badge classes. Replace inline. Commit.
4. **Day 4:** Extract `useInboxState.ts` and `useInboxData.ts`. AgentInboxClient drops from 1709 to ~1400 lines. No visual change. Commit.
5. **Day 5:** Extract `PropertyTable.tsx` + all property util functions. AgentInboxClient drops to ~1000 lines. No visual change. Commit.

### Week 2 — Layout restructure

6. Extract `EmptyState.tsx`. Replace all `<div className="empty-icon">0</div>` with per-channel SVG icons.
7. Extract `ConversationList.tsx`. Implement `J/K` keyboard navigation via `useKeyboardNav.ts`.
8. Extract `Sidebar.tsx`. Move channel-strip out of `<main>`. Sidebar gets channel list with unread counts and agent section. Channel-strip in main is deleted.
9. Replace topbar sync-status divs with `SyncIndicator` (pulsing dot + tooltip).
10. Merge `LeadDetail` and `ContextRail` into single `ContextRail.tsx`.

### Week 3 — Interaction layer

11. `CommandPalette.tsx` with `⌘K`. Channel switching: `G then E/S/W/V/C/P`. Thread actions: `E` resolve, `R` reply.
12. Collapse sidebar to 48px icon rail at `<1100px`. Stack workspace columns at `<768px`.
13. Inline property context drawer (replaces ContextRail modal pattern). Pressing breadcrumb opens drawer that pushes thread pane, not overlay.
14. `E` to resolve flows into optimistic list removal with 3-second undo toast (Superhuman pattern, verbatim).
15. Handoff count in sidebar turns `var(--accent)` + subtle pulsing when > 0. No modal, no banner — the sidebar number is the alert.
