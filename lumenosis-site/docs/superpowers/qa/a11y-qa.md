# Accessibility QA — Static Analysis Pass

**Date:** 2026-05-25
**Method:** Static code analysis + design-tokens.md WCAG contrast audit (Task 5).
**Status:** PASS — one item added (skip-link), no violations found.

---

## Audit Method

Grepped all `components/` and `app/` files for:
- `alt=` on `<Image>` tags
- `aria-label`, `aria-hidden`, `aria-labelledby`, `aria-live`, `aria-atomic`
- `<button` and `<a ` elements without accessible text
- `focus-visible` ring on standalone interactive elements
- Heading hierarchy (`h1`, `h2`, `h3`)
- Gold-on-cream color usage (per locked WCAG audit in design-tokens.md)

---

## Files Inspected

All files under `components/sections/`, `components/`, and `app/layout.tsx`.

---

## Skip-link Added

**File:** `app/layout.tsx`

Inserted before `{children}` inside `<body>`:

```tsx
<a
  href="#top"
  className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--color-primary-indigo)] focus:px-3 focus:py-2 focus:text-white"
>
  Skip to content
</a>
```

Target: `<section id="top">` in `hero.tsx`. Keyboard users can tab once to reveal and activate the skip-link, bypassing the topbar nav.

---

## Image Alt Attributes

| Component | Image | Alt | Status |
|-----------|-------|-----|--------|
| `hero.tsx` | product-card-mockup.png | "Lumenosis AI dashboard showing a CRM conversation thread, iMessage reply, and a booked appointment confirmation" | PASS |
| `founder-vsl.tsx` | martin-vsl-poster.jpg | "Martin Ofunrein on Lumenosis AI strategy for real estate" | PASS |
| `agent-persona-card.tsx` | agent avatar | `${agent.name} avatar` (interpolated) | PASS |
| `trust-strip.tsx` | trust logos | `logo.alt` (from content data) | PASS |

---

## ARIA Attributes Audit

| Element | Location | ARIA | Status |
|---------|----------|------|--------|
| RotatingText span | `rotating-text.tsx` | `aria-live="polite"` `aria-atomic="true"` | PASS |
| Topbar logo `<Link>` | `topbar.tsx` | Visible text "Lumenosis AI" | PASS |
| Topbar `<nav>` | `topbar.tsx` | `aria-label="Page"` | PASS |
| Footer `<nav>` | `footer.tsx` | `aria-label="Footer"` | PASS |
| Trust strip `<section>` | `trust-strip.tsx` | `aria-label="Trust signals"` | PASS |
| VSL play `<button>` | `founder-vsl.tsx` | `aria-label="Play overview video"` | PASS |
| VSL play SVG | `founder-vsl.tsx` | `aria-hidden` | PASS |
| Sticky bar container | `sticky-cta-bar.tsx` | `role="complementary"` `aria-label="Book a strategy call"` `aria-hidden={!show}` | PASS |
| Sticky bar link | `sticky-cta-bar.tsx` | Visible text "Book →"; `tabIndex={-1}` when hidden | PASS |
| Decorative dots/spans | multiple | `aria-hidden` | PASS |
| Timeline connector `<li>` | `timeline-30day.tsx` | `aria-hidden` | PASS |
| Timeline dot spans | `timeline-30day.tsx` | `aria-hidden` | PASS |

---

## Heading Hierarchy

| Heading | Component | Level | Status |
|---------|-----------|-------|--------|
| "AI agents for your [niche] team." | `hero.tsx` | h1 | PASS |
| "Why most agents are losing…" | `founder-vsl.tsx` | h2 | PASS |
| "The expensive leaks are not ad spend." | `problem-agitation.tsx` | h2 | PASS |
| "Meet your new team." | `meet-the-team.tsx` | h2 | PASS |
| "The front desk that never sleeps…" | `aria-deep-dive.tsx` | h2 | PASS |
| "Thirty days to a fully running system." | `timeline-30day.tsx` | h2 | PASS |
| "Two ways in." | `two-ways-in.tsx` | h2 | PASS |
| "Don't just take our word for it." | `case-study-wall.tsx` | h2 | PASS |
| "A 30-minute conversation…" | `calendar-cta.tsx` | h2 | PASS |
| "Questions we get every week." | `faq.tsx` | h2 | PASS |
| "Have a thirty-minute conversation…" | `final-cta.tsx` | h2 | PASS |
| Leak card titles (3) | `problem-agitation.tsx` | h3 | PASS |
| Timeline step titles (4) | `timeline-30day.tsx` | h3 | PASS |
| Agent names (4) | `agent-persona-card.tsx` | h3 | PASS |
| Pricing card names (2) | `two-ways-in.tsx` | h3 | PASS |

