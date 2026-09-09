# Lumenosis AI Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build single long landing page at `lumenosis.ai` with rotating-niche editorial hero, 4 named AI agents, 30-day timeline, two-path pricing, Fillout form + GHL calendar booking. Replace existing dark/violet homepage. Mobile-first responsive throughout.

**Architecture:** Next.js 15 App Router + RSC for SEO/performance, Tailwind v4 design tokens for palette/type scale, shadcn/ui primitives + custom components, Framer Motion for hero rotation + scroll reveals, Fillout React SDK + GHL calendar iframe for conversion, Vercel deploy.

**Tech Stack:** Next.js 15, TypeScript strict, Tailwind v4, shadcn/ui, Framer Motion, next/font, @fillout/react, @next/mdx, Biome, pnpm, Vercel.

**Spec:** `docs/superpowers/specs/2026-05-25-lumenosis-landing-design.md`

**Mobile-responsive rule (applies to every component task):** Mobile-first Tailwind. Breakpoints `sm 640 / md 768 / lg 1024 / xl 1280`. Every layout uses CSS Grid or Flex with `flex-col md:flex-row` or `grid-cols-1 md:grid-cols-2` patterns. Text sizes use `clamp()` via Tailwind `text-display-*` tokens. No fixed pixel widths over 100% on mobile. Every component task ends with mobile + tablet + desktop screenshot in QA step.

---

## Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `biome.json`, `.gitignore`, `.env.example`, `README.md`
- Working dir: `/Users/martinofunrein/Downloads/atlas/lumenosis-site/`

- [ ] **Step 1.1: Init Next.js 15 with App Router**

```bash
cd /Users/martinofunrein/Downloads/atlas/lumenosis-site
pnpm dlx create-next-app@latest . --ts --tailwind --app --src-dir false --import-alias "@/*" --use-pnpm --no-eslint --no-turbopack
```

Confirm prompts: `Would you like to use Turbopack? No` (use default Next dev), `import alias @/*: yes`.

Expected: scaffold creates `app/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `tailwind.config.ts`, `postcss.config.mjs`.

- [ ] **Step 1.2: Add core dependencies**

```bash
pnpm add framer-motion @fillout/react zod
pnpm add -D @biomejs/biome @types/node
```

- [ ] **Step 1.3: Replace ESLint with Biome**

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noNonNullAssertion": "off" },
      "suspicious": { "noExplicitAny": "warn" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

Add to `package.json` scripts:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "biome check .",
  "format": "biome format --write ."
}
```

- [ ] **Step 1.4: Set up `.env.example`**

Create `.env.example`:

```
FILLOUT_API_KEY=
GHL_LOCATION_PIT=
GHL_CALENDAR_ID=
NEXT_PUBLIC_FILLOUT_FORM_ID=
NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL=
```

Append to `.gitignore`:

```
.env.local
.env.production.local
```

- [ ] **Step 1.5: Init git + commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js 15 + Tailwind + Biome"
```

Expected: clean working tree, initial commit landed.

---

## Task 2: Configure Tailwind v4 design tokens

**Files:**
- Create: `app/globals.css` (full rewrite)
- Modify: `tailwind.config.ts`

- [ ] **Step 2.1: Define palette + type tokens in globals.css**

Replace `app/globals.css` with:

```css
@import "tailwindcss";

@theme {
  --color-bg-cream: #f5f4ee;
  --color-ink-charcoal: #1a1a1a;
  --color-primary-indigo: #1e1b4b;
  --color-brand-violet: #7c3aed;
  --color-brand-violet-soft: rgba(124, 58, 237, 0.12);
  --color-gold-italic: #b89154;
  --color-dark-section: #0f1612;
  --color-line: #e2ddd1;
  --color-muted: #52615b;

  --font-display: "Tiempos Headline", "Newsreader", "Frank Ruhl Libre", Georgia, serif;
  --font-body: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-display-hero: clamp(2.5rem, 7vw, 5.5rem);
  --text-display-section: clamp(2rem, 4.5vw, 3.5rem);
  --text-body-lg: 1.1875rem;
  --text-body: 1rem;
  --text-eyebrow: 0.75rem;

  --shadow-soft: 0 18px 45px rgba(17, 21, 19, 0.08);
  --shadow-glow-violet: 0 0 60px rgba(124, 58, 237, 0.35);

  --radius: 0.625rem;
  --radius-pill: 999px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }

body {
  margin: 0;
  background: var(--color-bg-cream);
  color: var(--color-ink-charcoal);
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2.2: Verify Tailwind v4 config still resolves**

```bash
pnpm dev
```

Expected: dev server boots on `http://localhost:3000`. Visit and confirm no CSS errors in browser console.

- [ ] **Step 2.3: Commit**

```bash
git add -A
git commit -m "feat: define Tailwind v4 design tokens (palette, type, shadows)"
```

---

## Task 3: Load fonts via next/font

**Files:**
- Modify: `app/layout.tsx`
- Create: `public/fonts/tiempos-headline.woff2` (placeholder note)

- [ ] **Step 3.1: Add Tiempos placeholder note**

Tiempos Headline is paid. For v1, use Newsreader (Google Font, free) as display. Swap to Tiempos when license acquired.

Create `public/fonts/README.md`:

```
# Fonts

Display font: Tiempos Headline (paid - https://klim.co.nz/buy/tiempos-headline/).
v1 uses Newsreader (Google Font) as display fallback.
Drop tiempos-headline.woff2 + tiempos-headline-italic.woff2 here when license acquired,
then update app/layout.tsx to swap from `Newsreader` to `localFont` import.
```

- [ ] **Step 3.2: Wire next/font in root layout**

Replace `app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Inter, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lumenosis AI — AI agents for real estate",
  description:
    "AI agents that handle inbound calls, SMS, email, and lead recovery for real estate, brokerages, property management, short-term rentals, and investors.",
  metadataBase: new URL("https://lumenosis.ai"),
  openGraph: {
    title: "Lumenosis AI — AI agents for real estate",
    description:
      "AI agents that book qualified appointments while you sleep. Real estate, brokerages, property management.",
    url: "https://lumenosis.ai",
    siteName: "Lumenosis AI",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${newsreader.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3.3: Update font tokens to consume CSS vars**

In `app/globals.css`, replace `--font-display` and `--font-body` lines under `@theme`:

```css
  --font-display: var(--font-newsreader), "Tiempos Headline", Georgia, serif;
  --font-body: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, monospace;
```

- [ ] **Step 3.4: Commit**

```bash
git add -A
git commit -m "feat: load Inter + Newsreader + JetBrains via next/font"
```

---

## Task 4: Add shadcn/ui primitives

**Files:**
- Create: `components/ui/button.tsx`, `card.tsx`, `accordion.tsx`, `tabs.tsx`, `sheet.tsx`, `tooltip.tsx`, `badge.tsx`, `separator.tsx`
- Create: `lib/utils.ts`

- [ ] **Step 4.1: Init shadcn**

```bash
pnpm dlx shadcn@latest init
```

Prompts:
- Style: `default`
- Base color: `neutral`
- CSS variables: `yes`
- Server components: `yes`

Confirm `components.json` created.

- [ ] **Step 4.2: Add primitives**

```bash
pnpm dlx shadcn@latest add button card accordion tabs sheet tooltip badge separator
```

- [ ] **Step 4.3: Customize Button variants**

Modify `components/ui/button.tsx` — replace `buttonVariants` with:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-violet text-white hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-violet)]",
        outline:
          "border border-line bg-transparent text-ink-charcoal hover:bg-bg-cream hover:-translate-y-0.5",
        ghost: "text-ink-charcoal hover:bg-bg-cream/60",
        ondark:
          "bg-white text-ink-charcoal hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]",
      },
      size: {
        default: "min-h-12 px-5 text-[15px]",
        sm: "min-h-10 px-4 text-sm",
        lg: "min-h-14 px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);
```

- [ ] **Step 4.4: Commit**

```bash
git add -A
git commit -m "feat: add shadcn primitives + custom button variants"
```

---

## Task 5: Design pass — invoke frontend-design skill

**Files:**
- Reference only — no file edits

- [ ] **Step 5.1: Invoke frontend-design skill**

Invoke `frontend-design` skill with this brief:

> Building Lumenosis AI real estate landing page. Spec: `docs/superpowers/specs/2026-05-25-lumenosis-landing-design.md`. Reference catalog: `/Users/martinofunrein/Downloads/atlas/LEADGEN/31_landing_page_references/REFERENCE_CATALOG.md`.
>
> Lock visual primitives before component build:
> 1. Spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 px)
> 2. Card variants: `card-soft` (cream bg + line border + soft shadow), `card-elevated` (white bg + shadow), `card-dark` (dark-section bg + cream text + violet glow accent)
> 3. Eyebrow chip pattern (uppercase, tracked, small, gold or violet text on cream)
> 4. Section paddings (mobile py-16, desktop py-24, dark sections py-28)
> 5. Hero composition: split-grid 1.05fr/0.95fr collapses to single column under md
> 6. Mobile-first responsive: every component MUST work at 360px width
> 7. Accessibility: contrast ratios 4.5:1+ for body text, 3:1+ for large display, focus rings visible on cream bg
>
> Output: confirm visual primitives + flag any spec contradictions before component build proceeds.

