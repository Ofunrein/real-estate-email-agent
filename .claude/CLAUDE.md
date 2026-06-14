# Agent Inbox — Project Context

## Project
Real estate AI agent inbox. Multi-channel: email (Iris), SMS/WhatsApp (Theo), voice (Aria), website (Olivia).
Stack: Next.js 16, React 19, TypeScript 5.7, custom CSS, no Tailwind.

## Backend contract (NEVER BREAK)
- `SheetRow` field names — any rename in `sheet_schema.py` must match `lib/sheetSchema.ts`
- `channel` values: `"email"`, `"sms"`, `"rcs"`, `"whatsapp"`, `"voice"`, `"web"`, `"website"`, `"website_chat"`
- `direction` values: `"inbound"` / `"outbound"` (case-sensitive)
- `/api/data` response shape — all top-level keys must be present

## UI Overhaul Active
Direction: "Brokerage Terminal" — Superhuman × Bloomberg. Warm off-white `#F7F5F2`, dark sidebar `#0F1210`, clay accent `#B85C38`.
Plan: `docs/superpowers/plans/2026-06-13-agent-inbox-ui-overhaul.md`
Design brief: `docs/design/DESIGN_BRIEF.md`
Codebase onboarding: `docs/CODEBASE_ONBOARDING.md`

## Anti-slop rules (enforced)
1. No avatar grid navigation
2. No colored status pill badges — StatusDot (6px) only
3. No metric card grid — sidebar metrics only
4. No `0` as empty state icon — SVG icons
5. No data-dump topbar — channel name + sync dot only

## CSS tokens
All in `app/globals.css` `:root` block. Use `var(--*)` only. No hardcoded hex in TSX.

## Dev
```bash
npm run dev    # http://localhost:3000
npm run build  # type check + build
```
