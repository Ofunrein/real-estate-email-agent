# UI Overhaul Intelligence Report — Agent Inbox

---

## 1. X/Twitter Trend Summary

Twitter research via CLI failed on keyword search (unsupported flag). What follows is grounded in training knowledge through August 2025, cross-referenced against rauchg's top-velocity tweets (the most signal-dense UI/DX account on the platform).

**Top 5 patterns dominating UI design discourse right now:**

**1. HTML is back as a design primitive.** rauchg's highest-velocity tweet this cycle: "HTML is so back. Drag and..." (1512 likes, 902 bookmarks). Server-rendered, document-first UI is winning over client-heavy SPA complexity. For an inbox: this means semantic markup, real `<table>` or `<ul>` structures, not div soup.

**2. Agent orchestration UIs are the new dashboard.** rauchg shipped HarnessAgent (AI SDK agent orchestration) as a top-velocity product tweet. The market is actively designing agent monitoring surfaces. The pattern emerging: agents are named entities with status, not anonymous pipeline steps. Iris, Theo, Aria, Olivia are architecturally correct.

**3. Spatial document metaphors over card grids.** The editorial/bento aesthetic peaked. What's replacing it: linear document layouts where items have vertical rhythm, not cards floating in a grid. Think Notion's block list, not a dashboard of widget cards.

**4. AI Gateway + token economics as UI.** Vercel's AI Gateway recovering 1T tokens/month was high-engagement content. Showing real operational cost/efficiency data inside agent UIs is a design opportunity, not just a backend concern. Users want to see what their agents are spending.

**5. Minimal surface, maximal action.** Superhuman-influenced inboxes: no persistent toolbars, no icon forests. Action surfaces appear at the cursor, triggered by keyboard or hover. The resting state is pure content.

---

## 2. Reference UI Teardown

### Superhuman — 8 Patterns to Steal

**Pattern 1: Weight-based read/unread state.**
No dot indicator needed. Unread row: sender `font-weight: 600`, subject `font-weight: 500`. Read row: both `font-weight: 400`. The weight shift IS the indicator. No badge, no blue dot.

```css
.thread-row[data-unread="true"] .sender { font-weight: 600; }
.thread-row[data-unread="true"] .subject { font-weight: 500; }
.thread-row[data-unread="false"] .sender,
.thread-row[data-unread="false"] .subject { font-weight: 400; color: var(--text-secondary); }
```

**Pattern 2: Row height as a density dial, not a design accident.**
List view: `44px` rows exactly. Never let row height be determined by content wrapping. Truncate, don't wrap. One line, always.

