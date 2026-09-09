# Lumenosis AI — Real Estate Landing Page Design

**Date:** 2026-05-25
**Owner:** Martin Ofunrein
**Status:** Approved (Section 1 + 2)
**Output target:** `lumenosis.ai` (replace current homepage)

---

## 1. Goal

Replace current Lumenosis homepage with a single long landing page modeled on **ScaleYourClinic** structural spine + **WorkReady AI** tactical copy density, applying **Daniel Turner's Atlas messaging frameworks** (`/Users/martinofunrein/Downloads/atlas/courses/`) and the **AIDA copy framework** to convert real estate professionals (agents / brokerages / property managers / short-term rental operators / investors) into booked strategy calls.

Drop the **"Agentic OS"** brand internally and externally — replace with named-agent product surface (Olivia / Aria / Theo / Iris).

## 2. Non-goals (this build)

- `/apply` multi-step quiz funnel — phase 2, paid ads route
- Per-niche subpages (`/agents`, `/brokerages`, `/property-management`, `/str`, `/investor`) — single page covers all via persona + niche cards
- Standalone pricing detail page — handled by "Two ways in" fork on landing page
- Blog / case-study detail pages
- Authenticated dashboard / customer portal
- New chat widget build — existing **Olivia** widget embeds as-is from current site
- Real image asset generation — placeholders for v1, real assets in separate phase
- GHL workflow buildout (SMS/email sequences) — those live inside GHL, not on landing page

## 3. Stakeholders + inputs

- **Reference catalog** of 147 competitor screenshots: `/Users/martinofunrein/Downloads/atlas/LEADGEN/31_landing_page_references/REFERENCE_CATALOG.md`
- **Atlas competitor analysis** (6 sites): `/Users/martinofunrein/Downloads/atlas/LEADGEN/06_research/competitor_analysis.md`
- **Atlas YouTube research** (7 videos, Wyatt + Carson + WorkReady): `/Users/martinofunrein/Downloads/atlas/LEADGEN/01_youtube_video_notes/all_videos_consolidated.md`
- **Daniel Turner course PDFs** (Marketing Foundations, Offer Creation, Copywriting, CRO): `/Users/martinofunrein/Downloads/atlas/courses/`
- **Existing Lumenosis homepage** screenshots: `/Users/martinofunrein/Downloads/AI Automation Software for Real Estate & Home Services  Lumenosis AI*.png`
- **Existing draft (deprecated)**: `/Users/martinofunrein/Downloads/atlas/LEADGEN/28_landing_pages/agentic_os_audit_landing_page.html` — light teal, off-brand, replaced by this spec
- **Final report**: `/Users/martinofunrein/Downloads/atlas/LEADGEN/21_final_report/final_report.md`

## 4. Top reference patterns adopted

| Pattern | Source | How it applies |
|---|---|---|
| Editorial serif hero with rotating italic niche slot | ScaleYourClinic | Hero headline rotates Real Estate / Brokerage / Property Mgmt / STR / Investor in italic gold |
| Trust strip directly under hero | ScaleYourClinic + OfferAI | NAR / Zillow Premier / Realtor.com / MLS / brokerage logos |
| Founder VSL embed early | ScaleYourClinic | Martin 60-90s video after hero |
| Stat trio under hero | All 5 reference sites | 60s response / 300% more bookings / 24/7 coverage |
| Named AI personas with role chips | WorkReady AI + ScaleYourClinic Aria | Olivia / Aria / Theo / Iris cards |
| Dark product-deep-dive section | ScaleYourClinic AI Receptionist | Aria phone-mockup section |
| 30-day editorial timeline | ScaleYourClinic | Foundation / Build / Launch / Optimize |
| Two-path pricing fork | ScaleYourClinic | "Build with us" / "Scale with us" |
| Tabbed case-study wall | ScaleYourClinic | Booking volume / Revenue / Speed-to-lead tabs |
| Calendar embed mid-page | 4/5 reference sites | GHL calendar widget |
| Sticky bottom CTA bar | ScaleYourClinic | Persistent "Book strategy call" |
| 2-col FAQ accordion | 4/5 reference sites | Standard pattern |
| Big editorial final CTA + pull-quote | ScaleYourClinic | Closes page on emotion |

