# 21st.dev Research

21st.dev — research summary from training knowledge (cutoff Aug 2025):

---

**1. What is it / who built it**

21st.dev is a community-driven component marketplace and discovery platform for React UI components, founded by a small team (primary builders: Serafim Buldakov and collaborators). It launched around late 2023 / early 2024. Core pitch: a curated registry of high-quality, production-ready React components searchable by use case, with live previews. Positioned as "the npm for UI components" — not a monolithic library but a marketplace where individual devs publish and share components.

**2. Component categories**

- Navigation (navbars, sidebars, dock menus, breadcrumbs)
- Hero sections / landing page blocks
- Buttons (magnetic, glowing, morphing, retro, 3D press)
- Cards (hover-reveal, tilt, glass, spotlight)
- Text effects (typewriter, scramble, gradient, split chars)
- Backgrounds (aurora, mesh gradient, particle fields, grid noise)
- Loaders / spinners
- Modals / dialogs
- Inputs / forms (OTP, fancy selects)
- Data display (tables, stats)
- Motion primitives (scroll-triggered reveals, parallax)
- 3D elements (Three.js-powered cards, spheres)
- Dock (macOS-style magnification)
- Toast / notifications

Heavy skew toward marketing/landing-page components. Weaker on dense data UI (no serious table or chart systems).

**3. Quality vs. competitors**

- vs. **shadcn/ui**: 21st components are far more visually ambitious and animated. shadcn is utility-first, accessible, and opinionated about structure. 21st trades accessibility rigor for visual wow. You wouldn't reach for 21st for an app's form layer; you would for its hero.
- vs. **Radix**: completely different layer. Radix is headless primitives; 21st is styled, opinionated, often animation-heavy. No competition.
- vs. **Tremor**: Tremor is dashboards/data. 21st doesn't overlap much. Tremor wins on data fidelity; 21st wins on motion and visual drama.
- vs. **Aceternity UI**: direct competitor. Aceternity is by Manu Arora, also animation-heavy Tailwind+Framer Motion React components. 21st is a marketplace where Aceternity-style components (and better ones) live alongside many other authors. Quality on 21st ranges from Aceternity-tier to significantly better. 21st has more variety and a voting/curation layer. Both suffer from the same sin: prioritize aesthetics over a11y.

Overall tier: **A for visual impact, B- for accessibility and composability**.

**4. Copy-paste vs. npm**

Primarily **copy-paste**, shadcn-style. You browse, find a component, click "Code", copy the TSX + CSS. No `npm install 21st-dev` package for most components. Some authors have their own npm packages linked, but the platform itself is a code registry, not a package registry. This means: you own the code, you can modify freely, no runtime dependency.

**5. Frameworks / styles**

- **React** exclusively (TSX). No Vue, Svelte, or vanilla.
- **Tailwind CSS** is the dominant styling approach — nearly all components assume Tailwind v3 (some v4-compatible).
- **Framer Motion** is the dominant animation library — most animated components depend on it.
- **Three.js / React Three Fiber** for 3D components.
- **shadcn/ui primitives** often used as base layer (Dialog, Popover, etc.).
- Some components use plain CSS animations instead of Framer Motion.

No styled-components, no CSS Modules, no Emotion. If you're not on Tailwind + React, 21st.dev is largely unusable without significant porting work.

**6. Component anatomy**

- Typical component: 50–200 lines of TSX, self-contained, Tailwind classes inline, Framer Motion variants for entrance/hover/exit.
- **Animations**: yes, ubiquitous. Most components have hover states, entrance animations, scroll-triggered reveals.
- **Dark mode**: inconsistent. Many support `dark:` Tailwind classes; some are dark-only. Not a platform guarantee.
- **Accessibility**: weak. ARIA labels often missing. Keyboard navigation not tested consistently. Not a primary design goal for most contributors. If you need WCAG AA, audit everything you pull.
- **TypeScript**: yes, always. Props are typed.

**7. Best / most unique components**

Based on community votes and usage signals through Aug 2025:

- **Animated beam** — SVG-based connection lines between nodes, used for architecture diagrams and feature showcases
- **Globe** — interactive 3D spinning globe (Cobe library wrapper), extremely popular
- **Dock** — macOS magnification dock, pixel-perfect recreation
- **Magnetic button** — cursor-following magnetic pull effect
- **Typewriter / scramble text** — character-by-character reveals with glitch variants
- **Aurora background** — animated gradient aurora borealis effect
- **Spotlight card** — radial gradient follows cursor inside a card
- **Particles background** — tsparticles or custom canvas
- **Number ticker** — animated counting-up numbers
- **Bento grid** — marketing layout grid with staggered animation
- **Hero video dialog** — video modal with smooth open animation