h1 appears exactly once (hero). No heading levels are skipped.

---

## Focus Ring Audit (standalone interactive elements)

| Element | Location | Focus-visible class | Status |
|---------|----------|---------------------|--------|
| Logo `<Link>` | `topbar.tsx` | `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2` | PASS |
| Nav links (4) | `topbar.tsx` | same | PASS |
| "Book a strategy call" `<Button>` | `topbar.tsx` | inherited from `button.tsx` | PASS |
| VSL play `<button>` | `founder-vsl.tsx` | `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2` | PASS |
| Case study tab triggers | `case-study-wall.tsx` | `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2` | PASS |
| FAQ accordion triggers | `faq.tsx` | `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2` | PASS |
| Footer links (4) | `footer.tsx` | `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2` | PASS |
| CTA buttons (hero, pricing, final) | `button.tsx` | base component has ring | PASS |

---

## Color Contrast (Gold-on-Cream Restriction)

Per design-tokens.md locked WCAG audit:

- Gold `#B89154` on cream `#F5F4EE` = 2.64:1 — **FAILS WCAG AA**. Restricted to decorative `<em>` only.

Instances of `text-[var(--color-gold-italic)]` audited:

| Location | Context | Decorative? | Status |
|----------|---------|-------------|--------|
| `hero.tsx` — RotatingText | Italic word in h1; `aria-live` annotated; sentence fully readable without color | Yes | PASS |
| `founder-vsl.tsx` — `<em>` in h2 | "and what to do instead." — italic emphasis | Yes | PASS |
| `problem-agitation.tsx` — `<em>` in h2 | "are not ad spend." — italic emphasis | Yes | PASS |
| `meet-the-team.tsx` — `<em>` in h2 | "new team." — italic emphasis | Yes | PASS |
| `aria-deep-dive.tsx` — eyebrow | Gold on dark section (`#0F1612`) = 6.31:1 — passes | N/A | PASS |
| `aria-deep-dive.tsx` — `<em>` in h2 | "never sleeps" — italic emphasis on dark bg | Yes (dark bg) | PASS |
| `timeline-30day.tsx` — `<em>` in h2 | "fully running system." — italic emphasis | Yes | PASS |
| `two-ways-in.tsx` — `<em>` in h2 | "One destination." — italic emphasis | Yes | PASS |
| `calendar-cta.tsx` — `<em>` in h2 | "actually worth your time." — italic emphasis | Yes | PASS |
| `faq.tsx` — `<em>` in h2 | "we get every week." — italic emphasis | Yes | PASS |

All gold-on-cream uses are `<em>` italic decorative emphasis within heading copy. The full h1/h2 sentence is meaningful and styled in charcoal without relying on gold for information. Pattern is consistent with design-tokens.md §Accessibility rule 1.

No gold on cream for body copy, eyebrow chips, or UI labels.

---

## Reduced-Motion

- `app/globals.css`: global `@media (prefers-reduced-motion: reduce)` block zeros all `animation` and `transition` durations.
- `components/rotating-text.tsx`: `useReducedMotion()` from framer-motion; disables the rotating interval and sets `transition={{ duration: 0 }}` when reduced.
- No other Framer Motion animated components in the codebase.

---

## Form Accessibility

All form embedding is handled by Fillout (third-party embed). Form a11y is Fillout's responsibility. GHL Calendar is an iframe with `title` attribute set. N/A for this pass.

---

## Fixes Applied

| Item | File | Fix |
|------|------|-----|
| Skip-link | `app/layout.tsx` | Added sr-only skip-link targeting `#top` |

---

## Known Limitations

- axe-core and Lighthouse a11y audit required (T34) — Martin runs before launch.
- Fillout embed and GHL Calendar iframes are third-party; their internal a11y is not auditable statically.
- Color contrast for interactive states (hover, focus outlines) not empirically tested — requires browser rendering.
- Screen-reader announcement order for the sticky CTA bar not tested (dynamically shown/hidden via opacity/translate).