Patterns **not** adopted: WorkReady's 3D mannequin renders (commission real avatars or use abstract), OfferAI's all-caps green-on-black sustained palette (visually fatiguing), generic feature-card grid (too commodity).

## 5. Sitemap

- `/` — single long landing page
- `/privacy` — MDX legal (premium ScaleYourClinic-style legal page)
- `/terms` — MDX legal

## 6. Page structure (top → bottom)

| # | Section | Component | Daniel/AIDA tie |
|---|---|---|---|
| 1 | Sticky topbar | `topbar.tsx` | — |
| 2 | Hero (cream) | `hero.tsx` + `rotating-text.tsx` + `glass-stat-callout.tsx` | Attention. One Promise One Outcome. |
| 3 | Trust strip | `trust-strip.tsx` (data: `content/trust-logos.ts`) | Authority anchor |
| 4 | Founder VSL | `founder-vsl.tsx` | Personal brand (Wyatt + Carson teach this) |
| 5 | Stat trio | inline in hero or own component | Speed-to-lead |
| 6 | Problem agitation | `problem-agitation.tsx` | Interest. Status Quo Is Enemy. |
| 7 | Meet your new team | `meet-the-team.tsx` + `agent-persona-card.tsx` × 4 | Process = Proof. Humanization. |
| 8 | Aria deep-dive (dark) | `aria-deep-dive.tsx` + `phone-mockup.tsx` | Transformation = Imagination |
| 9 | 30-day timeline | `timeline-30day.tsx` (data: `content/timeline.ts`) | Process = Proof |
| 10 | Two ways in | `two-ways-in.tsx` (data: `content/pricing.ts`) | Decision moment |
| 11 | Case study wall | `case-study-wall.tsx` + Tabs (data: `content/case-studies.ts`) | Social proof |
| 12 | Calendar CTA | `calendar-cta.tsx` + `ghl-calendar.tsx` | Action. Vetting. |
| 13 | FAQ | `faq.tsx` + Accordion (data: `content/faq.ts`) | Skepticism handling |
| 14 | Final editorial CTA | `final-cta.tsx` | Action close |
| 15 | Pull-quote testimonial | `pull-quote.tsx` | Last trust beat |
| 16 | Footer | `footer.tsx` | Legal + nav |
| — | Sticky bottom CTA bar | `sticky-cta-bar.tsx` | Persistent CTA after scroll past hero on mobile |

### 6.1 Hero spec
- Full-bleed hillside photography: raw daytime image in light mode, raw dusk image in dark mode.
- Theme switching is CSS-only: both images render, with `dark:opacity-*` selecting the visible image. This avoids hydration/theme-state drift.
- No full-image tint, backdrop blur, rectangle, image shadow, or text shadow.
- Light mode uses a localized left scrim: `from-white/68 via-white/38 to-transparent`, limited to `min(800px, 72vw)`.
- Dark mode uses a localized left scrim: `from-black/68 via-black/38 to-transparent`, limited to `min(800px, 72vw)`.
- Both scrims fade before the image's right side and exist only to protect text contrast.
- Display headline: `AI operations for [real estate teams / brokerages / property managers / short-term rentals / investors]` — amber phrase rotates every 2.2s.
- Light mode uses dark text; dark mode uses light text through the site theme tokens.
- Primary CTA: `Request a Demo`; secondary CTA: `See how it works`.
- Hero stats: first response, channels covered, and 24/7 coverage.

### 6.2 Aria deep-dive spec (dark section)
- Bg `#0F1612` for editorial contrast vs cream
- Headline (cream serif): `The front desk that never sleeps and never asks for a raise.`
- Sub: 2 sentences in Daniel's "transformation" style — vivid scene
- Phone mockup: live transcript of inbound buyer call → Aria gives property context → detects seller signal → books valuation slot
- 4 micro-feature tiles right: 12-second avg pickup / direct calendar booking / TCPA-safe two-party / encrypted call data

### 6.3 Two ways in spec
- Card A — `Build with us`: starting at `$X` one-time install. For solo agents and small teams. 4 bullets.
- Card B — `Scale with us`: starting at `$Y/mo` retainer + per-agent. For brokerages, property mgmt, multi-location. 5 bullets. `BEST POPULAR` tag.
- Both CTAs route to same Fillout audit form
- Real numbers TBD by Martin before launch — placeholder slots in `content/pricing.ts`

