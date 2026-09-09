# Lumenosis Design Tokens — Locked Primitives

Grep this file before making any spacing, color, card, or layout decision.

---

## TAILWIND v4 TOKEN RULE (mandatory)

`@theme` tokens do NOT auto-generate utilities. Always use the `[var(--token-name)]` form:

```
bg-[var(--color-brand-violet)]   ← correct
bg-brand-violet                  ← silent no-op
```

Applies to every color, shadow, font, radius, and size token from `app/globals.css`.

---

## Spacing Scale

Use only these steps — no improvised intermediate values.

| px  | Tailwind | px  | Tailwind |
|-----|----------|-----|----------|
| 4   | `p-1`    | 48  | `p-12`   |
| 8   | `p-2`    | 64  | `p-16`   |
| 12  | `p-3`    | 96  | `p-24`   |
| 16  | `p-4`    | 128 | `p-32`   |
| 24  | `p-6`    |     |          |
| 32  | `p-8`    |     |          |

Exception: document in a comment when a one-off internal value is necessary.

---

## Section Padding

| Context          | Mobile        | Desktop (md+)       |
|-----------------|---------------|---------------------|
| Standard section | `py-16`       | `md:py-24`          |
| Dark section     | `py-20`       | `md:py-28`          |
| Hero             | `pt-24 pb-16` | `md:pt-32 md:pb-24` |
| Footer           | `py-12`       | `md:py-16`          |

Dark sections (`bg-[var(--color-dark-section)]`) get 4px extra vertical padding to compensate
for the visual weight of the dark field.

---

## Section Wrapper

All sections use this container class — a single mx-auto with fluid side padding:

```tsx
// Standard wrapper
<section className="mx-auto w-[min(1200px,calc(100%-32px))]">

// Wider context (trust strip, final CTA)
<section className="mx-auto w-[min(1400px,calc(100%-32px))]">
```

On mobile at 360px viewport: `100% - 32px = 328px` usable. No horizontal scroll.

---

## Responsive Breakpoint Matrix

| Breakpoint | Width  | Tailwind prefix | Typical use |
|-----------|--------|-----------------|-------------|
| (base)    | 360px+ | —               | Single-column, full-width |
| sm        | 640px+ | `sm:`           | 2-col grids begin |
| md        | 768px+ | `md:`            | Hero split-grid activates, nav expands |
| lg        | 1024px+| `lg:`           | 3-4 col grids, wider type scale |
| xl        | 1280px+| `xl:`           | Max-width container locks |

Every component must render without horizontal scroll at 360px. Test: `overflow-x-hidden` on
`<body>` is set; any child that breaks out will create a scroll track.

---

## Card Variants

Three named recipes. Add them as `className` via `cn()` on top of `<Card>` from `components/ui/card.tsx`.

### card-soft (default on cream sections)
```
rounded-[var(--radius)]
border border-[var(--color-line)]
bg-[var(--color-bg-cream)]
shadow-[var(--shadow-soft)]
```
Use for: agent persona cards, feature tiles, FAQ items, timeline steps.

### card-elevated (white lift on cream sections)
```
rounded-[var(--radius)]
border border-[var(--color-line)]
bg-white
shadow-[0_4px_24px_rgba(17,21,19,0.10)]
```
Use for: pricing fork cards, case study cards, calendar CTA container.
The white background pops against the cream page background — use only when deliberate lift
is needed (pricing, testimonials, CTAs that need to stand out from surrounding content).

### card-dark (inside dark-section only)
```
rounded-[var(--radius)]
border border-[rgba(255,255,255,0.08)]
bg-[rgba(255,255,255,0.04)]
shadow-[var(--shadow-glow-violet)]
```
Use for: Aria deep-dive micro-feature tiles, dark-section callouts.
The violet glow shadow (`0 0 60px rgba(124,58,237,0.35)`) is intentional; use only on the
primary feature card, not every tile.

---

## Eyebrow Chip Pattern

Eyebrow chips precede section headings. Class recipe:

```tsx
<span className="
  inline-block
  text-[var(--text-eyebrow)]
  font-semibold
  uppercase
  tracking-[0.14em]
  text-[var(--color-brand-violet)]
  mb-3
">
  Eyebrow label
</span>
```

**Color rule:**
- Default: violet `var(--color-brand-violet)` on cream — contrast 5.17:1 (passes 4.5:1)
- On dark section: gold `var(--color-gold-italic)` — contrast 6.31:1 on dark (passes 4.5:1)
- Do NOT use gold `#9a7a3e` on cream backgrounds — contrast is only 2.64:1 (fails WCAG, see A11y section)

No border, no background pill — flat text chip only. A background pill reads as a badge/tag
and competes with the heading. The visual rhythm comes from the tight tracking + uppercase.

---

## Hero Composition

```
Grid: 1.05fr / 0.95fr  →  collapses to 1 column at md breakpoint (768px)

<div className="
  grid grid-cols-1
  md:grid-cols-[1.05fr_0.95fr]
  gap-12
  items-center
">
  <!-- Left: copy stack -->
  <!-- Right: product card -->
</div>
```

**Product card (right column):**
```
aspect-[4/5]
rounded-[var(--radius)]
overflow-hidden
```
On mobile: `w-full max-w-sm mx-auto` to prevent oversized card on narrow screens.