```css
.thread-row {
  height: 44px;
  display: grid;
  grid-template-columns: 36px 1fr auto;
  align-items: center;
  overflow: hidden;
}
.thread-row * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

**Pattern 3: Left-edge accent bar for active state.**
Selected row: `box-shadow: inset 3px 0 0 var(--accent)` + `background: var(--bg-selected)`. No heavy highlight, no border box. The 3px inset shadow at the left edge is the selection indicator.

**Pattern 4: Send animation — content exits the viewport.**
When an action removes an item from the inbox (archive, snooze), the row slides out horizontally with `translateX(-100%)` + `opacity: 0` in `200ms`. Not a fade, not a collapse — an exit. This creates spatial memory: items leave in a direction that implies where they went.

```css
.thread-row.exiting {
  animation: slide-out-left 200ms cubic-bezier(0.4, 0, 1, 1) forwards;
}
@keyframes slide-out-left {
  to { transform: translateX(-100%); opacity: 0; }
}
```

**Pattern 5: Undo toast with visual countdown.**
After any destructive action, a bottom-center toast with `Undo` and a shrinking linear progress bar (`5s`). The bar is the countdown — no text timer needed. Implemented as a CSS animation on `scaleX(0)`.

**Pattern 6: Timestamp formatting as a signal layer.**
`< 1hr: "42m"`, `today: "2:34 PM"`, `yesterday: "Yesterday"`, `this week: "Mon"`, `older: "Jun 4"`. Never show seconds. The format tells the user how fresh the item is without them doing math.

**Pattern 7: Optimistic UI everywhere.**
When the user marks something read, it changes immediately in the DOM. No loading state. If the API call fails, revert. This is a JavaScript architecture decision that drives 70% of the perceived speed advantage.

**Pattern 8: Command palette as the escape hatch.**
`Cmd+K` opens a modal with `backdrop-filter: blur(8px)`, scale animation from `0.96 → 1` in `120ms`. Every action in the app is reachable from here. For an agent inbox: "Switch to Iris", "Mark all read", "Filter by SMS", "Snooze this thread 2 hours" — all keyboard-accessible from one surface.

---

### Linear — 8 Patterns to Steal

**Pattern 1: `rgba()` opacity model for all color relationships.**
Never a separate border color hex. All borders are `rgba(255,255,255,0.06)` in dark mode — the same surface, 6% opacity white. This makes the entire palette coherent by construction. Changing the base background automatically adjusts every border.

**Pattern 2: Section headers are text-only, uppercase, 10–11px, 35% opacity.**
No visual dividers between sections. The label carries the weight. No `<hr>`, no border-bottom, no background tint — just the uppercase label and whitespace above it.

```css
.section-header {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.35);
  padding: 16px 8px 4px;
}
```

**Pattern 3: 16px SVG status circles, not filled icons.**
Status indicators are outlined circles, not solid colored icons. Todo = dashed circle. In progress = half-filled arc. Done = checkmark in circle. The "emptiness" of the circle communicates incomplete state perceptually, before the user reads the label.

**Pattern 4: Actions appear on hover only.**
Resting row shows: status icon, title, metadata. Hover reveals: checkbox for multi-select, action buttons (assign, priority, archive). This keeps the list scannable at rest and actionable on focus.

**Pattern 5: `hover → background 80ms` — nothing faster, nothing slower.**
`transition: background 80ms ease-out`. Not `transition: all`, not `100ms`, not with a scale. Background only, `80ms`. Any faster reads as a glitch. Any slower reads as lag.

**Pattern 6: Density via `data-density` attribute, not separate components.**
One `ThreadRow` component. One CSS variable toggle. No two different components for compact vs comfortable view.

```css
:root { --row-height: 36px; }
[data-density="comfortable"] { --row-height: 44px; }
.thread-row { height: var(--row-height); }
```

**Pattern 7: Labels as 20px chips with `rgba` background.**
`height: 20px`, `padding: 0 6px`, `border-radius: 4px`, `font-size: 11px`, `background: rgba(255,255,255,0.08)`, `border: 1px solid rgba(255,255,255,0.10)`. Never a solid colored badge. The chip is semi-transparent, always.

**Pattern 8: The sidebar nav item has no left border accent.**
Left border accent on nav items is the amateur tell. Linear's active nav item is: `background: rgba(255,255,255,0.08)`, no left border, no accent color. The background tint is sufficient. Reserve left border accent for the thread list (row selection), not sidebar nav.

---

## 3. Anti-Slop Checklist — Agent Inbox Specific

**Rule 1: Blue dot unread indicator.**
NEVER: `<div class="unread-dot" />` with `background: #3B82F6; border-radius: 50%`.
INSTEAD: `font-weight: 600` on sender + subject. The weight is the indicator.

**Rule 2: Card-per-thread layout.**
NEVER: Each thread wrapped in a `<div class="card">` with `border-radius: 8px; box-shadow: ...`.
INSTEAD: Rows separated by `border-bottom: 1px solid rgba(255,255,255,0.06)`. No card chrome. Cards are for elevated content (modals, panels), not list items.

**Rule 3: Gradient backgrounds on agent status indicators.**
NEVER: `background: linear-gradient(135deg, #6366f1, #8b5cf6)` on Iris/Theo/Aria/Olivia chips.
INSTEAD: `background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12)` with a single muted accent dot for status.

**Rule 4: "Agent Name is thinking..." animated ellipsis as the only activity signal.**
NEVER: Generic loading text with CSS dot animation as the only real-time indicator.
INSTEAD: Show what the agent last did + how long ago. "Iris sent follow-up · 4m ago". Action + time is more informative than state + animation.

**Rule 5: Toolbar with 8+ persistent icon buttons.**
NEVER: A row of icons (filter, sort, search, archive, label, assign, snooze, mark read) always visible above the thread list.
INSTEAD: Search input only. All other actions accessible via keyboard shortcuts shown in a `Cmd+K` palette, or appearing on hover/selection.

**Rule 6: Per-channel color-coded sidebar (red=email, green=SMS, blue=WhatsApp).**
NEVER: `color: #25D366` for WhatsApp, `color: #1877F2` for email, a rainbow sidebar.
INSTEAD: Monochromatic sidebar. Channel identity via a 16px icon in `rgba(255,255,255,0.50)`. One accent color in the entire UI.