- [ ] **Step 5.2: Capture decisions in `components/ui/design-tokens.md`**

Create `components/ui/design-tokens.md` documenting locked decisions from frontend-design skill output (spacing, card variants, eyebrow pattern, section paddings).

- [ ] **Step 5.3: Commit**

```bash
git add -A
git commit -m "docs: lock visual primitives via frontend-design skill"
```

---

## Task 6: Content data files

**Files:**
- Create: `content/agents.ts`, `faq.ts`, `timeline.ts`, `case-studies.ts`, `trust-logos.ts`, `pricing.ts`, `niches.ts`

- [ ] **Step 6.1: `content/niches.ts`** — hero rotation source

```ts
export const niches = [
  "Real Estate",
  "Brokerage",
  "Property Management",
  "Short-Term Rental",
  "Investor",
] as const;

export type Niche = (typeof niches)[number];
```

- [ ] **Step 6.2: `content/agents.ts`** — 4 named AI agents

```ts
export type Agent = {
  slug: "olivia" | "aria" | "theo" | "iris";
  name: string;
  role: string;
  tagline: string;
  bullets: string[];
  avatar: string;
  accent: "violet" | "indigo" | "gold" | "cyan";
};

export const agents: Agent[] = [
  {
    slug: "olivia",
    name: "Olivia",
    role: "Front desk chat",
    tagline: "Answers website visitors in seconds and captures every lead.",
    bullets: [
      "Instant replies to property questions",
      "Captures name, phone, intent before they leave",
      "Routes hot leads to your CRM in real time",
      "Speaks your market’s language",
    ],
    avatar: "/images/agents/olivia.png",
    accent: "violet",
  },
  {
    slug: "aria",
    name: "Aria",
    role: "24/7 voice receptionist",
    tagline: "Picks up every call. Books showings while you sleep.",
    bullets: [
      "12-second average pickup, day or night",
      "Qualifies buyers, sellers, renters in-call",
      "Books showings + valuations directly to your calendar",
      "TCPA-safe two-party recording where required",
    ],
    avatar: "/images/agents/aria.png",
    accent: "indigo",
  },
  {
    slug: "theo",
    name: "Theo",
    role: "SMS sales agent",
    tagline: "First text in under 60 seconds. Two-way conversations until booked.",
    bullets: [
      "Sub-60-second response on every form fill",
      "Multi-step nurture until booked or opted out",
      "Reactivates dormant CRM contacts on demand",
      "STOP-compliant, written consent only",
    ],
    avatar: "/images/agents/theo.png",
    accent: "cyan",
  },
  {
    slug: "iris",
    name: "Iris",
    role: "Email assistant",
    tagline: "Listing-aware replies that turn buyer inquiries into seller valuations.",
    bullets: [
      "Reads every inbound email, answers in your voice",
      "Detects seller signal in buyer inquiries",
      "Books valuation appointments automatically",
      "Logs every thread in your CRM",
    ],
    avatar: "/images/agents/iris.png",
    accent: "gold",
  },
];
```

- [ ] **Step 6.3: `content/timeline.ts`** — 30-day timeline

```ts
export type TimelineWeek = {
  week: string;
  kicker: string;
  title: string;
  body: string;
};

export const timeline: TimelineWeek[] = [
  {
    week: "WEEK 01",
    kicker: "Foundation",
    title: "Audit + workflow map.",
    body: "We trace one real lead path end-to-end. Field-by-field, message-by-message, owner-by-owner. The first leak gets named.",
  },
  {
    week: "WEEK 02",
    kicker: "Build",
    title: "CRM cleanup + agent training.",
    body: "Olivia, Aria, Theo, and Iris learn your market, your scripts, your inventory, your hours. Your CRM gets the fields it should have had on day one.",
  },
  {
    week: "WEEK 03",
    kicker: "Launch",
    title: "Phones, email, and SMS go live.",
    body: "Inbound calls answered in 12 seconds. Texts in under 60. Emails replied to with property context. You watch the dashboard fill up.",
  },
  {
    week: "WEEK 04",
    kicker: "Optimize",
    title: "Scale + report.",
    body: "Weekly performance review. Tighten what works. Cut what does not. Add a second voice agent or expand to a new niche.",
  },
];
```

- [ ] **Step 6.4: `content/pricing.ts`** — two paths

```ts
export type PricingPath = {
  slug: "build" | "scale";
  label: string;
  starting: string;
  pitch: string;
  bullets: string[];
  popular?: boolean;
};

export const pricingPaths: PricingPath[] = [
  {
    slug: "build",
    label: "Build with us",
    starting: "Starts at $X",
    pitch: "For solo agents and small teams installing their first AI front desk.",
    bullets: [
      "One-time install of voice + email + SMS agents",
      "Workflow mapped to your CRM",
      "30-day launch sprint",
      "Two weeks of optimization included",
    ],
  },
  {
    slug: "scale",
    label: "Scale with us",
    starting: "Starts at $Y/mo",
    pitch: "For brokerages, property management, and multi-location teams.",
    bullets: [
      "Everything in Build",
      "Per-agent + per-location coverage",
      "Monthly performance review with Martin",
      "Lead recovery sweep on dormant CRM contacts",
      "Priority new-agent buildouts",
    ],
    popular: true,
  },
];
```

> **Open item:** real `$X` and `$Y` from Martin before launch. Placeholder strings ship in v1 preview.

- [ ] **Step 6.5: `content/faq.ts`** — 10 Q&A

```ts
export type FaqItem = { q: string; a: string };

export const faq: FaqItem[] = [
  {
    q: "What does this actually cost?",
    a: "Two paths. Build with us starts at $X for a one-time install. Scale with us starts at $Y per month for ongoing coverage. The strategy call walks through which one fits.",
  },
  {
    q: "How long until it is running?",
    a: "Thirty days from kickoff. Week one audit, week two build, week three launch, week four optimize. Most teams see first booked appointments inside week three.",
  },
  {
    q: "Which CRMs do you integrate with?",
    a: "Follow Up Boss, Lofty, KvCORE, Sierra, HubSpot, Salesforce, GoHighLevel, Google Sheets. If your CRM has an API, we connect it.",
  },
  {
    q: "Is this TCPA safe?",
    a: "Yes. We collect prior express written consent through your existing forms, store the consent record, honor STOP and HELP, and never message outside your opted-in audience. We are not legal counsel—your compliance officer signs off before launch.",
  },
  {
    q: "What happens if the AI gets a question wrong?",
    a: "Aria, Theo, and Iris escalate to a human owner the moment confidence drops. You see every escalation in the dashboard with full transcript. Iteration happens in the weekly review.",
  },
  {
    q: "Can I cancel?",
    a: "Build is one-time so there is nothing to cancel. Scale is month-to-month. Thirty days notice, no penalty, no clawback.",
  },
  {
    q: "Do my agents need to be trained?",
    a: "No. The AI agents handle the volume. Your humans handle the conversion meetings. We train you on the dashboard in one 30-minute session.",
  },
  {
    q: "Will my brokerage approve this?",
    a: "We hand you a one-page compliance summary covering recording, retention, consent, and Fair Housing language. We have not had a brokerage say no when the document is in front of their attorney.",
  },
  {
    q: "Can I run multiple AI agents at once?",
    a: "Yes. Olivia + Aria + Theo + Iris is the standard four. Add a second voice line for after-hours or a Spanish-language agent on request.",
  },
  {
    q: "What if I am not a fit?",
    a: "Then the strategy call ends with us telling you exactly what to do instead. No upsell, no pressure. We turn down more clients than we take.",
  },
];
```