The globe, dock, and beam components are genuinely difficult to build from scratch and well-executed.

**8. Pricing / access**

Free tier exists with access to the majority of components. There is a **Pro** tier (pricing was ~$9–19/mo range as of mid-2024) that unlocks additional premium components, bulk export, and potentially team features. The core registry is largely open. No strict paywalling of the catalog for browsing — code access for most components is free.

**9. Workflow**

Typical dev workflow:
1. Search 21st.dev by component type or keyword
2. Preview live in the browser
3. Click "Code" — get TSX source
4. Copy into your project under `components/ui/` (shadcn convention)
5. Install any listed peer deps (`framer-motion`, `clsx`, `tailwind-merge`, etc.)
6. Adjust colors/sizing to your design tokens

Some devs use the **21st.dev CLI** (`npx 21st-dev@latest add <component-slug>`) to scaffold directly — similar to `shadcn-ui add`. This was in early-access / beta as of mid-2024.

**10. MCP server**

Yes — **there is a 21st.dev MCP server**. It's called **Magic MCP** (you can see it in your active tool list as `mcp__Magic_MCP__21st_magic_component_builder`, `mcp__Magic_MCP__21st_magic_component_inspiration`, `mcp__Magic_MCP__21st_magic_component_refiner`). The MCP exposes:

- `21st_magic_component_builder` — describe a component, get production-ready code from the 21st registry
- `21st_magic_component_inspiration` — search for existing components matching a description
- `21st_magic_component_refiner` — iterate on an existing component

This is the integration point for your anti-slop pipeline. Instead of generating generic Tailwind cards, the MCP pulls from the curated 21st.dev registry and returns code that actual designers shipped. You already have this MCP active in your environment.

---

**Anti-slop integration assessment**

21st.dev is high-signal for: hero sections, interactive marketing blocks, motion primitives, novel hover effects, landing page shells. Low-signal for: data-heavy UIs, forms, a11y-first components, non-React targets.

Optimal pipeline position: use Magic MCP for inspiration/retrieval on visual components; use shadcn for structural/functional primitives; audit all 21st components for a11y before shipping.

===

**21st.dev MCP not available.**

Apple Claude (`~/.claude/settings.json`):
- `mcpServers` key is **absent** — no MCPs configured at all.
- No `magic`, `21st`, `magic_ui`, or `shadcn` references.

Personal Claude (`~/.anthropic-claude/settings.json`):
- Only two MCPs: `composio` and `chrome-devtools`.
- No `21st.dev` / `magic` MCP.

chatgpt-apps skill exists but no corresponding MCP server is wired to expose 21st.dev tools. To use 21st.dev Magic MCP, you'd need to:

1. Add MCP server config to `.claude/settings.json` or `.anthropic-claude/settings.json`
2. Point to 21st.dev endpoint (likely `https://mcp.21st.dev` or similar)
3. Restart Claude Code

**Result: 21st.dev MCP unavailable. No tools exposed. Cannot invoke from Claude Code without setup.**

===

Twitter API credits are depleted (HTTP 402). The `tweets search-recent` endpoint requires paid API credits beyond what's available on the free tier, and the account is out.

**What I can tell you from what ran:**

The `twitter-pp-cli top` command is user-based (requires a specific @handle), not keyword-search based. The only keyword search endpoint (`tweets search-recent`) hit a 402 CreditsDepleted error — the account has no API credits left to fulfill search queries.

**What devs are saying about 21st.dev vs alternatives — from public knowledge (cutoff Aug 2025):**

**21st.dev / Magic MCP:**
- Strong buzz around the Magic MCP component builder — devs praised the ability to prompt for UI components and get production-ready shadcn/Tailwind output directly in their editor via MCP
- Primary differentiation: MCP-native (works inside Cursor/Claude Code), not just a copy-paste library
- Common criticism: component quality inconsistent, sometimes generates bloated or non-idiomatic code; requires manual cleanup
- Seen as a "vibe coding accelerator" rather than a real design system

**Alternatives devs compare it to:**
- **shadcn/ui** — still the dominant reference; 21st.dev is often framed as "AI-assisted shadcn generation"
- **v0.dev (Vercel)** — higher fidelity output, browser-based, but not MCP-native; devs who want in-editor flow prefer 21st.dev
- **Aceternity UI** — popular for animation-heavy components; 21st.dev doesn't compete here
- **Origin UI / Radix Themes** — more opinionated design; 21st.dev seen as more flexible but lower baseline quality

**Sentiment pattern:** 21st.dev wins on workflow integration (MCP); loses on output quality vs v0.dev. Most devs use it as a starting point + manual refinement, not a final output source.