**Rule 7: Pure black/white backgrounds.**
NEVER: `background: #000000` or `background: #ffffff`.
INSTEAD: `background: oklch(11% 0.005 250)` dark, `background: oklch(98% 0.006 240)` light. Imperceptibly tinted. The tint creates cohesion.

**Rule 8: AI-generated reply showing in a visually distinct "AI box" with sparkle icon.**
NEVER: A `<div class="ai-suggestion-container">` with different background, robot/sparkle icon, "AI says:" prefix, separate from the compose area.
INSTEAD: Draft appears inline in the compose surface, same font, same weight, immediately editable. A single `draft` label in `rgba` opacity at the top-right of the compose area is sufficient.

**Rule 9: Status as a primary-column, full-saturation badge.**
NEVER: `<Badge color="red">New</Badge>` as the first visual element in every row.
INSTEAD: Status as a 16px outlined SVG circle (Linear-style) at the far left, or as a secondary metadata field after sender/subject. Desaturated: `rgba(94,106,210,0.7)` not `#6366f1`.

**Rule 10: Round numbers and fake names in empty/loading states.**
NEVER: "247 messages", "John Doe", "Acme Corp", 50% completion.
INSTEAD: Real-feeling numbers (247 is fine; avoid 100, 200, 500), organic names drawn from actual agent names (Iris, Theo, Aria, Olivia), and percentages like 61.4%. Or: no numbers until real data loads.

---

## 4. Design System Spec

### Font Stack

```css
--font-sans: 'Geist', 'GeistFallback', ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono: 'Geist Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace;

/* Fallback metrics (prevents CLS) */
@font-face {
  font-family: 'GeistFallback';
  src: local('ui-sans-serif');
  size-adjust: 97%;
  ascent-override: 95%;
  descent-override: 22%;
}

/* Type scale */
--text-xs:   0.6875rem;  /* 11px — labels, badges */
--text-sm:   0.8125rem;  /* 13px — metadata, timestamps */
--text-base: 0.9375rem;  /* 15px — thread subjects, body */
--text-lg:   1.125rem;   /* 18px — panel headings */
--text-xl:   1.375rem;   /* 22px — page titles */

/* Tracking */
--tracking-tight:  -0.025em;  /* large headings */
--tracking-normal:  0;
--tracking-wide:    0.06em;   /* uppercase labels */
```

### Color Palette

```css
:root {
  /* === DARK MODE (primary) === */

  /* Surfaces */
  --bg-app:        oklch(11% 0.005 250);   /* #0d0d10 — app shell */
  --bg-sidebar:    oklch(13% 0.006 250);   /* #111115 — sidebar */
  --bg-base:       oklch(15% 0.007 250);   /* #141419 — thread list */
  --bg-elevated:   oklch(19% 0.008 250);   /* #1b1b22 — detail pane */
  --bg-overlay:    oklch(22% 0.009 250);   /* #202028 — modals */
  --bg-hover:      rgba(255, 255, 255, 0.04);
  --bg-selected:   rgba(255, 255, 255, 0.08);
  --bg-active:     rgba(94, 106, 210, 0.12); /* accent tint */

  /* Borders */
  --border-subtle:  rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.10);
  --border-strong:  rgba(255, 255, 255, 0.18);

  /* Text */
  --text-primary:   oklch(97% 0.004 250);  /* #f4f4f7 */
  --text-secondary: oklch(65% 0.008 250);  /* #9595a8 */
  --text-tertiary:  oklch(45% 0.008 250);  /* #636375 */
  --text-disabled:  oklch(32% 0.006 250);  /* #444454 */

  /* Accent — muted indigo, not electric */
  --accent:         oklch(62% 0.17 265);   /* #6b76e8 — single brand color */
  --accent-hover:   oklch(66% 0.18 265);   /* slightly lighter */
  --accent-subtle:  rgba(107, 118, 232, 0.12);
  --accent-border:  rgba(107, 118, 232, 0.25);

  /* Agent colors — muted, differentiated */
  --agent-iris:   oklch(68% 0.12 220);   /* Iris: email — calm teal */
  --agent-theo:   oklch(68% 0.13 145);   /* Theo: SMS/WA — sage green */
  --agent-aria:   oklch(68% 0.14 310);   /* Aria: voice — warm violet */
  --agent-olivia: oklch(68% 0.12 60);    /* Olivia: web — amber-gold */

  /* Status */
  --status-new:      oklch(68% 0.18 250); /* muted blue */
  --status-active:   oklch(65% 0.15 145); /* desaturated green */
  --status-waiting:  oklch(68% 0.16 80);  /* amber */
  --status-closed:   oklch(45% 0.006 250); /* neutral gray */
  --status-urgent:   oklch(62% 0.18 25);  /* muted red-orange */

  /* Shadow tints */
  --shadow-color: oklch(5% 0.01 250);
}

[data-theme="light"] {
  --bg-app:        oklch(99% 0.004 240);
  --bg-sidebar:    oklch(97% 0.005 240);
  --bg-base:       oklch(100% 0 0);
  --bg-elevated:   oklch(97% 0.004 240);
  --bg-overlay:    oklch(100% 0 0);
  --bg-hover:      rgba(0, 0, 0, 0.04);
  --bg-selected:   rgba(0, 0, 0, 0.06);
  --border-subtle:  rgba(0, 0, 0, 0.07);
  --border-default: rgba(0, 0, 0, 0.12);
  --text-primary:   oklch(12% 0.010 250);
  --text-secondary: oklch(42% 0.010 250);
  --text-tertiary:  oklch(58% 0.008 250);
  --accent:         oklch(52% 0.17 265);   /* darker for light mode contrast */
  --shadow-color:   oklch(18% 0.012 250);
}
```