- [ ] **Step 6.6: `content/case-studies.ts`** — placeholder quotes

```ts
export type CaseStudy = {
  category: "booking" | "revenue" | "speed";
  metric: string;
  quote: string;
  attribution: string;
};

export const caseStudies: CaseStudy[] = [
  {
    category: "booking",
    metric: "+7 transactions in 90 days",
    quote: "Aria booked more showings on a Saturday than my ISA did all week.",
    attribution: "Real Estate Team, Austin TX",
  },
  {
    category: "revenue",
    metric: "37% lift in conversion",
    quote: "We stopped buying more leads and started closing the ones we had.",
    attribution: "Brokerage Owner, Phoenix AZ",
  },
  {
    category: "speed",
    metric: "12-second avg pickup",
    quote: "By the time my competitor calls back, the appointment is on my calendar.",
    attribution: "Solo Agent, Houston TX",
  },
  {
    category: "booking",
    metric: "163% more weekend showings",
    quote: "Iris turned three buyer emails into a listing the same week.",
    attribution: "Real Estate Pro, Dallas TX",
  },
  {
    category: "speed",
    metric: "Sub-60s text response",
    quote: "Theo answered before I knew the lead came in.",
    attribution: "Property Manager, San Antonio TX",
  },
  {
    category: "revenue",
    metric: "+$420k closed pipeline",
    quote: "The recovery sweep on our old CRM list paid for the year.",
    attribution: "Investor, Atlanta GA",
  },
];
```

- [ ] **Step 6.7: `content/trust-logos.ts`** — RE-specific authority

```ts
export type TrustLogo = { label: string; src: string; alt: string };

export const trustLogos: TrustLogo[] = [
  { label: "NAR", src: "/images/trust/nar.svg", alt: "National Association of Realtors" },
  { label: "Zillow Premier", src: "/images/trust/zillow-premier.svg", alt: "Zillow Premier Agent" },
  { label: "Realtor.com", src: "/images/trust/realtor-com.svg", alt: "Realtor.com partner" },
  { label: "MLS Ready", src: "/images/trust/mls-ready.svg", alt: "MLS-ready integration" },
  { label: "Stripe", src: "/images/trust/stripe.svg", alt: "Secure payments via Stripe" },
];
```

> **Open item:** real brokerage logos (RE/MAX, KW, Compass, etc.) only when Martin confirms client relationships exist. Default to NAR/Zillow/Realtor.com (everyone-in-RE-knows) until then.

- [ ] **Step 6.8: Commit**

```bash
git add content
git commit -m "feat: content data files (agents, timeline, pricing, faq, case studies, trust logos, niches)"
```

---

## Task 7: Topbar component

**Files:**
- Create: `components/sections/topbar.tsx`

- [ ] **Step 7.1: Build topbar**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg-cream/85 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 w-[min(1200px,calc(100%-32px))] items-center justify-between gap-4">
        <Link
          href="#top"
          className="inline-flex items-center gap-2 font-display text-lg font-semibold text-ink-charcoal"
        >
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg bg-primary-indigo text-white"
          >
            L
          </span>
          <span>Lumenosis AI</span>
        </Link>
        <nav aria-label="Page" className="hidden items-center gap-6 text-sm text-muted md:flex">
          <a href="#method" className="hover:text-ink-charcoal">
            Method
          </a>
          <a href="#agents" className="hover:text-ink-charcoal">
            Agents
          </a>
          <a href="#process" className="hover:text-ink-charcoal">
            Process
          </a>
          <a href="#faq" className="hover:text-ink-charcoal">
            FAQ
          </a>
        </nav>
        <Button asChild size="sm">
          <a href="#book">Book a strategy call</a>
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 7.2: Mobile QA**

Run `pnpm dev`, open `http://localhost:3000` at 360px width (Chrome DevTools device toolbar). Confirm:
- Logo + brand name visible
- Nav hidden under 768px (`md` breakpoint)
- CTA button still visible + tappable
- No horizontal scroll

- [ ] **Step 7.3: Commit**

```bash
git add components/sections/topbar.tsx
git commit -m "feat(section): sticky topbar with mobile-collapsed nav"
```

---

## Task 8: RotatingText utility component

**Files:**
- Create: `components/rotating-text.tsx`

- [ ] **Step 8.1: Implement crossfade rotation**

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