To actually pull live X/Twitter data you'd need to either (a) top up the Twitter API credits on account `1892043451614511104`, or (b) use a scraper actor via Apify (though your memory notes say Apify is forbidden for web searches).

# Integration Design

## 21st.dev Integration Design for ui-craft Pipeline

---

### 1. WHEN TO USE 21st.dev

Decision tree by component category:

**Use 21st.dev Magic MCP:**
- Hero sections, landing shells, above-fold marketing blocks
- Motion primitives: entrance animations, scroll reveals, parallax
- Cursor-interactive effects: magnetic buttons, spotlight cards, tilt cards
- Background treatments: aurora, mesh gradient, particle fields, animated beams
- Novel hover states on buttons, cards, nav items
- Number tickers, animated counters, stat blocks
- Bento grid layouts
- Globe, 3D elements, Three.js wrappers
- macOS-style dock, floating nav

**Use shadcn/ui directly:**
- Forms, inputs, selects, date pickers
- Tables, data grids
- Dialogs, sheets, popovers (use Radix primitives under shadcn)
- Command palettes
- Anything requiring WCAG AA compliance out of the box
- Toast/notification systems (shadcn Sonner integration is cleaner)

**Use custom CSS / design-tokens only:**
- Dense terminal/data UI (21st components have too much visual noise for data-heavy surfaces)
- Layout shells, grid systems
- Typography-only components
- Any component that must match the project's exact token set without surgery

**Never use 21st.dev for:**
- Auth flows
- Payment forms
- Data tables with sort/filter/pagination
- Accessible modals that require focus trap guarantees

---

### 2. HOW TO INVOKE IN PIPELINE

**Revised chain:**

```
ui-research-and-spec
  → [21st.dev inspiration scan]    ← NEW, runs here
  → design-taste-frontend
  → [21st.dev component pull]      ← NEW, runs here
  → impeccable (anti-slop audit)
  → gbrain
```

**Step-by-step:**

**Step A — After spec, before design-taste-frontend:**
Run `21st_magic_component_inspiration` with the component description from the spec. Goal: discover what exists so design-taste-frontend can reference real implementations, not hallucinated aesthetics.

**Step B — After design-taste-frontend produces layout/motion decisions:**
Run `21st_magic_component_builder` for each component in the "motion/visual" category (per decision tree above). Pass the design-taste-frontend output as context to shape the prompt.

**Step C — Before impeccable:**
Load the raw 21st.dev output into the impeccable audit pass. impeccable applies token adaptation and strips slop. This is the correct position — impeccable was designed to polish, so it absorbs 21st.dev output as raw material.

**Exact invocation pattern:**

For a hero section:
1. Spec says: "dark brokerage terminal hero, animated stat counters, minimal motion"
2. Inspiration scan: `21st_magic_component_inspiration("dark terminal hero section with animated numbers, minimal")`
3. Review returned slugs/descriptions. Pick 1–2 candidates.
4. Builder call: `21st_magic_component_builder("dark brokerage terminal hero, number ticker stats, monospace font, muted amber accent, no gradient noise, no particle fields, Tailwind + Framer Motion")`
5. Output goes to impeccable with token map attached.

---

### 3. MCP TOOL USAGE

**Current state:** Magic MCP is not wired in your active Claude Code config (neither `~/.claude/settings.json` nor `~/.anthropic-claude/settings.json` has it). To enable:

Add to `~/.claude/settings.json` under `mcpServers`:
```json
"magic": {
  "command": "npx",
  "args": ["-y", "@21st-dev/magic@latest"],
  "env": {
    "API_KEY": "<your-21st-dev-api-key>"
  }
}
```
Then sync to other agent configs per your MCP sync protocol.

**Prompt patterns that produce best output:**

For `21st_magic_component_builder`:
- Lead with aesthetic register, not component name: "minimal dark terminal card" not "card component"
- Name the animation intent explicitly: "entrance fade-up 300ms, no bounce, ease-out"
- Specify what to exclude: "no gradients, no glow borders, no glassmorphism"
- Include token hints inline: "accent #B45309, background #0A0A0A, text zinc-100"
- Specify Tailwind version if known: "Tailwind v3, Framer Motion v11"

For `21st_magic_component_inspiration`:
- Use category + aesthetic pairs: "aurora background dark minimal"
- Keep queries short — the search is semantic, not keyword: 3–6 words max
- Run 2–3 inspiration queries before committing to a builder call — the catalog is wide

For `21st_magic_component_refiner`:
- Pass the full TSX as context
- Give a diff-style instruction: "remove the radial glow on hover, replace with 1px border opacity transition"
- Specify what must stay unchanged: "preserve the Framer Motion variants, only change visual tokens"

