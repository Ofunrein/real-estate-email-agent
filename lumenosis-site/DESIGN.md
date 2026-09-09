# Lumenosis Design System

Source of truth: `app/globals.css` (@theme tokens) + `app/layout.tsx` (fonts).
This doc mirrors them — if they disagree, the code wins. Last synced: 2026-07-14.

## Brand Positioning
AI-powered real estate front-desk platform. Editorial, authoritative, warm — not
SaaS-cold. Boutique agency meets modern AI infrastructure. **Dark theme is the
default** (`ThemeProvider defaultTheme="dark"`); light must always work.

## Agent
One agent: **Iris** (`/images/agents/iris.png`), accent gold. The former
four-persona system (Olivia/Aria/Theo/Iris) is retired — do not reintroduce
per-channel personalities. Legacy avatars remain in `/images/agents/` (olivia.png
doubles as a generic lead/customer photo in demos).

## Color

| Token | Light | Dark (`.dark`) |
|---|---|---|
| `--color-bg` / `--color-bg-cream` | `#f5f4ee` | `#070708` |
| `--color-ink` / `--color-ink-charcoal` | `#0e0e0f` | `#f0eeeb` |
| `--color-muted` / `--color-ink-muted` | `rgba(14,14,15,0.82)` | `rgba(240,238,235,0.9)` |
| `--color-line` | `rgba(14,14,15,0.1)` | `rgba(255,255,255,0.08)` |
| `--color-brand-amber` (primary accent) | `#c49a52` | `#c49a52` |
| `--color-brand-amber-soft` | `rgba(196,154,82,0.12)` | same |
| `--color-dark-section` | — | `#0c0c0d` |

Legacy aliases (`--color-brand-violet`, `--color-brand-purple`,
`--color-gold-italic`, `--color-primary-indigo`) all resolve to amber now.
Prefer `--color-brand-amber` in new code. There is no violet in the brand anymore.

## Typography

| Role | Font | Token |
|---|---|---|
| Display + body | DM Sans | `--font-display`, `--font-body` |
| Mono (numbers, eyebrows, stats) | DM Mono | `--font-mono` |
| Serif (loaded, rarely used) | Playfair Display | `--font-playfair` |

Scale in practice:
- Section heading: `text-[clamp(1.9rem,4vw,3.1rem)] font-bold tracking-[-0.035em] leading-[1.05]`
- Big feature heading (demo section): `text-[clamp(2.4rem,4.6vw,4.2rem)] tracking-[-0.04em]`
- Body: `text-[0.9375rem] leading-[1.7]`; lede: `text-[1.0625rem] leading-relaxed`
- Mono numerals: `font-mono tabular-nums`

## Layout
- Section container: `mx-auto w-[min(1120px,calc(100vw-48px))]` (demo section uses 1480px)
- Section padding: `py-24 md:py-32`
- Section anchors: `#agents` (Iris section), `#aria` (demo), used by topbar + hero

## Components
- **GlowCard** (`components/spotlight-card.tsx`): pointer-tracking spotlight card.
  Use `glowColor="gold"` (amber band, hue 34–50) — never `purple` (legacy).
  Overrides via CSS vars: `[--backdrop:…]` `[--backup-border:…]` `[--border:2]`.
  Light mode: use `[--border:2]` + soft `--backup-border`; default 4px reads heavy.
- **Reveal** (`components/reveal.tsx`): currently a no-op wrapper (variant/delay ignored).
- **Iris section**: live = `sections/iris-lead-desk.tsx` (editorial, sticky identity
  card + numbered channel rows). Alternate = `sections/iris-lead-desk-spotlight.tsx`
  (hero GlowCard + 4 channel cards). Compare at `/preview/iris`. Rollback:
  `sections/process.tsx` (pre-Iris, four personas — reference only).
- Eyebrow: `font-mono text-[0.6875rem] uppercase tracking-[0.06em+]` muted or amber.
- Stat grid: `grid gap-px` over `bg-[var(--color-line)]` with `rounded-[10px]` frame.

## Hard rules
- No violet/indigo accents; amber only.
- Keep DM Sans/DM Mono; don't introduce new fonts without updating layout.tsx.
- Every `next/image` with `fill` needs a `sizes` prop.
- Radius: cards 12–18px via GlowCard `radius` prop; pills `rounded-full`.