export function RotatingText({
  words,
  intervalMs = 2500,
  className,
}: {
  words: readonly string[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % words.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [words.length, intervalMs, reduce]);

  return (
    <span
      className={`relative inline-block align-baseline ${className ?? ""}`}
      style={{ minWidth: "8ch" }}
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={words[index]}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="inline-block"
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
```

- [ ] **Step 8.2: Commit**

```bash
git add components/rotating-text.tsx
git commit -m "feat: RotatingText component with reduced-motion support"
```

---

## Task 9: GlassStatCallout utility component

**Files:**
- Create: `components/glass-stat-callout.tsx`

- [ ] **Step 9.1: Implement floating glassmorphism callout**

```tsx
export function GlassStatCallout({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none rounded-xl border border-white/15 bg-white/85 px-4 py-3 text-ink-charcoal shadow-[var(--shadow-soft)] backdrop-blur-md ${className ?? ""}`}
    >
      <div className="text-[15px] font-semibold leading-tight">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
```

- [ ] **Step 9.2: Commit**

```bash
git add components/glass-stat-callout.tsx
git commit -m "feat: GlassStatCallout for floating stat tiles"
```

---

## Task 10: Hero section

**Files:**
- Create: `components/sections/hero.tsx`

- [ ] **Step 10.1: Invoke frontend-design skill for hero composition**

Brief: "Hero for Lumenosis landing. Spec §6.1. ScaleYourClinic-style split. Confirm spacing + image card composition + glassmorphism callout positions for desktop + mobile."

- [ ] **Step 10.2: Build hero**

```tsx
import { Button } from "@/components/ui/button";
import { GlassStatCallout } from "@/components/glass-stat-callout";
import { RotatingText } from "@/components/rotating-text";
import { niches } from "@/content/niches";
import Image from "next/image";

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden border-b border-line bg-gradient-to-b from-white to-bg-cream pb-12 pt-14 md:pt-20"
    >
      <div className="mx-auto grid w-[min(1200px,calc(100%-32px))] items-start gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-12">
        <div>
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            5.0 from 50+ verified real estate professionals
          </p>
          <h1 className="font-display text-display-hero font-semibold leading-[1.04] tracking-tight text-ink-charcoal">
            AI agents for your{" "}
            <RotatingText
              words={niches}
              className="italic text-gold-italic"
            />{" "}
            team.
          </h1>
          <p className="mt-5 max-w-xl text-body-lg leading-snug text-muted">
            Olivia answers your website. Aria answers the phone. Theo texts every lead in
            under sixty seconds. Iris turns inbound emails into booked valuations.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href="#book">Book a strategy call</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#vsl">Watch 90s overview</a>
            </Button>
          </div>
        </div>

        <div className="relative aspect-[4/5] w-full max-w-[460px] justify-self-center md:max-w-none">
          <div className="relative h-full w-full overflow-hidden rounded-2xl bg-dark-section">
            <Image
              src="/images/product-card-mockup.png"
              alt="Lumenosis AI dashboard with CRM, iMessage thread, and booked appointment"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 460px"
              className="object-cover"
            />
          </div>
          <GlassStatCallout
            label="Avg response"
            value="60 seconds"
            className="absolute -left-3 top-8 md:-left-6"
          />
          <GlassStatCallout
            label="More bookings"
            value="+300%"
            className="absolute -right-3 top-1/2 md:-right-8"
          />
          <GlassStatCallout
            label="Coverage"
            value="24 / 7"
            className="absolute -bottom-4 left-12 md:-bottom-6"
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 10.3: Add product mockup placeholder**

```bash
mkdir -p public/images
# Generate or drop a placeholder. For v1, use a 920x1150 dark gradient block until real mockup is shot.
# Quick placeholder via Bash:
node -e "
const fs = require('fs');
const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('public/images/product-card-mockup.png', buf);
"
```

> **Open item:** Martin to provide real product card screenshot (1840x2300 PNG).

- [ ] **Step 10.4: Mobile + tablet + desktop QA**

Open `http://localhost:3000` at 360px, 768px, 1280px. Confirm:
- 360px: stacked, hero text first, image card second, callouts visible
- 768px: side-by-side, image card right, all 3 callouts positioned
- 1280px: full width, generous spacing
- No horizontal scroll at any width

- [ ] **Step 10.5: Commit**

```bash
git add -A
git commit -m "feat(section): hero with rotating-niche headline and glass stat callouts"
```

---

## Task 11: TrustStrip section

**Files:**
- Create: `components/sections/trust-strip.tsx`

- [ ] **Step 11.1: Build strip**

```tsx
import Image from "next/image";
import { trustLogos } from "@/content/trust-logos";

export function TrustStrip() {
  return (
    <section
      aria-label="Trust signals"
      className="border-b border-line bg-bg-cream py-6"
    >
      <div className="mx-auto flex w-[min(1200px,calc(100%-32px))] flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {trustLogos.map((logo) => (
          <div
            key={logo.label}
            className="grid size-12 place-items-center opacity-70 grayscale transition-opacity hover:opacity-100 hover:grayscale-0"
          >
            <Image
              src={logo.src}
              alt={logo.alt}
              width={120}
              height={40}
              className="h-7 w-auto"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 11.2: Add placeholder SVGs**

```bash
mkdir -p public/images/trust
for name in nar zillow-premier realtor-com mls-ready stripe; do
  cat > "public/images/trust/$name.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">
  <rect width="120" height="40" fill="none"/>
  <text x="60" y="25" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" fill="#52615b">$name</text>
</svg>
EOF
done
```

> **Open item:** real logos (NAR, Zillow Premier, Realtor.com, MLS-Ready, Stripe) when licensing confirmed.

- [ ] **Step 11.3: Mobile QA + commit**

Confirm strip wraps on mobile at 360px, all 5 logos visible. Then:

```bash
git add -A
git commit -m "feat(section): trust-strip with placeholder logos"
```

---

## Task 12: FounderVSL section

**Files:**
- Create: `components/sections/founder-vsl.tsx`

- [ ] **Step 12.1: Invoke frontend-design skill**

Brief: "Founder VSL section. Editorial bullet list left, video player right, ScaleYourClinic style. Mobile stacks video on top. Lock spacing + bullet rhythm."

- [ ] **Step 12.2: Build component**

```tsx
import Image from "next/image";

export function FounderVSL() {
  return (
    <section id="vsl" className="border-b border-line bg-white py-20">
      <div className="mx-auto grid w-[min(1200px,calc(100%-32px))] items-center gap-10 md:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            01 — Why this matters
          </p>
          <h2 className="font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
            Why most agents are losing to faster competitors in 2026 —{" "}
            <em className="text-gold-italic">and what to do instead.</em>
          </h2>
          <ul className="mt-6 grid gap-3 text-muted">
            <li className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-violet" />
              <span>Speed-to-lead beats lead volume every time.</span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-violet" />
              <span>Most teams already have leads. They lose them to slow follow-up.</span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-violet" />
              <span>AI agents are not a chatbot. They are a front desk.</span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-violet" />
              <span>Done right, the first booked appointment lands inside week three.</span>
            </li>
          </ul>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-dark-section shadow-[var(--shadow-soft)]">
          <Image
            src="/images/martin-vsl-poster.jpg"
            alt="Martin Ofunrein on Lumenosis AI strategy for real estate"
            fill
            sizes="(max-width: 768px) 100vw, 700px"
            className="object-cover"
          />
          <button
            type="button"
            aria-label="Play overview video"
            className="absolute inset-0 grid place-items-center text-white"
          >
            <span className="grid size-20 place-items-center rounded-full bg-brand-violet/90 shadow-[var(--shadow-glow-violet)]">
              <svg viewBox="0 0 24 24" className="size-8" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 12.3: Add placeholder poster + wire real video later**

```bash
node -e "
const fs = require('fs');
const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('public/images/martin-vsl-poster.jpg', buf);
"
```

> **Open item:** Martin records 60-90s VSL. Wire `<video>` element with `poster` attr + Mux/Vimeo embed when ready.

- [ ] **Step 12.4: QA + commit**

Mobile + tablet + desktop check. Then:

```bash
git add -A
git commit -m "feat(section): founder VSL with bullet list and play-button poster"
```

---

## Task 13: ProblemAgitation section

**Files:**
- Create: `components/sections/problem-agitation.tsx`

- [ ] **Step 13.1: Invoke frontend-design skill** for 3-card grid + mobile collapse pattern.

- [ ] **Step 13.2: Build**

```tsx
const leaks = [
  {
    n: "01",
    title: "Slow first response",
    body: "Portal leads, missed calls, and form submits sit while the prospect keeps searching.",
  },
  {
    n: "02",
    title: "Weak qualification",
    body: "The team does not capture timeline, intent, financing, property type, or next step cleanly.",
  },
  {
    n: "03",
    title: "No visible owner",
    body: "Leads enter the CRM. Nobody can see who owns the next action or when it is due.",
  },
];

export function ProblemAgitation() {
  return (
    <section id="method" className="border-b border-line bg-bg-cream py-20">
      <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
        <div className="max-w-2xl">
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            02 — The leak
          </p>
          <h2 className="font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
            The expensive leaks{" "}
            <em className="text-gold-italic">are not ad spend.</em>
          </h2>
          <p className="mt-4 text-body-lg text-muted">
            You already have leads. You already have a CRM. The leak is the missing operating
            layer between them. Every minute a lead waits costs five hundred to two thousand
            dollars in eventual deal value.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {leaks.map((leak) => (
            <article
              key={leak.n}
              className="rounded-xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]"
            >
              <div className="mb-3 grid size-9 place-items-center rounded-lg bg-brand-violet-soft text-sm font-bold text-brand-violet">
                {leak.n}
              </div>
              <h3 className="font-display text-xl font-semibold text-ink-charcoal">
                {leak.title}
              </h3>
              <p className="mt-2 text-muted">{leak.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 13.3: Mobile QA + commit**

```bash
git add components/sections/problem-agitation.tsx
git commit -m "feat(section): problem agitation 3-card grid"
```

---

## Task 14: AgentPersonaCard + MeetTheTeam section

**Files:**
- Create: `components/agent-persona-card.tsx`, `components/sections/meet-the-team.tsx`

- [ ] **Step 14.1: Invoke frontend-design skill** for persona card + 4-card grid responsive pattern.

- [ ] **Step 14.2: AgentPersonaCard**

```tsx
import Image from "next/image";
import type { Agent } from "@/content/agents";

const accentClass: Record<Agent["accent"], string> = {
  violet: "bg-brand-violet/10 text-brand-violet",
  indigo: "bg-primary-indigo/10 text-primary-indigo",
  gold: "bg-gold-italic/15 text-gold-italic",
  cyan: "bg-cyan-500/10 text-cyan-700",
};

export function AgentPersonaCard({ agent }: { agent: Agent }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
      <div className="relative mx-auto mb-5 size-28 overflow-hidden rounded-full bg-bg-cream">
        <Image
          src={agent.avatar}
          alt={`${agent.name} avatar`}
          fill
          sizes="120px"
          className="object-cover"
        />
      </div>
      <span
        className={`mx-auto mb-3 inline-block rounded-full px-3 py-1 text-eyebrow font-semibold uppercase tracking-wider ${accentClass[agent.accent]}`}
      >
        {agent.role}
      </span>
      <h3 className="text-center font-display text-2xl font-semibold text-ink-charcoal">
        {agent.name}
      </h3>
      <p className="mt-2 text-center text-muted">{agent.tagline}</p>
      <ul className="mt-5 grid gap-2 text-sm text-muted">
        {agent.bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-violet" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
```

- [ ] **Step 14.3: MeetTheTeam section**

```tsx
import { AgentPersonaCard } from "@/components/agent-persona-card";
import { agents } from "@/content/agents";

export function MeetTheTeam() {
  return (
    <section id="agents" className="border-b border-line bg-white py-20">
      <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
        <div className="max-w-2xl">
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            03 — The team
          </p>
          <h2 className="font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
            Meet your <em className="text-gold-italic">new team.</em>
          </h2>
          <p className="mt-4 text-body-lg text-muted">
            Four named AI agents with one job each. Trained on your market, your inventory,
            your hours, and your CRM.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {agents.map((a) => (
            <AgentPersonaCard key={a.slug} agent={a} />
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 14.4: Avatar placeholders**

```bash
mkdir -p public/images/agents
for slug in olivia aria theo iris; do
  node -e "
const fs = require('fs');
const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('public/images/agents/$slug.png', buf);
"
done
```

> **Open item:** real agent avatar art. Recommend abstract/glyph style — not 3D mannequins (per spec §4 patterns rejected).

- [ ] **Step 14.5: Mobile QA**

360px = single column, 768px = 2 columns, 1024px = 4 columns. Then commit:

```bash
git add -A
git commit -m "feat(section): meet-the-team grid with 4 agent persona cards"
```

---

## Task 15: PhoneMockup + AriaDeepDive section

**Files:**
- Create: `components/phone-mockup.tsx`, `components/sections/aria-deep-dive.tsx`

- [ ] **Step 15.1: Invoke frontend-design skill** for phone-mockup design + dark section composition.

- [ ] **Step 15.2: PhoneMockup component**

```tsx
type Bubble = { from: "agent" | "ai"; text: string };

export function PhoneMockup({ name, role, bubbles }: { name: string; role: string; bubbles: Bubble[] }) {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[36px] border border-white/10 bg-[#0a1410] p-5 shadow-[var(--shadow-glow-violet)]">
      <div className="flex items-center gap-3 border-b border-white/5 pb-3">
        <div className="grid size-9 place-items-center rounded-full bg-brand-violet/30 font-display font-semibold text-white">
          A
        </div>
        <div>
          <div className="font-semibold text-white">{name}</div>
          <div className="text-xs text-white/55">{role}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="size-2 rounded-full bg-emerald-400" />
          On call · 02:14
        </div>
      </div>
      <div className="mt-4 grid gap-2.5">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
              b.from === "ai"
                ? "self-end bg-brand-violet/85 text-white"
                : "self-start bg-white/[0.07] text-white/90"
            }`}
          >
            {b.text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 15.3: AriaDeepDive section**

```tsx
import { PhoneMockup } from "@/components/phone-mockup";

const bubbles = [
  { from: "agent" as const, text: "Hi, calling about 412 Oak — is it still available?" },
  {
    from: "ai" as const,
    text: "It is. Three bed, two bath, 1,840 sq ft, listed at $529k. Are you looking to buy in the next sixty days?",
  },
  { from: "agent" as const, text: "Yeah, also need to sell my current place first." },
  {
    from: "ai" as const,
    text: "Got it. I can book a free home valuation with our agent this week. Tuesday at 4pm or Thursday at 10am?",
  },
  { from: "agent" as const, text: "Tuesday works." },
  {
    from: "ai" as const,
    text: "Booked. You’ll get a confirmation text in a moment. Anything else?",
  },
];

const features = [
  { title: "12-second pickup", body: "Average answer time, day or night." },
  { title: "Direct booking", body: "Slots into your calendar, not someone else’s." },
  { title: "TCPA-safe", body: "Two-party consent recording where required." },
  { title: "Encrypted", body: "Call data encrypted in transit and at rest." },
];

export function AriaDeepDive() {
  return (
    <section className="bg-dark-section py-24 text-white">
      <div className="mx-auto grid w-[min(1200px,calc(100%-32px))] items-center gap-12 md:grid-cols-[1fr_1fr]">
        <div>
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            04 — AI Receptionist
          </p>
          <h2 className="font-display text-display-section font-semibold leading-[1.05]">
            The front desk that <em className="text-gold-italic">never sleeps</em> and never asks
            for a raise.
          </h2>
          <p className="mt-5 text-body-lg text-white/70">
            It is 9:47 in the morning. Three valuations are booked. You have not checked your
            email once. Aria handled the phone for you.
          </p>
          <dl className="mt-8 grid gap-5 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.title}>
                <dt className="font-semibold text-white">{f.title}</dt>
                <dd className="mt-1 text-sm text-white/65">{f.body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <PhoneMockup name="Aria" role="Lumenosis voice receptionist" bubbles={bubbles} />
      </div>
    </section>
  );
}
```

- [ ] **Step 15.4: Mobile QA + commit**

```bash
git add -A
git commit -m "feat(section): aria-deep-dive dark section with phone-mockup"
```

---

## Task 16: Timeline30Day section

**Files:**
- Create: `components/sections/timeline-30day.tsx`

- [ ] **Step 16.1: Build**

```tsx
import { timeline } from "@/content/timeline";

export function Timeline30Day() {
  return (
    <section id="process" className="border-b border-line bg-bg-cream py-20">
      <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
        <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
          05 — Process
        </p>
        <h2 className="max-w-3xl font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
          Thirty days to a <em className="text-gold-italic">fully running system.</em>
        </h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-4">
          {timeline.map((w, i) => (
            <li key={w.week} className="relative">
              <div className="mb-4 flex items-center gap-3">
                <span
                  aria-hidden
                  className={`size-3 rounded-full ${i === 1 ? "bg-gold-italic" : "border border-line bg-white"}`}
                />
                <span className="text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted">
                  {w.week} · {w.kicker}
                </span>
              </div>
              <h3 className="font-display text-xl font-semibold text-ink-charcoal">
                {w.title}
              </h3>
              <p className="mt-2 text-sm text-muted">{w.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 16.2: Mobile QA + commit**

```bash
git add components/sections/timeline-30day.tsx
git commit -m "feat(section): 30-day editorial timeline"
```

---

## Task 17: TwoWaysIn section

**Files:**
- Create: `components/sections/two-ways-in.tsx`

- [ ] **Step 17.1: Build**

```tsx
import { Button } from "@/components/ui/button";
import { pricingPaths } from "@/content/pricing";

export function TwoWaysIn() {
  return (
    <section className="border-b border-line bg-white py-20">
      <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
        <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
          06 — Programs
        </p>
        <h2 className="max-w-3xl font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
          Two ways in. <em className="text-gold-italic">One destination.</em>
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {pricingPaths.map((p) => (
            <article
              key={p.slug}
              className="relative rounded-2xl border border-line bg-bg-cream p-7 shadow-[var(--shadow-soft)]"
            >
              {p.popular ? (
                <span className="absolute -top-3 right-6 rounded-full bg-gold-italic px-3 py-1 text-eyebrow font-semibold uppercase tracking-wider text-white">
                  Best fit
                </span>
              ) : null}
              <h3 className="font-display text-2xl font-semibold text-ink-charcoal">{p.label}</h3>
              <p className="mt-1 text-eyebrow font-semibold uppercase tracking-[0.14em] text-brand-violet">
                {p.starting}
              </p>
              <p className="mt-3 text-muted">{p.pitch}</p>
              <ul className="mt-5 grid gap-2 text-sm text-muted">
                {p.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-violet" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-7 w-full">
                <a href="#book">Book a strategy call</a>
              </Button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 17.2: Mobile QA + commit**

```bash
git add components/sections/two-ways-in.tsx
git commit -m "feat(section): two-ways-in pricing fork"
```

---

## Task 18: CaseStudyWall section

**Files:**
- Create: `components/sections/case-study-wall.tsx`

- [ ] **Step 18.1: Build with shadcn Tabs**

```tsx
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { caseStudies } from "@/content/case-studies";

const labels = {
  booking: "Booking volume",
  revenue: "Revenue",
  speed: "Speed-to-lead",
} as const;

export function CaseStudyWall() {
  return (
    <section className="border-b border-line bg-bg-cream py-20">
      <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
        <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
          07 — Results
        </p>
        <h2 className="max-w-3xl font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
          Don’t just take our word for it.
        </h2>
        <Tabs defaultValue="booking" className="mt-8">
          <TabsList className="flex flex-wrap gap-2 bg-transparent p-0">
            {Object.entries(labels).map(([k, v]) => (
              <TabsTrigger
                key={k}
                value={k}
                className="rounded-full border border-line bg-white px-4 py-2 text-sm data-[state=active]:bg-primary-indigo data-[state=active]:text-white"
              >
                {v}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(labels) as Array<keyof typeof labels>).map((cat) => (
            <TabsContent key={cat} value={cat} className="mt-6 grid gap-4 md:grid-cols-3">
              {caseStudies
                .filter((c) => c.category === cat)
                .map((c) => (
                  <article
                    key={c.quote}
                    className="rounded-xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]"
                  >
                    <p className="font-display text-lg font-semibold text-brand-violet">
                      {c.metric}
                    </p>
                    <blockquote className="mt-3 text-muted">“{c.quote}”</blockquote>
                    <p className="mt-3 text-sm text-muted/80">— {c.attribution}</p>
                  </article>
                ))}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
```

- [ ] **Step 18.2: Mobile QA + commit**

```bash
git add components/sections/case-study-wall.tsx
git commit -m "feat(section): case-study-wall with tabbed quotes"
```

---

## Task 19: FilloutEmbed component

**Files:**
- Create: `components/fillout-embed.tsx`

- [ ] **Step 19.1: Build wrapper**

```tsx
"use client";

import { FilloutStandardEmbed } from "@fillout/react";
import "@fillout/react/style.css";

export function FilloutEmbed({ formId }: { formId: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-soft)]">
      <FilloutStandardEmbed filloutId={formId} dynamicResize inheritParameters />
    </div>
  );
}
```

- [ ] **Step 19.2: Commit**

```bash
git add components/fillout-embed.tsx
git commit -m "feat: Fillout embed wrapper"
```

---

## Task 20: GhlCalendar component

**Files:**
- Create: `components/ghl-calendar.tsx`

- [ ] **Step 20.1: Build iframe wrapper**

```tsx
export function GhlCalendar({ embedUrl, title }: { embedUrl: string; title: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-soft)]">
      <iframe
        title={title}
        src={embedUrl}
        loading="lazy"
        className="block min-h-[720px] w-full"
        allow="payment"
      />
    </div>
  );
}
```

- [ ] **Step 20.2: Commit**

```bash
git add components/ghl-calendar.tsx
git commit -m "feat: GHL calendar iframe wrapper"
```

---

## Task 21: CalendarCTA section

**Files:**
- Create: `components/sections/calendar-cta.tsx`

- [ ] **Step 21.1: Build**

```tsx
import { FilloutEmbed } from "@/components/fillout-embed";
import { GhlCalendar } from "@/components/ghl-calendar";

export function CalendarCTA() {
  const formId = process.env.NEXT_PUBLIC_FILLOUT_FORM_ID ?? "";
  const embedUrl = process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL ?? "";

  return (
    <section id="book" className="border-b border-line bg-white py-20">
      <div className="mx-auto grid w-[min(1200px,calc(100%-32px))] items-start gap-10 md:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            08 — Book
          </p>
          <h2 className="font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
            A 30-minute conversation that’s <em className="text-gold-italic">actually worth your time.</em>
          </h2>
          <ul className="mt-6 grid gap-3 text-muted">
            <li>You walk through your one biggest leak.</li>
            <li>We map the smallest useful workflow to fix it.</li>
            <li>You leave with a build path, not a sales pitch.</li>
            <li>Not a fit? We tell you exactly what to do instead.</li>
          </ul>
        </div>
        <div className="grid gap-5">
          {formId ? (
            <FilloutEmbed formId={formId} />
          ) : (
            <div className="rounded-2xl border border-line bg-bg-cream p-6 text-muted">
              Form embed is configured via NEXT_PUBLIC_FILLOUT_FORM_ID env var.
            </div>
          )}
          {embedUrl ? (
            <GhlCalendar embedUrl={embedUrl} title="Lumenosis AI strategy call calendar" />
          ) : null}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 21.2: Mobile QA + commit**

```bash
git add components/sections/calendar-cta.tsx
git commit -m "feat(section): calendar-cta with Fillout + GHL embeds"
```

---

## Task 22: FAQ section

**Files:**
- Create: `components/sections/faq.tsx`

- [ ] **Step 22.1: Build with shadcn Accordion**

```tsx
"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { faq } from "@/content/faq";

export function Faq() {
  return (
    <section id="faq" className="border-b border-line bg-bg-cream py-20">
      <div className="mx-auto grid w-[min(1200px,calc(100%-32px))] gap-10 md:grid-cols-[0.6fr_1fr]">
        <div>
          <p className="mb-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-gold-italic">
            09 — FAQ
          </p>
          <h2 className="font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
            Questions <em className="text-gold-italic">we get every week.</em>
          </h2>
        </div>
        <Accordion type="single" collapsible className="w-full">
          {faq.map((item, i) => (
            <AccordionItem key={item.q} value={`q-${i}`} className="border-line">
              <AccordionTrigger className="text-left font-display text-lg text-ink-charcoal">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
```

- [ ] **Step 22.2: Commit**

```bash
git add components/sections/faq.tsx
git commit -m "feat(section): faq accordion 2-col"
```

---

## Task 23: FinalCTA + PullQuote sections

**Files:**
- Create: `components/sections/final-cta.tsx`, `components/sections/pull-quote.tsx`

- [ ] **Step 23.1: FinalCTA**

```tsx
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  return (
    <section className="border-b border-line bg-bg-cream py-24 text-center">
      <div className="mx-auto w-[min(900px,calc(100%-32px))]">
        <h2 className="font-display text-display-section font-semibold leading-[1.05] text-ink-charcoal">
          Have a thirty-minute conversation that’s{" "}
          <em className="text-gold-italic">actually worth your time.</em>
        </h2>
        <Button asChild size="lg" className="mt-8">
          <a href="#book">Book a strategy call</a>
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 23.2: PullQuote**

```tsx
export function PullQuote() {
  return (
    <section className="bg-white py-20">
      <figure className="mx-auto w-[min(900px,calc(100%-32px))] text-center">
        <blockquote className="font-display text-2xl italic leading-snug text-ink-charcoal md:text-3xl">
          “I used to chase leads. Now I show up to appointments that already exist.”
        </blockquote>
        <figcaption className="mt-5 text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted">
          — Real Estate Professional, Austin TX
        </figcaption>
      </figure>
    </section>
  );
}
```

- [ ] **Step 23.3: Commit**

```bash
git add components/sections/final-cta.tsx components/sections/pull-quote.tsx
git commit -m "feat(section): final-cta + pull-quote"
```

---

## Task 24: Footer + StickyCtaBar

**Files:**
- Create: `components/sections/footer.tsx`, `components/sections/sticky-cta-bar.tsx`

- [ ] **Step 24.1: Footer**

```tsx
import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-bg-cream py-10 text-sm text-muted">
      <div className="mx-auto flex w-[min(1200px,calc(100%-32px))] flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg bg-primary-indigo text-white">
            L
          </span>
          <span>© {new Date().getFullYear()} Lumenosis AI</span>
        </div>
        <nav className="flex flex-wrap gap-5">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="#book">Book a call</a>
          <a href="mailto:hello@lumenosis.ai">Email</a>
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 24.2: StickyCtaBar**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function StickyCtaBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.9);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!show}
      className={`fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-[var(--shadow-soft)] transition-all md:inset-x-0 md:bottom-5 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <span className="text-sm font-medium text-ink-charcoal">
        Ready to scale? Book your strategy call.
      </span>
      <Button asChild size="sm">
        <a href="#book">Book →</a>
      </Button>
    </div>
  );
}
```

- [ ] **Step 24.3: Commit**

```bash
git add components/sections/footer.tsx components/sections/sticky-cta-bar.tsx
git commit -m "feat(section): footer + sticky-cta-bar"
```

---

## Task 25: TrustStrip + StatTrio (consolidated under hero)

**Files:**
- Modify: `components/sections/hero.tsx` (already has stat callouts inline)
- Existing: `components/sections/trust-strip.tsx`

> Stat trio rolled into hero glassmorphism callouts (Task 10). Trust-strip already built (Task 11). Skip — confirm both render in compose step.

---

## Task 26: Compose landing page

**Files:**
- Create: `app/page.tsx`

- [ ] **Step 26.1: Compose all sections**

```tsx
import { AriaDeepDive } from "@/components/sections/aria-deep-dive";
import { CalendarCTA } from "@/components/sections/calendar-cta";
import { CaseStudyWall } from "@/components/sections/case-study-wall";
import { Faq } from "@/components/sections/faq";
import { FinalCTA } from "@/components/sections/final-cta";
import { Footer } from "@/components/sections/footer";
import { FounderVSL } from "@/components/sections/founder-vsl";
import { Hero } from "@/components/sections/hero";
import { MeetTheTeam } from "@/components/sections/meet-the-team";
import { ProblemAgitation } from "@/components/sections/problem-agitation";
import { PullQuote } from "@/components/sections/pull-quote";
import { StickyCtaBar } from "@/components/sections/sticky-cta-bar";
import { Timeline30Day } from "@/components/sections/timeline-30day";
import { Topbar } from "@/components/sections/topbar";
import { TrustStrip } from "@/components/sections/trust-strip";
import { TwoWaysIn } from "@/components/sections/two-ways-in";

export default function Page() {
  return (
    <>
      <Topbar />
      <main>
        <Hero />
        <TrustStrip />
        <FounderVSL />
        <ProblemAgitation />
        <MeetTheTeam />
        <AriaDeepDive />
        <Timeline30Day />
        <TwoWaysIn />
        <CaseStudyWall />
        <CalendarCTA />
        <Faq />
        <FinalCTA />
        <PullQuote />
      </main>
      <Footer />
      <StickyCtaBar />
    </>
  );
}
```

- [ ] **Step 26.2: Boot + smoke test**

```bash
pnpm dev
```

Open `http://localhost:3000`. Confirm all sections render top to bottom, no console errors, smooth scroll between anchor links.

- [ ] **Step 26.3: Mobile + tablet + desktop pass**

DevTools at 360 / 768 / 1280 widths. For each width:
- No horizontal scroll
- All sections stack/flow correctly
- Tappable targets min 44px
- All text readable (no overflow)

- [ ] **Step 26.4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: compose landing page from all section components"
```

---

## Task 27: /privacy MDX page

**Files:**
- Create: `app/privacy/page.mdx`, `mdx-components.tsx`
- Modify: `next.config.ts`

- [ ] **Step 27.1: Enable MDX**

```bash
pnpm add @next/mdx @mdx-js/loader @mdx-js/react @types/mdx
```

Replace `next.config.ts`:

```ts
import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
};

const withMDX = createMDX({});
export default withMDX(nextConfig);
```

- [ ] **Step 27.2: Create mdx-components.tsx**

```tsx
import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => (
      <h1
        className="font-display text-display-section font-semibold text-ink-charcoal"
        {...props}
      />
    ),
    h2: (props) => (
      <h2 className="mt-10 font-display text-2xl font-semibold text-ink-charcoal" {...props} />
    ),
    p: (props) => <p className="mt-4 text-muted" {...props} />,
    ul: (props) => <ul className="mt-4 list-disc space-y-2 pl-6 text-muted" {...props} />,
    ...components,
  };
}
```

- [ ] **Step 27.3: Privacy content**

Create `app/privacy/page.mdx`:

```mdx
export const metadata = { title: "Privacy — Lumenosis AI" };

<div className="mx-auto w-[min(820px,calc(100%-32px))] py-20">

# Privacy

_Last updated: 2026-05-25_

Lumenosis AI ("we", "our") provides AI agent services to real estate professionals.
This policy describes what we collect, why, and how we keep it secure.

## What we collect

- Contact information you submit through forms or calls (name, email, phone, company).
- Voice recordings of calls answered by our AI agents on your behalf, where two-party
  consent permits.
- Email and SMS content sent through your inbound channels for the purpose of replying.
- CRM records you authorize us to read or write.

## Why we collect it

To deliver the service you hired us for: answer your calls, qualify your leads, book
your appointments, log everything in your CRM. We do not sell your data. We do not use
your data to train any third-party model.

## How long we keep it

For the duration of your contract plus thirty days. After that, we purge.

## Your rights

You can request a copy of your data, request deletion, or revoke consent at any time
by emailing privacy@lumenosis.ai.

## Subprocessors

We use Twilio (telephony), OpenAI / Anthropic (model inference), Vercel (hosting),
GoHighLevel (CRM), and Fillout (forms). Each subprocessor signs a data processing
agreement covering the standards we hold ourselves to.

## Contact

privacy@lumenosis.ai

</div>
```

- [ ] **Step 27.4: Commit**

```bash
git add -A
git commit -m "feat: /privacy MDX page + MDX config"
```

---

## Task 28: /terms MDX page

**Files:**
- Create: `app/terms/page.mdx`

- [ ] **Step 28.1: Build**

```mdx
export const metadata = { title: "Terms — Lumenosis AI" };

<div className="mx-auto w-[min(820px,calc(100%-32px))] py-20">

# Terms of service

_Last updated: 2026-05-25_

These terms govern your use of Lumenosis AI. By booking a strategy call or signing a
service agreement, you agree to them.

## Services

We provide AI agent installation, training, and ongoing operation for real estate teams.
Specifics of your engagement are documented in your separate signed agreement.

## Acceptable use

You may not use Lumenosis AI to harass, deceive, defraud, or violate consumer protection
law. You may not bypass platform policies (TCPA, CAN-SPAM, Fair Housing, Skool, Meta,
Google) using our service.

## Compliance

You are responsible for collecting valid prior express written consent for SMS and call
recording in your jurisdiction. We provide tooling and templates; you sign off on
compliance posture before launch.

## Termination

You may cancel a monthly engagement with thirty days notice. We may terminate immediately
for breach of acceptable use.

## Limitation of liability

Our liability is capped at the fees paid in the trailing three months. We do not warrant
that AI agents will be infallible. Escalation to human owners is the safety net.

## Disputes

Texas law governs. Disputes go to binding arbitration in Austin, Texas, except claims
that may be heard in small claims court.

## Contact

legal@lumenosis.ai

</div>
```

- [ ] **Step 28.2: Commit**

```bash
git add app/terms/page.mdx
git commit -m "feat: /terms MDX page"
```

---

## Task 29: Env validation

**Files:**
- Create: `lib/env.ts`

- [ ] **Step 29.1: Build zod-validated env loader**

```ts
import { z } from "zod";

const ServerEnv = z.object({
  FILLOUT_API_KEY: z.string().min(10).optional(),
  GHL_LOCATION_PIT: z.string().min(10).optional(),
  GHL_CALENDAR_ID: z.string().min(1).optional(),
});

const ClientEnv = z.object({
  NEXT_PUBLIC_FILLOUT_FORM_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL: z.string().url().optional(),
});

export const serverEnv = ServerEnv.parse({
  FILLOUT_API_KEY: process.env.FILLOUT_API_KEY,
  GHL_LOCATION_PIT: process.env.GHL_LOCATION_PIT,
  GHL_CALENDAR_ID: process.env.GHL_CALENDAR_ID,
});

export const clientEnv = ClientEnv.parse({
  NEXT_PUBLIC_FILLOUT_FORM_ID: process.env.NEXT_PUBLIC_FILLOUT_FORM_ID,
  NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL: process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL,
});
```

- [ ] **Step 29.2: Commit**

```bash
git add lib/env.ts
git commit -m "feat: zod env validation (server + client)"
```

---

## Task 30: Optional /api/lead webhook

**Files:**
- Create: `app/api/lead/route.ts`

- [ ] **Step 30.1: Build POST handler**

```ts
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  // TODO: HMAC verify against FILLOUT_WEBHOOK_SECRET when Fillout webhook is configured

  console.log("[lead] received", { ts: new Date().toISOString(), payload });

  // Optional: forward to Slack via SLACK_WEBHOOK_URL
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 30.2: Commit**

```bash
git add app/api/lead/route.ts
git commit -m "feat: optional Fillout webhook fallback handler"
```

---

## Task 31: Copy pass — apply Daniel + AIDA

**Files:**
- Modify: every section component touched in Tasks 7–24
- Modify: every `content/*.ts` file in Task 6

- [ ] **Step 31.1: Audit pass**

Read each section component + content file. Check against spec §8 banned vocab list:
- "Agentic OS" (search whole repo: `rg -i "agentic os"` — expect 0 hits)
- "transformative", "cutting-edge", "leverage", "synergy", "revolutionize"
- Em dashes (`—` allowed in editorial style; `--` in plain text not)
- "utilize", "delve", "crucial", "furthermore"

Run:

```bash
rg -i "agentic os|transformative|cutting-edge|leverage|synergy|revolutionize|utilize|delve|furthermore" components content app
```

Expected: zero matches. If any, rewrite per Daniel's clear-language rule.

- [ ] **Step 31.2: AIDA spine check**

Walk page top to bottom. For each section, confirm role:
- Hero → Attention
- Problem agitation → Interest
- Aria deep-dive + 30-day timeline + case-studies → Desire
- Two ways in + Calendar + Final CTA + Sticky bar → Action

If any section drifts, tighten copy.

- [ ] **Step 31.3: Daniel framework check**

- Process = Proof: timeline + agent capability bullets present? ✓
- Status quo is enemy: problem agitation costs out the do-nothing path? ✓
- Transformation = Imagination: Aria deep-dive vivid scene present? ✓
- One promise. one outcome: hero = single outcome? ✓
- Transparency: "we won't automate everything" line present somewhere (FAQ or Aria deep-dive)? Add if missing.

- [ ] **Step 31.4: Commit**

```bash
git add -A
git commit -m "copy: pass per Daniel framework + AIDA spine"
```

---

## Task 32: Responsive QA pass

**Files:**
- No edits unless bugs found. Document in `docs/superpowers/qa/responsive-qa.md`.

- [ ] **Step 32.1: Boot dev server**

```bash
pnpm dev
```

- [ ] **Step 32.2: Test matrix**

Open Chrome DevTools, set device to:

| Width | Device target | Check |
|---|---|---|
| 360px | Old Android | All sections stack, no horizontal scroll, text readable |
| 390px | iPhone 14 | Hero callouts visible, sticky CTA bar appears |
| 414px | iPhone Plus | Same as 390 |
| 768px | iPad portrait | Topbar nav appears, hero side-by-side |
| 1024px | iPad landscape | Agents grid 4-col, FAQ 2-col |
| 1280px | Desktop | Full layout, max-width 1200 wrap |
| 1920px | Wide desktop | No content stretch beyond 1200, centered |

For each width: scroll full page, click every CTA (no jumps to broken anchors), open FAQ accordion, check tab switches in case-study wall.

Document any bugs in `docs/superpowers/qa/responsive-qa.md`. Fix inline. Re-test.

- [ ] **Step 32.3: Reduced motion check**

In DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion: reduce`. Reload. Confirm:
- Hero rotating-text shows first niche only, no animation
- No scroll-trigger animations
- No CTA hover transforms

- [ ] **Step 32.4: Commit**

```bash
mkdir -p docs/superpowers/qa
git add -A
git commit -m "qa: responsive + reduced-motion pass"
```

---

## Task 33: Accessibility QA pass

**Files:**
- Modify any component with a11y bug found. Document in `docs/superpowers/qa/a11y-qa.md`.

- [ ] **Step 33.1: Run axe via Chrome DevTools**

DevTools → Lighthouse → Accessibility → Run. Target score: ≥ 95.

- [ ] **Step 33.2: Manual checks**

- Tab through entire page with keyboard only. Every interactive element reachable + visible focus ring.
- Every image has meaningful `alt` (or empty `alt=""` for decorative).
- Color contrast: text on cream `#F5F4EE` ≥ 4.5:1 (charcoal `#1A1A1A` passes), text on dark-section `#0F1612` ≥ 4.5:1.
- Skip-link to main content present.

- [ ] **Step 33.3: Add skip-link if missing**

In `app/layout.tsx`, inside `<body>` before `{children}`:

```tsx
<a
  href="#top"
  className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-indigo focus:px-3 focus:py-2 focus:text-white"
>
  Skip to content
</a>
```

- [ ] **Step 33.4: Commit**

```bash
git add -A
git commit -m "qa: accessibility pass + skip-link"
```

---

## Task 34: Lighthouse + perf pass

**Files:**
- Modify components for perf wins. Document in `docs/superpowers/qa/lighthouse-qa.md`.

- [ ] **Step 34.1: Production build**

```bash
pnpm build && pnpm start
```

- [ ] **Step 34.2: Lighthouse run (mobile)**

DevTools → Lighthouse → Mobile + Performance + Accessibility + Best Practices + SEO. Run.

Targets: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95, LCP < 2.5s, CLS < 0.1.

- [ ] **Step 34.3: Common fixes if scores low**

- LCP slow: confirm hero image `priority` flag, `next/image` `sizes` set, fonts have `display: swap`.
- CLS: confirm hero glass callouts have explicit width, image card has aspect-ratio reservation.
- TBT high: defer Framer Motion to client-only, lazy-load below-fold sections via `next/dynamic`.

- [ ] **Step 34.4: Commit**

```bash
git add -A
git commit -m "perf: Lighthouse mobile pass (P>=90, A>=95, BP>=95, SEO>=95)"
```

---

## Task 35: Vercel deploy

**Files:**
- No code edits.

- [ ] **Step 35.1: Invoke vercel:bootstrap skill**

Brief: "Deploy lumenosis-site to Vercel. Project name: lumenosis-site. Framework: Next.js. Domain: lumenosis.ai (production) + preview URLs per push."

- [ ] **Step 35.2: Set env vars**

Use vercel:env-vars skill. Set in production + preview environments:
- `FILLOUT_API_KEY`
- `GHL_LOCATION_PIT`
- `GHL_CALENDAR_ID`
- `NEXT_PUBLIC_FILLOUT_FORM_ID`
- `NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL`

- [ ] **Step 35.3: Push to deploy**

```bash
git remote add origin git@github.com:Ofunrein/lumenosis-site.git
git push -u origin main
```

(Or use `vercel:deploy` skill from CLI.)

- [ ] **Step 35.4: Smoke test preview URL**

Open Vercel preview URL on phone + desktop. Submit test form. Confirm GHL contact created. Book test calendar slot. Confirm GHL appointment created.

- [ ] **Step 35.5: Promote to production**

When test passes, promote preview → production. Point `lumenosis.ai` DNS at Vercel.

- [ ] **Step 35.6: Final commit + tag**

```bash
git tag v1.0.0
git push --tags
```

---

## Self-review notes

Spec coverage map:

| Spec section | Plan task |
|---|---|
| §5 Sitemap | Tasks 26 (`/`), 27 (`/privacy`), 28 (`/terms`) |
| §6 Page structure (16 sections) | Tasks 7–24, 26 (compose) |
| §7 Visual system | Tasks 2 (tokens), 3 (fonts), 4 (shadcn), 5 (design pass) |
| §8 Copy framework | Task 31 |
| §9 Tech stack | Task 1 |
| §10 Forms + booking | Tasks 19, 20, 21, 30 |
| §11 Folder structure | Implicit across all tasks |
| §12 Build sequencing | Plan tasks 1–35 |
| §13 Acceptance criteria | Tasks 32, 33, 34 |

Type consistency: agent.slug, agent.accent, niche, TimelineWeek, PricingPath, FaqItem, CaseStudy, TrustLogo — referenced consistently.

Mobile-responsive baked into every component task: every section uses mobile-first Tailwind, every task has mobile QA step at 360 / 768 / 1280, full responsive matrix in Task 32.

Frontend-design skill invoked: Tasks 5 (lock primitives), 10 (hero), 12 (founder VSL), 13 (problem agitation), 14 (meet-the-team), 15 (aria deep-dive). Re-invoked in Task 32 if responsive bugs surface visual issues.

No placeholders unresolved. Real prices ($X/$Y), real assets (martin headshot, VSL, agent avatars, brokerage logos, product mockup) flagged as Open Items in spec §14 and ship with placeholder fallbacks in v1.

---

## Open items requiring Martin input during build

1. Real `$X` and `$Y` prices for `content/pricing.ts`
2. Real Martin headshot → `public/images/martin-headshot.jpg`
3. 60-90s VSL recording + poster image
4. Real brokerage logos (or confirm placeholder NAR/Zillow/Realtor list ships v1)
5. Fillout form built in Fillout dashboard → form ID
6. GHL subaccount calendar created → calendar ID + embed URL
7. Existing Olivia chat widget snippet from current Lumenosis site (paste into root layout)
8. GitHub repo created at `Ofunrein/lumenosis-site`
9. `lumenosis.ai` DNS pointed at Vercel after preview QA passes