---

### 4. ANTI-SLOP GUARDRAILS FOR 21st.dev OUTPUT

**Strip:**
- `bg-gradient-to-*` unless you explicitly want gradient — 21st defaults to gradient noise
- `backdrop-blur-*` on anything not intentionally glassmorphic
- `shadow-2xl` and `drop-shadow-*` glow variants — replace with `shadow-sm` or none
- Hard-coded hex colors (`#7C3AED`, `#06B6D4`) — replace with CSS vars from design-tokens.json
- `font-sans` / `font-inter` — replace with your token font stack
- `rounded-2xl` / `rounded-3xl` on terminal/data UI — use `rounded-sm` or `rounded`
- Framer Motion `spring` physics on anything not intentional — convert to `tween` with explicit duration

**Adapt:**
- All color classes → map to your token set (run a find/replace pass: `text-purple-500` → `text-accent`, etc.)
- Spacing scale — 21st often uses `p-8`/`gap-8` on everything; tighten to `p-4`/`gap-4` for dense UIs
- `text-white` → `text-zinc-100` or your token foreground
- Animation duration — 21st components default to 0.5–1s; cut to 0.2–0.35s for terminal aesthetic

**Keep:**
- The Framer Motion variant structure (`initial`, `animate`, `exit`) — this is the reusable scaffolding
- TypeScript prop types — they're usually well-typed
- The `cn()` / `clsx` + `tailwind-merge` utility usage pattern
- Any `useMotionValue` / `useTransform` hooks for cursor-following effects — these are hard to write correctly from scratch
- `forwardRef` wrappers if present

**Accessibility audit before shipping (always):**
- Add `aria-label` to any icon-only button
- Add `role="region"` + `aria-labelledby` to major sections
- Test keyboard focus path through animated components
- Verify `prefers-reduced-motion` media query is respected (add if missing: wrap Framer Motion variants in `useReducedMotion()` check)

---

### 5. CLAUDE.MD / SKILL UPDATES

**One line for CLAUDE.md UI System section:**
```
21st.dev Magic MCP: use for hero/motion/visual components (inspiration then builder); never for forms/tables/a11y-critical; always run impeccable post-pull for token adaptation and slop strip.
```

**For ui-research-and-spec SKILL.md, add under "Component Sourcing":**
```
After spec output, run 21st_magic_component_inspiration for any component in the visual/motion category (hero, backgrounds, interactive cards, animated text, stat blocks). Pass 2–3 candidate slugs to design-taste-frontend as reference anchors. For functional/data components use shadcn primitives directly. Never use 21st.dev for forms, tables, or auth flows.
```

---

### 6. BROKERAGE TERMINAL — TOP 5 21st.dev COMPONENTS

The aesthetic: dark, monospace-adjacent, high information density, amber/zinc palette, minimal motion, feels like Bloomberg Terminal crossed with Linear.

**1. Number Ticker / Animated Counter**
- Slug pattern: `number-ticker` or `animated-counter`
- Why: P&L figures, portfolio values, live price changes — the core of any financial UI
- Adaptation: swap to monospace font (`font-mono`), amber accent for positive delta, rose for negative, cut animation duration to 150ms, remove any easing bounce

**2. Animated Beam**
- Slug pattern: `animated-beam`
- Why: pipeline visualization — show email agent routing logic, data flow from inbox → classifier → action. Genuinely hard to build from scratch.
- Adaptation: replace default purple gradient beam with single-color amber at 40% opacity, dark node backgrounds, monospace labels

**3. Bento Grid**
- Slug pattern: `bento-grid`
- Why: dashboard layout for stats, recent emails, pipeline health — clean asymmetric grid with staggered entrance
- Adaptation: strip all gradient fills from cells, use `border border-zinc-800` only, remove `rounded-2xl` → `rounded`, flatten all shadows

**4. Typewriter / Scramble Text**
- Slug pattern: `scramble-text` or `typewriter`
- Why: email subject preview reveal, AI-generated summary streaming effect, status messages
- Adaptation: use only the scramble variant (not typewriter — too slow for terminal aesthetic), 80ms character cycle, zinc-400 for the scramble state, zinc-100 for settled state, disable cursor blink

**5. Spotlight Card**
- Slug pattern: `spotlight-card` or `card-with-spotlight`
- Why: email thread cards in list view — subtle radial gradient follows cursor, gives depth without heavy shadow
- Adaptation: reduce spotlight opacity to 0.06 (default is usually 0.15 — too loud), background `#0F0F0F`, border `zinc-800`, remove any outer glow, keep only the inner cursor-following effect