## 7. Visual system

### 7.1 Palette
- `--bg-cream` `#F5F4EE`
- `--ink-charcoal` `#1A1A1A`
- `--primary-indigo` `#1E1B4B`
- `--brand-violet` `#7C3AED` — CTAs + glow + Lumenosis brand recognition
- `--gold-italic` `#B89154` — rotating headline emphasis only
- `--dark-section` `#0F1612` — Aria deep-dive bg
- `--line` `#E2DDD1` — borders
- `--muted` `#52615B` — secondary text

### 7.2 Typography
- Display: **Tiempos Headline** (italic for emphasis, weight 600). Fallback chain: `Newsreader, Frank Ruhl Libre, Georgia, serif`. Loaded via `next/font` with `display: swap`.
- Body: **Inter** weight 400/500/700. Loaded via `next/font/google`.
- Mono (CRM mockups only): **JetBrains Mono**.
- Type scale (Tailwind v4 tokens): `text-display-hero` clamp(48px, 7vw, 88px), `text-display-section` clamp(32px, 4.5vw, 56px), `text-body-lg` 19px, `text-body` 16px, `text-eyebrow` 12px tracked uppercase.

### 7.3 Components
- shadcn/ui primitives via local CLI (not external import): Button, Card, Accordion, Tabs, Sheet, Tooltip, Badge, Separator
- Custom: RotatingText, GlassStatCallout, StickyCTABar, PhoneMockup, AgentPersonaCard, FilloutEmbed, GhlCalendar
- Buttons: violet primary pill (CTA), cream outline (secondary), charcoal ghost (tertiary nav)

### 7.4 Motion
- Framer Motion for: hero rotating-text cross-fade, scroll-trigger reveals on section enter (subtle 12px translate + opacity), sticky CTA bar slide-in after hero exit
- `prefers-reduced-motion` respected — disables all motion

### 7.5 Responsive
- Breakpoints: mobile <640, tablet 640-1024, desktop 1024+
- Mobile: hero collapses to single column, product card moves below copy, sticky CTA bar appears after hero scroll
- Two ways in: stacks vertically on mobile

## 8. Copy framework

### 8.0 ICP (locked via Uppie template builder, 2026-05-25)
- **Audience**: Busy Real Estate Agents, Brokerage Owners, and Property Managers looking to scale without hiring more staff
- **Geo**: United States and Canada
- **Voice rule**: address operator (agent / broker / property manager) directly. Never address "the team" or "your enterprise" abstractly.

### 8.1 Daniel Turner principles applied
- **We're early to market** → no jargon. RE prospects' words: "leads", "appointments", "listings", "showings", "follow-up"
- **Process = Proof** → 30-day timeline, named agent capability bullets, phone-mockup transcript
- **Status quo is enemy** → problem agitation section frames cost of doing nothing
- **Transformation = Imagination** → Aria deep-dive uses vivid scene ("It's 9:47am. Three valuations are booked. You haven't checked email.")
- **Long-term benefit** → "stops missed-deal pattern" framing in pricing fork
- **Transparency** → "We won't automate everything. We handle 4 workflows: phones, email, SMS, lead recovery." Daniel's antidote to skepticism
- **One promise. One outcome** → hero = single outcome, no compound promises

### 8.2 AIDA mapping
- **Attention**: hero rotating headline + stat trio
- **Interest**: problem agitation + meet the team
- **Desire**: Aria deep-dive vivid scene + 30-day timeline + case-study wall
- **Action**: Two ways in fork + calendar embed + final editorial CTA + sticky CTA bar

### 8.3 ICP voice rules
- Address the operator, not the agency
- Use "your team" / "your day" — never "your business operations" or "your enterprise"
- Anchor every claim with a number where credible (60s, 92s, 12s, 300%, 24/7)
- Never claim guarantees we can't substantiate
- Compliance-aware language for TCPA, Fair Housing, two-party-consent in FAQ + footer

