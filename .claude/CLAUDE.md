# Agent Inbox — Project Context

## Project
Real estate AI agent inbox. Multi-channel: email (Iris), SMS/WhatsApp (Theo), voice (Aria), website (Olivia).
Stack: Next.js 16, React 19, TypeScript 5.7, custom CSS, no Tailwind.

## Backend contract (NEVER BREAK)
- `SheetRow` field names — any rename in `sheet_schema.py` must match `lib/sheetSchema.ts`
- `channel` values: `"email"`, `"sms"`, `"rcs"`, `"whatsapp"`, `"voice"`, `"web"`, `"website"`, `"website_chat"`
- `direction` values: `"inbound"` / `"outbound"` (case-sensitive)
- `/api/data` response shape — all top-level keys must be present

## UI Design System — Stacked (current)
Theme: **Stacked** (`stacked.so`) — light + dark mode, purple/violet accent.
Tokens: `--s-*` vars in `app/globals.css`. Use `var(--s-*)` for all new UI. No hardcoded hex.
Dark mode: toggled via "Dark mode" button in sidebar footer → adds `.dark` class to `<html>` + `.app-shell`.

Key tokens:
- `--s-bg` page bg, `--s-card` card surface, `--s-card-border` borders
- `--s-accent` #7C6AF5 (purple), `--s-accent-soft` subtle accent bg
- `--s-text-1/2/3` text hierarchy, `--s-label` uppercase section labels
- `--s-success` green, `--s-warn` amber, `--s-danger` red

Sidebar: dot-grid texture (CSS `::before`), icon + label nav items, active = purple bg + purple text.

Previous "Brokerage Terminal" tokens (`--bg`, `--accent #B85C38` clay, etc.) still in file but overridden by `--s-*` rules. Do not add new rules using old tokens.

## Anti-slop rules (still enforced)
1. No avatar grid navigation
2. StatusDot (6px) only — no colored text badges
3. Metrics in sidebar only — no card grid
4. SVG empty states — no `0` as icon
5. Topbar: channel name + sync dot only

## Key components
- `components/inbox/Sidebar.tsx` — nav, logo, dark toggle, dot-grid texture
- `components/inbox/charts/ActivityChart.tsx` — 14-day SVG area chart
- `components/inbox/charts/ChannelMix.tsx` — horizontal bar chart
- `components/inbox/PropertyTable.tsx` — property table + photo display
- `components/inbox/StatusDot.tsx` — 6px status dot

## Dev
```bash
npm run dev    # http://localhost:3000
npm run build  # type check + build
```