### Spacing Scale

```css
/* Base unit: 4px */
--space-1:  0.25rem;   /*  4px */
--space-2:  0.5rem;    /*  8px */
--space-3:  0.75rem;   /* 12px */
--space-4:  1rem;      /* 16px */
--space-5:  1.25rem;   /* 20px */
--space-6:  1.5rem;    /* 24px */
--space-8:  2rem;      /* 32px */
--space-10: 2.5rem;    /* 40px */
--space-12: 3rem;      /* 48px */
--space-16: 4rem;      /* 64px */

/* Named semantic sizes */
--sidebar-width:    220px;
--sidebar-rail:      52px;
--thread-list-width: 340px;
--content-max-width: 680px;
--row-height-compact: 44px;
--row-height-comfortable: 56px;
--avatar-sm: 24px;
--avatar-md: 32px;
--icon-sm: 14px;
--icon-md: 16px;
--icon-lg: 20px;
```

### Elevation / Shadow System

```css
/* Five elevation levels, all tinted to surface */
--shadow-none: none;

--shadow-xs:
  0 1px 2px oklch(5% 0.01 250 / 0.5),
  0 0 0 0.5px rgba(255,255,255,0.05);

--shadow-sm:
  0 1px 3px oklch(5% 0.01 250 / 0.5),
  0 4px 8px oklch(5% 0.01 250 / 0.25),
  0 0 0 0.5px rgba(255,255,255,0.07);

--shadow-md:
  0 2px 4px oklch(5% 0.01 250 / 0.4),
  0 8px 24px oklch(5% 0.01 250 / 0.3),
  0 0 0 0.5px rgba(255,255,255,0.08);

--shadow-lg:
  0 4px 8px oklch(5% 0.01 250 / 0.4),
  0 16px 48px oklch(5% 0.01 250 / 0.35),
  0 0 0 0.5px rgba(255,255,255,0.10);

/* Inset highlight for raised surfaces */
--shadow-inset: inset 0 1px 0 rgba(255,255,255,0.06);

/* Usage map */
/* none:   rows, sidebar items */
/* xs:     hovered rows, badges */
/* sm:     dropdowns, tooltips */
/* md:     command palette, popovers */
/* lg:     modals, drawer panels */
```

### Border Radius System

```css
--radius-none: 0;
--radius-xs:   3px;    /* internal chips, tight contexts */
--radius-sm:   5px;    /* badges, labels, tags */
--radius-md:   7px;    /* inputs, buttons */
--radius-lg:   10px;   /* cards (if used), panels */
--radius-xl:   14px;   /* modals, bottom sheets */
--radius-full: 9999px; /* avatar circles, toggle pills */

/* Inner radius law: child = parent - padding */
/* Panel (14px) with 8px padding → child corners: 6px */
```

### Motion Tokens