### 8.4 What to avoid
- "Agentic OS" name (drop entirely)
- Generic AI buzzwords: "transformative", "cutting-edge", "leverage", "synergy", "revolutionize"
- "10x" or "10+ in 90 days or money back" — risky without proven install volume
- Em dashes (Martin's style preference)
- AI-vocab tells: "utilize", "delve", "crucial", "furthermore"

## 9. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router + React Server Components |
| Language | TypeScript strict |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (local CLI install) |
| Animation | Framer Motion |
| Fonts | next/font (Tiempos local, Inter from Google) |
| Images | next/image (WebP/AVIF) |
| MDX | @next/mdx for /privacy + /terms |
| Forms | @fillout/react |
| Booking | GHL calendar widget iframe |
| Analytics | Vercel Analytics + custom event hooks |
| Hosting | Vercel |
| Package mgr | pnpm |
| Lint/format | Biome (single tool, fast) |
| Type check | tsc strict |

### 9.1 Env vars
```
FILLOUT_API_KEY=sk_prod_*       # server only — never client-bundled
GHL_LOCATION_PIT=pit-*          # server only — subaccount scoped
GHL_CALENDAR_ID=<calendar id>   # public — used in iframe URL
NEXT_PUBLIC_FILLOUT_FORM_ID=<form id>
NEXT_PUBLIC_VERCEL_ANALYTICS=on
```
- `lib/env.ts` validates with zod at boot
- `.env.local` gitignored
- `.env.example` committed without secrets

## 10. Forms + booking integration

### 10.1 Flow
```
Visitor → clicks any CTA
       → scrolls/anchors to calendar section
       → sees Fillout multi-step form (themed cream/violet)
       → submits
       → Fillout native GHL integration creates contact + opportunity in your subaccount
       → GHL workflow auto-fires (SMS confirm, email confirm, internal Slack)
       → success state shows GHL calendar widget inline
       → visitor books strategy call slot
       → GHL appointment created
```

### 10.2 Fillout setup checklist (Martin)
- Build form in Fillout: Name / Email / Phone / RE lane (select) / Primary lead source (select) / CRM tool / Monthly lead volume / Biggest bottleneck (textarea) / Urgency (select) / TCPA consent (checkbox)
- Configure Fillout → GHL native integration (paste GHL location PIT)
- Map Fillout fields → GHL contact + custom fields + opportunity stage
- Theme: bg cream, primary violet, font Inter, ink charcoal
- Get form ID for `NEXT_PUBLIC_FILLOUT_FORM_ID`

### 10.3 GHL setup checklist (Martin)
- Confirm subaccount location ID
- Create dedicated calendar: "Lumenosis AI — Strategy Call (30 min)"
- Configure availability + buffer + intake questions
- Create workflow: form-submit trigger → SMS confirm + email confirm + Slack to Martin
- Get calendar ID for `GHL_CALENDAR_ID`

### 10.4 Optional webhook fallback
- `app/api/lead/route.ts` — POST handler
- Listens to Fillout submit webhook (HMAC verified)
- Logs payload + sends Slack notification
- Used only if native Fillout→GHL integration breaks

## 11. Folder structure

```
lumenosis-site/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx
│   │   ├── privacy/page.mdx
│   │   ├── terms/page.mdx
│   │   └── layout.tsx
│   ├── api/lead/route.ts
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── sections/  (16 files, see section 6)
│   ├── ui/        (shadcn primitives)
│   ├── rotating-text.tsx
│   ├── glass-stat-callout.tsx
│   ├── phone-mockup.tsx
│   ├── agent-persona-card.tsx
│   ├── fillout-embed.tsx
│   └── ghl-calendar.tsx
├── content/
│   ├── agents.ts
│   ├── faq.ts
│   ├── timeline.ts
│   ├── case-studies.ts
│   ├── trust-logos.ts
│   └── pricing.ts
├── docs/superpowers/specs/2026-05-25-lumenosis-landing-design.md
├── public/images/
│   ├── martin-headshot.jpg
│   ├── martin-vsl-poster.jpg
│   ├── product-card-mockup.png
│   ├── phone-mockup-aria.png
│   └── agents/{olivia,aria,theo,iris}.png
├── lib/
│   ├── analytics.ts
│   └── env.ts
├── .env.local           (gitignored)
├── .env.example         (committed)
├── .gitignore
├── biome.json
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
├── pnpm-lock.yaml
└── README.md
```

## 12. Build sequencing (high level — full plan in writing-plans phase)

**Skills invoked during build:**
- `frontend-design` — invoked at the start of every section component build for visual taste, layout decisions, component composition, and accessibility patterns
- `frontend-patterns` (if available) — supplemental UI pattern lookups
- `nextjs-turbopack` — scaffold + dev server config
- `vercel:bootstrap` + `vercel:deploy` — deployment pipeline
- `vercel:env-vars` — env management
- `vercel:shadcn` — shadcn integration patterns
- `vercel:ai-sdk` — only if AI elements added to page (defer)

**Sequencing:**

1. **Scaffold** — Next.js 15 init + Tailwind v4 + shadcn CLI + fonts + base layout. Use `nextjs-turbopack` skill. Single thread.
2. **Design pass** — invoke `frontend-design` skill on full landing page wireframe before any section coding. Lock visual primitives (button variants, card variants, type scale, spacing scale).
3. **Parallel section build** (4 subagents — each invokes `frontend-design` skill on entry):
   - Subagent A: topbar + hero + trust-strip + sticky-cta-bar
   - Subagent B: founder-vsl + problem-agitation + meet-the-team + agent-persona-card
   - Subagent C: aria-deep-dive + phone-mockup + timeline-30day + two-ways-in
   - Subagent D: case-study-wall + calendar-cta + faq + final-cta + pull-quote + footer
4. **Forms + booking** — Fillout embed component + GHL calendar component + env validation + optional webhook. Single thread.
5. **Copy pass** — apply Daniel + AIDA framework to all section copy + content data files. Single thread.
6. **Legal pages** — `/privacy` + `/terms` MDX. Single thread.
7. **Deploy** — `vercel:bootstrap` + `vercel:deploy` skills. Lighthouse audit + accessibility check + responsive QA.
8. **User review** on preview → iterate (frontend-design skill re-invoked for any visual revisions)

## 13. Acceptance criteria

- Lighthouse mobile: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95
- LCP < 2.5s on mobile 4G
- CLS < 0.1
- All section components render with placeholder content + real-data swap point
- Fillout embed renders + submits successfully + creates GHL contact in test
- GHL calendar embed renders + booking creates GHL appointment in test
- All copy follows Daniel + AIDA framework, no banned vocab (section 8.4)
- No "Agentic OS" string anywhere in repo
- `prefers-reduced-motion` disables all Framer Motion
- Mobile + tablet + desktop layouts pass visual QA
- `/privacy` + `/terms` MDX renders correctly
- All env vars validated at boot via zod

## 14. Open items requiring Martin input before/during build

- Real prices for Two ways in fork (or confirm placeholder $X / $Y)
- Real trust-strip logos (which brokerages are real clients vs aspiration)
- 60-90s VSL script + recording (or use audio-only with poster image v1)
- Martin headshot image
- Real case-study quotes (or use anonymized "Real Estate Professional, Austin TX" v1)
- Fillout form ID after building it in Fillout dashboard
- GHL calendar ID + subaccount location confirmation
- Existing Olivia chat widget snippet from current site

## 15. Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-25 | Single long landing page (not multi-page) | Fastest ship + ScaleYourClinic spine + matches RE buyer flow |
| 2026-05-25 | Editorial Light w/ Violet palette | Premium feel + keeps Lumenosis violet brand recognition |
| 2026-05-25 | 5-way niche rotation | Custom feel without per-niche subpages |
| 2026-05-25 | 4 named agents (Olivia/Aria/Theo/Iris) | Brand continuity (Olivia stays) + WorkReady-validated humanization |
| 2026-05-25 | Two-path pricing fork w/ starting prices | Decision moment without full price commitment |
| 2026-05-25 | Martin face + VSL prominent | Personal brand > company brand for AI services |
| 2026-05-25 | Fillout form + GHL calendar via native integration | Best DX + design control + minimal glue code |
| 2026-05-25 | Drop "Agentic OS" branding | Replace with named-agent product surface |
| 2026-05-25 | Next.js 15 + Tailwind v4 + shadcn + Vercel | Matches existing stack + best leverage |
| 2026-05-25 | `frontend-design` skill invoked per section component build | Ensures visual taste + accessibility consistency across all 16 sections |
