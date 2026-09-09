# Responsive QA — Static Analysis Pass

**Date:** 2026-05-25
**Method:** Static code analysis (no browser). Tailwind class audit across all `components/` files.
**Status:** PASS — no violations found.

---

## Audit Method

All component files inspected by reading source. Key checks:

1. Section wrappers use `mx-auto w-[min(1200px,calc(100%-32px))]` (or `1400px` variant for wider sections)
2. All multi-column grid layouts have `grid` with mobile-default (CSS default is `grid-cols-1`) and explicit `md:grid-cols-N` or `sm:grid-cols-N` upgrades
3. Flex layouts use `flex-col` mobile default with `md:flex-row` where horizontal expected
4. No bare fixed pixel widths > viewport that could cause mobile overflow
5. `text-display-*` clamp() tokens used for all display headings
6. Hero mid-right callout positioned to avoid overflow at 360px

---

## Files Inspected

**Section components:**
- `components/sections/hero.tsx`
- `components/sections/topbar.tsx`
- `components/sections/trust-strip.tsx`
- `components/sections/founder-vsl.tsx`
- `components/sections/problem-agitation.tsx`
- `components/sections/meet-the-team.tsx`
- `components/sections/aria-deep-dive.tsx`
- `components/sections/timeline-30day.tsx`
- `components/sections/two-ways-in.tsx`
- `components/sections/case-study-wall.tsx`
- `components/sections/calendar-cta.tsx`
- `components/sections/faq.tsx`
- `components/sections/pull-quote.tsx`
- `components/sections/final-cta.tsx`
- `components/sections/footer.tsx`
- `components/sections/sticky-cta-bar.tsx`

**Utility components:**
- `components/agent-persona-card.tsx`
- `components/glass-stat-callout.tsx`
- `components/phone-mockup.tsx`
- `components/rotating-text.tsx`
- `components/fillout-embed.tsx`
- `components/ghl-calendar.tsx`

---

## Findings

### Section wrappers

All sections use the canonical wrapper pattern:

```
mx-auto w-[min(1200px,calc(100%-32px))]
```

At 360px: `100% - 32px = 328px` usable width. No horizontal scroll.

Exceptions (correct per design-tokens.md):
- `trust-strip.tsx` and `final-cta.tsx` use `w-[min(1200px,calc(100%-32px))]` — within spec.
- `pull-quote.tsx` uses `w-[min(900px,calc(100%-32px))]` — narrower for centered pull quote, correct.

### Grid layouts (mobile-first)

| Component | Grid class | Mobile default | Desktop upgrade | Status |
|-----------|-----------|---------------|-----------------|--------|
| hero | `grid grid-cols-1 md:grid-cols-[1.05fr_0.95fr]` | 1-col | md 2-col | PASS |
| founder-vsl | `grid items-center gap-10 md:grid-cols-[0.85fr_1.15fr]` | 1-col | md 2-col | PASS |
| problem-agitation | `grid gap-4 md:grid-cols-3` | 1-col | md 3-col | PASS |
| meet-the-team | `grid gap-5 md:grid-cols-2 lg:grid-cols-4` | 1-col | md 2-col, lg 4-col | PASS |
| aria-deep-dive | `grid items-center gap-12 md:grid-cols-[1fr_1fr]` | 1-col | md 2-col | PASS |
| aria feature tiles | `grid gap-4 sm:grid-cols-2` | 1-col | sm 2-col | PASS |
| timeline-30day | `grid gap-6 md:grid-cols-4` | 1-col | md 4-col | PASS |
| two-ways-in | `grid gap-5 md:grid-cols-2` | 1-col | md 2-col | PASS |
| case-study-wall | `grid gap-4 sm:grid-cols-2 md:grid-cols-3` | 1-col | sm 2-col, md 3-col | PASS |
| calendar-cta | `grid items-start gap-10 md:grid-cols-[0.85fr_1.15fr]` | 1-col | md 2-col | PASS |
| faq | `grid gap-10 md:grid-cols-[0.6fr_1fr]` | 1-col | md 2-col | PASS |
| footer | `flex flex-col gap-4 md:flex-row` | col | md row | PASS |

Note: `grid` without an explicit `grid-cols-N` class defaults to `grid-cols-1` in CSS. All multi-col grids add the column count only at `md:` or `sm:` breakpoints — correct mobile-first pattern.

### Flex layouts

- `topbar.tsx`: `flex items-center justify-between` (horizontal always) — correct, topbar is always horizontal; nav links are `hidden md:flex`.
- `trust-strip.tsx`: `flex flex-wrap items-center` — flex-wrap prevents overflow on narrow viewports.
- `footer.tsx`: `flex flex-col md:flex-row` — correct mobile-first.
- `sticky-cta-bar.tsx`: `flex items-center justify-between` — constrained by `max-w-3xl` and `inset-x-3`; fine.

### Typography

All display headings use clamp() tokens:
- `text-[length:var(--text-display-hero)]` → `clamp(2.5rem, 7vw, 5.5rem)`
- `text-[length:var(--text-display-section)]` → `clamp(2rem, 4.5vw, 3.5rem)`

### Hero mid-right callout

`GlassStatCallout` with `className="absolute top-1/2 -right-4 hidden -translate-y-1/2 md:block md:-right-8"` — hidden on mobile via `hidden`, visible only `md:block`. No overflow at 360px.

### Reduced-motion

- `app/globals.css`: `@media (prefers-reduced-motion: reduce)` block present — zeros all `animation` and `transition` durations globally.
- `components/rotating-text.tsx`: `useReducedMotion()` from framer-motion, disables interval and sets `transition={{ duration: 0 }}` when reduced.
- No other Framer Motion animated components exist in the codebase.

---

## Violations Found

**None.** All sections pass mobile-first audit.

---

## Known Limitations

- Real-browser smoke test at 360px, 768px, 1280px viewports still required by Martin before launch (T34).
- No viewport emulation performed — overflow behavior at exact breakpoint boundaries not empirically verified.
- `overflow-x-hidden` on `<body>` in `globals.css` will mask any edge-case overflow; a real scroll-width check via browser DevTools is required.