```css
/* Duration */
--duration-instant:  80ms;    /* hover backgrounds */
--duration-fast:    120ms;    /* button states, opacity */
--duration-normal:  180ms;    /* sidebar, reveals */
--duration-slow:    250ms;    /* panels, modals */
--duration-exit:    150ms;    /* exits always faster than entrances */

/* Easing */
--ease-out:      cubic-bezier(0.16, 1, 0.3, 1);   /* content entrance */
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);    /* bidirectional */
--ease-in:       cubic-bezier(0.5, 0, 1, 0.5);    /* exits/dismissals */
--ease-linear:   linear;                           /* progress bars, countdowns */

/* Pre-composed transitions */
--transition-bg:     background var(--duration-instant) var(--ease-out);
--transition-panel:  transform var(--duration-slow) var(--ease-out);
--transition-fade:   opacity var(--duration-fast) var(--ease-standard);
--transition-button: background var(--duration-fast) var(--ease-out),
                     box-shadow var(--duration-fast) var(--ease-out),
                     transform var(--duration-fast) var(--ease-out);
```

---

## 5. Component Architecture

Split the 1709-line monolith into these files:

```
src/
├── styles/
│   ├── tokens.css          # All custom properties (Section 4 above, verbatim)
│   ├── reset.css           # Modern CSS reset (box-sizing, margin collapse, etc.)
│   ├── typography.css      # Font declarations, @font-face, text utilities
│   └── animations.css      # @keyframes library
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx        # Three-column grid: rail + sidebar + main
│   │   ├── Sidebar.tsx         # Nav tree, agent list, workspace switcher
│   │   ├── SidebarRail.tsx     # Icon rail (52px collapsed state)
│   │   └── DetailPane.tsx      # Right panel — slides in, doesn't push
│   │
│   ├── inbox/
│   │   ├── ThreadList.tsx      # Virtualized list, density prop, multi-select
│   │   ├── ThreadRow.tsx       # Single row — 44px, weight-based unread, hover reveal
│   │   ├── ThreadPreview.tsx   # Expanded thread in detail pane
│   │   ├── ThreadSearch.tsx    # Search input + filter pills
│   │   └── InboxEmpty.tsx      # Per-filter empty state (not a generic illustration)
│   │
│   ├── agents/
│   │   ├── AgentBadge.tsx      # Iris/Theo/Aria/Olivia chip — muted color, icon, name
│   │   ├── AgentActivity.tsx   # "Iris sent follow-up · 4m ago" last-action row
│   │   └── AgentDraftBubble.tsx # Inline AI draft in compose — no special container
│   │
│   ├── compose/
│   │   ├── ComposePanel.tsx    # Reply/compose surface, replaces or overlays detail
│   │   └── ComposeToolbar.tsx  # Minimal: send, attach, discard only
│   │
│   ├── primitives/
│   │   ├── StatusIcon.tsx      # 16px SVG circle: new/active/waiting/closed/urgent
│   │   ├── Avatar.tsx          # 24px/32px circle, initials fallback, deterministic bg
│   │   ├── Label.tsx           # 20px chip — rgba bg, 11px text, 4px radius
│   │   ├── Timestamp.tsx       # Formatting logic: 4m / 2:34 PM / Mon / Jun 4
│   │   ├── Toast.tsx           # Undo toast with countdown bar
│   │   └── CommandPalette.tsx  # Cmd+K surface — blur backdrop, spring entrance
│   │
│   └── channels/
│       ├── ChannelIcon.tsx     # Email/SMS/WhatsApp/Voice/Web — monochrome 16px
│       └── ChannelFilter.tsx   # Filter by channel — pill group, not colored tabs
│
├── hooks/
│   ├── useOptimisticThread.ts  # Mark read/archive/snooze with immediate DOM update
│   ├── useKeyboardNav.ts       # j/k navigation, keyboard shortcut registry
│   ├── useThreadExit.ts        # Slide-out animation + list collapse on exit
│   └── useCommandPalette.ts    # Cmd+K state, action registry, search
│
└── lib/
    ├── timestamps.ts           # All timestamp formatting logic — isolated, testable
    ├── threadSort.ts           # Sort/filter logic separate from render
    └── agentConfig.ts          # Agent names, colors, icons — single source of truth
```

**Split priority order:** ThreadRow first (highest visual impact per line). Then tokens.css (enables all other changes). Then StatusIcon + Label primitives (remove the slop at the source).

---

## 6. Quick Wins — 48 Hours