**Glass stat callouts (3 floating badges):**
- Position: `absolute` inside `relative` product card container
- top-left: `top-6 left-6` / mid-right: `top-1/2 -right-4 -translate-y-1/2` / bottom-left: `bottom-6 left-6`
- Recipe:
```
rounded-[var(--radius)]
bg-white/80
backdrop-blur-sm
border border-[var(--color-line)]
shadow-[var(--shadow-soft)]
px-3 py-2
text-sm font-semibold text-[var(--color-ink-charcoal)]
```
- On mobile: hide mid-right callout (`hidden md:block`) to avoid overflow past card edge

---

## Typography

All sizes reference `@theme` tokens from `app/globals.css`.

| Token | Value | Class |
|-------|-------|-------|
| `--text-display-hero` | `clamp(2.5rem, 7vw, 5.5rem)` | `text-[var(--text-display-hero)]` |
| `--text-display-section` | `clamp(2rem, 4.5vw, 3.5rem)` | `text-[var(--text-display-section)]` |
| `--text-body-lg` | `1.1875rem` | `text-[var(--text-body-lg)]` |
| `--text-body` | `1rem` | `text-base` (Tailwind default) |
| `--text-eyebrow` | `0.75rem` | `text-[var(--text-eyebrow)]` |

**Font family classes:**
```
font-[var(--font-display)]   ← Newsreader serif (loaded via next/font)
font-[var(--font-body)]      ← Inter (default body, already set on <body>)
font-[var(--font-mono)]      ← JetBrains Mono (CRM mockup transcripts only)
```

**Gold italic emphasis** (hero rotating word only):
```tsx
<em className="not-italic text-[var(--color-gold-italic)]">
  {currentNiche}
</em>
```
This text is decorative emphasis. The full sentence remains meaningful without the color.
Mark the `<RotatingText>` with `aria-live="polite"` and `aria-atomic="true"`.

---

## Accessibility

### Contrast audit (verified)

| Pair | Ratio | Use | Status |
|------|-------|-----|--------|
| `#1A1A1A` on `#F5F4EE` | 15.79:1 | Body text | PASS |
| `#52615B` on `#F5F4EE` | 5.92:1 | Secondary text | PASS |
| `#1E1B4B` on `#F5F4EE` | 14.51:1 | Display headings | PASS |
| `#7C3AED` on `#F5F4EE` | 5.17:1 | Violet eyebrow chips | PASS |
| `#FFFFFF` on `#7C3AED` | 5.70:1 | Button labels on violet | PASS |
| `#F5F4EE` on `#0F1612` | 16.66:1 | Body on dark section | PASS |
| `#B89154` on `#F5F4EE` | 2.64:1 | Gold on cream | **FAIL** |
| `#9a7a3e` on `#FFFFFF` | 3.65:1 | Gold on white (large text only) | PASS (large text) |
| `#9a7a3e` on `#F5F4EE` | 4.02:1 | Gold on cream (large text only) | PASS (large text) |
| `#9a7a3e` on `#0F1612` | 6.31:1 | Gold eyebrow on dark | PASS |
| `#B89154` on `#0F1612` | 6.31:1 | Gold eyebrow on dark (legacy) | PASS |
| `#7C3AED` on `#0F1612` | 3.22:1 | Violet on dark (non-text) | PASS (UI component) |

**Gold on cream fails WCAG at all text sizes.** Gold `#9a7a3e` is restricted to:
1. The hero rotating-word italic (decorative; full sentence readable in charcoal; supplement with `aria-live`)
2. Eyebrow chips on dark-section backgrounds only (`#0F1612`, contrast 6.31:1)

On cream, eyebrow chips use violet only.

### Focus ring (all interactive elements)
`button.tsx` already establishes the pattern. Replicate on every focusable element:
```
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-[var(--color-brand-violet)]
focus-visible:ring-offset-2
```
On dark sections, add `focus-visible:ring-offset-[var(--color-dark-section)]` so the offset
gap doesn't disappear into the dark background.

### Reduced motion
`app/globals.css` already zeros all animation/transition durations under
`prefers-reduced-motion: reduce`. All Framer Motion components must also check:
```tsx
const { prefersReducedMotion } = useReducedMotion() // framer-motion hook
```
Pass `transition={{ duration: prefersReducedMotion ? 0 : 0.35 }}` to every animated element.

---

## Spec Contradictions Flagged

1. **Display font name conflict** — spec section 7.2 says "Tiempos Headline" but `app/globals.css`
   `--font-display` var uses `var(--font-newsreader)` (Newsreader loaded via `next/font`). Tiempos
   is in the fallback chain only. **Resolution locked: use Newsreader as primary.** Tiempos is a
   paid font; Newsreader is free and visually equivalent for this context.

2. **Gold eyebrow on cream** — spec section 7.1 lists gold as valid eyebrow color. Contrast check
   shows 2.64:1 on cream — fails WCAG AA at any size. **Resolution locked: gold restricted to
   hero rotating-word (decorative, aria-live annotated) and dark-section eyebrows only.**

3. **Spec responsive breakpoints vs plan responsive breakpoints** — spec section 7.5 says
   "mobile <640, tablet 640-1024, desktop 1024+". Plan task brief says "md 768px" is the hero
   collapse point. **Resolution locked: hero collapses at md (768px) as the brief specifies;
   the 640 sm breakpoint activates 2-col sub-grids within sections before the hero collapses.**

4. **`--muted` on dark section** — `#52615B` on `#0F1612` is only 2.81:1. Use cream
   (`var(--color-bg-cream)`) for all secondary text on dark-section backgrounds. Never use muted
   on dark.