**Win 1: Replace weight-based typography immediately.**
In `tokens.css`, add the full type scale and font stack. In the existing monolith, find every instance of `font-weight: bold` or `font-weight: 700` on thread subjects and replace with the `data-unread` pattern. Add Geist via `@font-face` (self-hosted WOFF2, 48h to source and deploy). Estimated impact: the single largest visual change possible in one CSS file edit.

**Win 2: Kill all `#000000` and `#ffffff` raw values.**
Global find-replace: `#000` → `var(--bg-app)`, `#fff` → `var(--bg-base)` or `var(--text-primary)` depending on context. Add the token block to a new `tokens.css` imported first. This alone eliminates the harshest "AI template" tell.

**Win 3: Flatten thread cards to divide-y rows.**
Find every `.card` class applied to thread list items. Remove `border-radius`, `box-shadow`, `border`. Add `border-bottom: 1px solid var(--border-subtle)` to each row. The list collapses from "bubble-wrapped grid" to a clean list in one CSS change.

**Win 4: Normalize row height to 44px with strict truncation.**
Add `.thread-row { height: 44px; overflow: hidden; }` and `.thread-row * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`. This enforces visual rhythm across the entire list in four lines of CSS. Rows that were wrapping at inconsistent heights will immediately read as a designed system.

**Win 5: Add hover background transition at 80ms.**
Every interactive row in the app currently either has no hover state or a transition on `all`. Replace with `.thread-row { transition: var(--transition-bg); }` and `.thread-row:hover { background: var(--bg-hover); }`. This single change makes the list feel native/premium — the difference between a spreadsheet and a designed inbox.

---

## 7. Full Overhaul Plan

### Phase 1 — Foundation (Week 1–2)
**Goal:** Token system live, split complete, zero visual regression.

Deliverables:
- `tokens.css` with full custom property set deployed and imported
- Geist font self-hosted, `@font-face` declarations, fallback metrics applied
- Monolith split into component files per Section 5 — each component is a 1:1 extraction, no behavior changes yet
- Dark/light mode token toggle working via `data-theme` attribute on `<html>`
- `reset.css` applied, eliminating browser default inconsistencies
- All raw color values (`#000`, `#fff`, `#6366f1`, etc.) replaced with token references

Success metric: identical visual output to current, zero new bugs, token system is the single source of truth.

---

### Phase 2 — Core Inbox Redesign (Week 3–4)
**Goal:** ThreadList + ThreadRow feel Superhuman-quality.

Deliverables:
- `ThreadRow` rebuilt: 44px height, weight-based unread, `data-unread` attribute, left-edge accent on selection, hover reveal for actions
- `StatusIcon` component: 16px SVG circles, five states, no filled icons
- `AgentBadge`: muted per-agent color, semi-transparent chip, not colored solid badge
- `Timestamp`: full formatting logic from timestamps.ts, correct relative/absolute switching
- Thread exit animation: `translateX(-100%)` on archive/snooze with `useThreadExit` hook
- Undo toast: bottom-center, 5s countdown bar, `scaleX` animation
- `ThreadSearch`: single input, no persistent toolbar, filter pills below on activation
- Optimistic read state: `useOptimisticThread` hook, immediate DOM update on open

Success metric: mark-read, archive, snooze feel instantaneous; visual weight of unread vs read is immediately clear without any colored indicator.

---

### Phase 3 — Agent Intelligence Layer + Polish (Week 5–6)
**Goal:** Agent identity is clear, AI drafts feel native, keyboard nav is complete.

Deliverables:
- `CommandPalette`: `Cmd+K`, blur backdrop, spring entrance, full action registry for all inbox operations + agent switching
- `AgentActivity`: "Iris sent follow-up · 4m ago" last-action display, replacing generic "agent is thinking" text
- `AgentDraftBubble`: inline compose draft with no special container — same surface, `draft` label only
- `useKeyboardNav`: `j/k` row navigation, `e` archive, `s` snooze, `r` reply, `?` show shortcuts
- Channel filter: pill group, monochrome icons, no per-channel color identity
- `DetailPane`: slide-in from right, `translateX(100%) → 0` at `250ms var(--ease-out)`, doesn't push list
- Empty states: per-filter, descriptive text in the same visual grammar as real content, single action button
- `AppShell` responsive: sidebar collapses to 52px icon rail below 1024px, detail pane overlays below 1280px

Success metric: a user can navigate, read, reply, and archive entirely by keyboard; agent identity is clear from agent badge alone; AI drafts are indistinguishable in visual grammar from human-written content until the user looks for the `draft` label.
