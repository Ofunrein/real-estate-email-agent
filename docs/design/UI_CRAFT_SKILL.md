```markdown
---
name: ui-craft
description: Single entry point for all UI work — orchestrates the full skill stack from brief to shipped interface.
when_to_use: >
  Any time the user says "build", "design", "redesign", "audit", "make it better",
  "landing page", "dashboard", "app shell", "prototype", "looks generic", "animate this",
  "dark mode", "typographic detail", "run the design pipeline", or references any aesthetic
  register (brutal, editorial, minimal, glass, etc). Also triggers on vague requests like
  "make a UI for X" or "this looks like AI slop."
argument-hint: "[new|redesign|audit|spec] [app-type] [aesthetic-register]"
---

# UI Craft — Master Orchestration Skill

## What This Does

UI Craft is the single, authoritative entry point for every UI task. Rather than requiring
the user or agent to know which of 25+ design skills applies, this skill reads the brief,
inspects the working directory, queries gbrain for past taste receipts, selects the optimal
skill chain, invokes each skill in order, and closes the loop with self-critique and memory
storage. It owns the full lifecycle: context loading → research → spec → build → refinement
→ verification → memory. No skill in the ecosystem is invoked for UI work without going
through this orchestrator first.

The skill is stateful across sessions. After every completed project it writes a structured
taste receipt to gbrain (slug format: `taste/[project-slug]`). At the start of the next
project with a similar brief fingerprint, those receipts are loaded and their anti-patterns
pre-empted before the build step — meaning the system gets measurably better at each
project type the more it is used. A `TASTE.md` accumulates winning decisions locally
alongside `DESIGN.md` and `PRODUCT.md`, and `impeccable`'s `load-context.mjs` reads all
three automatically.

---

## Decision Tree

```
INPUT: user message + ls of working directory
         │
         ▼
┌──────────────────────────────────┐
│ DESIGN.md exists?                │
│ PRODUCT.md exists?               │
└──────────────────────────────────┘
   NO → Phase 1 full (context + research + spec)
   YES → skip to Phase 4 with impeccable load-context
         │
         ▼
new app (no files, "build me", "from scratch")
  → Phase 1 → Phase 2 → Phase 3 → branch-select → Phase 5 → Phase 6

redesign ("redesign", "improve", "audit this existing", competitor URL provided)
  → Phase 1 (load any existing files) → design-extract (if URL given)
  → redesign-existing-projects audit → branch-select for rebuild
  → Phase 5 → Phase 6

audit only ("what's wrong", "rate this", "roast this UI")
  → critique (5-dim radar) → vibecheck → typographic-detail
  → output: scored report + prioritized fix list (no build step)

quick win ("make it less generic", "fix the typography", "add dark mode", "animate the hero")
  → identify single refinement skill from Refinement Layer map
  → invoke directly → vibecheck → Phase 6 (abbreviated receipt)

spec only ("generate a DESIGN.md", "write the design spec")
  → Phase 1 → Phase 2 → Phase 3 only → stop, output files
```

---

## Phase 1: Context Loading

**Step 1.1 — Scan working directory**

```bash
ls -la
cat DESIGN.md 2>/dev/null || echo "MISSING"
cat PRODUCT.md 2>/dev/null || echo "MISSING"
cat TASTE.md 2>/dev/null || echo "MISSING"
```

If all three exist → skip to Phase 4. Load them as context before invoking any build skill.

**Step 1.2 — Identify brief fingerprint**

Extract from user message:
- `app_type`: landing | dashboard | app_shell | prototype | ios | unknown
- `mood`: abstract dial 1–10 (1=cold/clinical, 10=warm/expressive)
- `density`: 1–10 (1=spacious/minimal, 10=dense/data-heavy)
- `variance`: 1–10 (1=safe/conventional, 10=experimental/rule-breaking)
- `audience`: [descriptor, e.g. "developer tools", "consumer health", "fintech B2B"]
- `stack`: React | Next.js | plain HTML | SvelteKit | unknown

When ambiguous, infer from vocabulary: "SaaS" → dashboard, mood 3, density 7. "Marketing"
→ landing, mood 6, density 3. "iOS" → ios, mood 7, density 4.

**Step 1.3 — Query gbrain for past taste receipts**

```bash
gbrain query "app_type:[extracted_app_type] mood:[dial] density:[dial]"
```

Surface the 3 closest receipts. Extract:
- Which anti-patterns were caught on prior similar projects
- Which skill chain was used
- Winning decisions

Inject these into the dial-inference step of `design-brief` (Phase 3). Pre-empt known
anti-patterns rather than waiting for critique to catch them.

**Step 1.4 — Check for reference URL or competitor site**

If user provides a URL or says "like X.com", flag for Phase 2 `design-extract` run.
Store as `REFERENCE_URL`.

---

## Phase 2: Research (new project only)

**Step 2.1 — Competitor / aesthetic research**

If `REFERENCE_URL` is set:

```
invoke: design-extract
input: REFERENCE_URL
output: tokens/, tailwind.config.extracted.js, motion-values.json, palette.json (17+ files)
```

`design-extract` reverse-engineers the live DOM into design tokens. These tokens are fed
into Phase 3 as constraints (palette lock, spacing scale anchor, motion easing values).

If no URL: invoke `awesome-design-md` to match brief fingerprint against the upstream
reference catalog. Output: pointer to closest reference DESIGN.md. Use as starting anchor,
not as final spec.

**Step 2.2 — Style register research (only if variance > 7 or register is explicit)**

Run keyword search to surface the current aesthetic register state-of-the-art:

Signals that trigger deep research:
- "brutalist", "Swiss", "manifesto" → search "Swiss grid brutalist web design 2025"
- "editorial", "magazine", "Monocle" → search "editorial web design bento 2025"
- "glass", "iOS 26" → search "liquid glass iOS 26 design patterns"
- "award-winning", "$150k", "premium" → search "awwwards site of the year 2025 patterns"

Extract: layout patterns, typography pairings, motion vocabulary, color usage. Summarize
into `RESEARCH.md` (brief, 200 words max). Feed into Phase 3 DESIGN.md generation.

---

## Phase 3: Spec Generation

**Step 3.1 — Invoke design-brief**

Pass: user message + extracted brief fingerprint + gbrain past receipts (anti-patterns) +
reference tokens (if design-extract ran) + RESEARCH.md (if produced).

`design-brief` outputs: structured DESIGN.md (8 dimensions: palette, typography, mood,
density, layout intent, motion vocabulary, dark mode stance, constraints).

If `design-brief` is unavailable, generate DESIGN.md directly from the template below.

**Step 3.2 — Write design-tokens.json**

After DESIGN.md is confirmed, generate `design-tokens.json` from the JSON template below.
This file is consumed by `design-taste-frontend`, `impeccable`, and `critique` to anchor
all downstream decisions.

**Step 3.3 — Initialize TASTE.md**

Create `TASTE.md` with the winning decisions from gbrain receipts pre-loaded as starting
constraints. This file accumulates throughout the project.

```markdown
# TASTE.md — [Project Name]

## Pre-Loaded Constraints (from similar past projects)
[paste winning_decision entries from gbrain receipts]

## Decisions Made This Project
[appended during build and refinement phases]
```

---

## Phase 4: Build

**Step 4.1 — Select primary build skill**

Match `app_type` + `mood` + `density` + `variance` + explicit register signals:

| Condition | Primary Build Skill |
|---|---|
| `app_type=landing` + generic | `frontend-skill` |
| `app_type=landing` + editorial/collage | `open-design-landing` |
| `app_type=landing` + "Swiss/brutal/manifesto" | `web-prototype-taste-brutalist` |
| `app_type=landing` + "warm/Notion/editorial" | `web-prototype-taste-editorial` |
| `app_type=landing` + "Apple/Linear/premium" | `web-prototype-taste-soft` |
| `app_type=landing` + "prevent repetition/GSAP" | `gpt-taste` |
| `app_type=dashboard` OR `app_type=app_shell` | `impeccable-frontend` → `impeccable` |
| `app_type=dashboard` + "dense data" | `industrial-brutalist-ui` |
| `app_type=dashboard` + "clean SaaS/docs" | `minimalist-ui` |
| `app_type=ios` | `liquid-glass-design` |
| `app_type=prototype` + speed priority | select taste-* by register |
| `app_type=unknown` OR no signal | `design-taste-frontend` (safe default) |
| DESIGN.md + PRODUCT.md exist | `impeccable load-context` directly |

**Step 4.2 — Load context into build skill**

Before invoking any build skill, confirm it has access to:
- `DESIGN.md` (required)
- `PRODUCT.md` (if exists)
- `TASTE.md` (if exists)
- `design-tokens.json` (required)
- Extracted tokens from `design-extract` (if ran)

Pass these as context. Do not let any build skill start from defaults when spec files exist.

**Step 4.3 — Enforce 78-box pre-flight (design-taste-frontend projects)**

When invoking `design-taste-frontend`, enforce the 78-box pre-flight checklist before
outputting final code. If boxes fail, iterate — do not ship with pre-flight failures.
Log failed boxes to TASTE.md under "Pre-flight failures this session."

**Step 4.4 — Apply refinement layer**

After primary build skill outputs, check each refinement trigger:

| Trigger | Refinement Skill |
|---|---|
| Dark mode in DESIGN.md OR user said "dark mode" | `impeccable-dark` |
| Motion vocabulary specified in DESIGN.md | `emil-design-eng` |
| Variance dial ≥ 8 OR "premium/award/$150k" | `high-end-visual-design` |
| Typography section in DESIGN.md is non-default | `typographic-detail` (Gap 2 skill) |
| "animate", "spring", "clip-path" in brief | `emil-design-eng` |
| Live browser session active | `design-live` (Gap 1 skill, CDP required) |

Apply refinement skills in this order (dependencies matter):
1. `high-end-visual-design` (structural — sets anti-patterns before motion)
2. `impeccable-dark` (theming — sets color before animation sees it)
3. `emil-design-eng` (motion — runs after structure and color are locked)
4. `typographic-detail` (micro-craft — runs last, fine-tunes what exists)

---

## Phase 5: Verify

Run all three verification steps in sequence. Do not skip any.

**Step 5.1 — critique**

Invoke `critique` on the final output. It returns a 5-dim radar:
- Philosophy (0–10): does the design have a coherent point of view?
- Visual Hierarchy (0–10): does the eye land correctly on every screen?
- Detail (0–10): are micro-decisions (spacing, radius, weight) intentional?
- Functionality (0–10): does the design serve the actual use case?
- Innovation (0–10): does it avoid AI-default patterns?

Threshold: all dimensions must score ≥ 7 before shipping. If any dimension is < 7, return
to Phase 4 with the specific failure noted. Cap iteration at 2 full loops — if a dimension
persists below 7 after 2 loops, document it in TASTE.md as a known gap and ship with
the caveat noted.

**Step 5.2 — vibecheck**

Invoke `vibecheck` on all generated code. It flags:
- Async/await anti-patterns
- Auth boundary leaks
- Middleware ordering bugs
- Closure gotchas
- Security surface exposures

Any P0 findings (auth, security) block shipping. P1 findings are flagged in TASTE.md.
P2 and below are noted but do not block.

**Step 5.3 — typographic-detail audit**

Even if `typographic-detail` was not invoked in Phase 4, run it as a 15-box audit:

Required passes before shipping:
- [ ] `text-underline-offset` set (not browser default)
- [ ] `text-decoration-thickness` set per font weight
- [ ] `text-wrap: balance` on headings
- [ ] `font-optical-sizing: auto` enabled
- [ ] `letter-spacing` calibrated per font + size (not universal)
- [ ] Line-height: display ≤ 1.15, body 1.45–1.6, UI labels 1.2–1.3
- [ ] No raw `font-size: 16px` without a scale system behind it
- [ ] Font pairing validated: optical harmony between display and body
- [ ] `font-variant-ligatures: common-ligatures` on display type
- [ ] Hanging punctuation on blockquotes
- [ ] No default browser underline on custom-styled links
- [ ] Widows controlled: `orphans: 2`, `widows: 2` on body copy
- [ ] Responsive type: fluid scale or clamp() — no hard px breakpoints
- [ ] Monospace: `font-variant-numeric: tabular-nums` where numbers align
- [ ] Icon/text baseline alignment verified at all sizes

Failures here are P2 unless the brief explicitly called out typography as a priority
(e.g., "editorial", "pacocoursey-tier detail") — then failures are P1.

**Step 5.4 — ai-humanizer**

If any generated prose exists (hero copy, button labels, empty states, error messages,
README, commit messages, docs), run `ai-humanizer`. Kill:
- Em dashes used for rhythm (replace with comma or restructure)
- "Delve", "seamlessly", "cutting-edge", "robust", "leverage", "utilize"
- Rule of three in marketing copy
- Passive voice constructions
- Inflated symbolism in copy

**Step 5.5 — design-pipeline output (optional, if time budget flag set)**

If the user set a time budget or said "ship by X", invoke `design-pipeline` to generate:
- `pipeline.json`: what was invoked, in what order, estimated token cost per step
- `run-pipeline.sh`: reusable shell script for this exact chain
- `PIPELINE.md`: explanation of why each skill was selected

Store under `taste/pipelines/[project-slug]` in gbrain.

---

## Phase 6: Memory

Write a taste receipt to gbrain immediately after verification completes.
No exceptions — even quick-win projects get an abbreviated receipt.

**Command:**

```bash
gbrain put taste/[project-slug] << 'EOF'
[paste receipt content]
EOF
```

**Full receipt format:**

```yaml
slug: taste/[project-slug]
---
brief_fingerprint:
  app_type: landing | dashboard | app_shell | prototype | ios
  mood: [1-10]
  density: [1-10]
  variance: [1-10]
  audience: [descriptor]
  stack: [React/Next/plain HTML/SvelteKit/etc]

chain_used:
  - design-brief
  - [optional: design-extract / awesome-design-md]
  - [primary build skill]
  - [refinement skills in order]
  - critique
  - vibecheck
  - typographic-detail
  - ai-humanizer

pre_flight_failures:
  - box: [which of 78 boxes failed]
    fix: [what resolved it]

anti_patterns_caught:
  - pattern: [e.g. "centered hero with 3 equal cards below fold"]
    caught_by: [skill name]
    resolution: [e.g. "asymmetric bento, left-weighted hero, staggered grid"]

critique_scores:
  philosophy: [0-10]
  hierarchy: [0-10]
  detail: [0-10]
  functionality: [0-10]
  innovation: [0-10]

typographic_failures:
  - [box name]: [fix applied]

vibecheck_findings:
  p0: []
  p1: []

winning_decision: >
  [one non-obvious design choice that made the output distinctive —
  be specific: not "used good typography" but "set letter-spacing: -0.03em
  on display type paired with optical-size 72, which collapsed the gap
  between the logotype weight and the body font weight and made the
  hierarchy feel intentional rather than accidental"]
```

**Update TASTE.md local file:**

Append the `winning_decision` to `TASTE.md` under "Decisions Made This Project."
This file persists in the repo and is read by `impeccable load-context` on next session.

**Skill-gap tracking:**

If the same anti-pattern appears in 5+ receipts across different projects, write a note to
gbrain under `taste/skill-gaps`:

```bash
gbrain put taste/skill-gaps/[pattern-slug] << 'EOF'
pattern: [description]
frequency: [N projects]
caught_by: [skill]
suggested_rule: [exact rule text to add to that skill's forbidden-pattern list]
first_seen: [project-slug]
last_seen: [project-slug]
EOF
```

When any design skill is next edited, query `gbrain query "taste/skill-gaps"` first.
Promote pending rules to the hardcoded anti-pattern list after human review.

---

## Style Registers

Select based on brief signals. One register per project. Do not mix.

**brutalist**
Signals: "Swiss", "brutal", "manifesto", "Figma-like data UI", "Stripe dashboard energy"
Skills: `industrial-brutalist-ui`, `web-prototype-taste-brutalist`
Characteristics: Swiss print grid (light) or CRT phosphor (dark); hazard red accent;
viewport-breaking display type; monospace metadata strips; ASCII ornament; no decorative
shadows; borders carry all hierarchy.
Do not use for: consumer apps, health, anything requiring warmth.

**editorial**
Signals: "magazine", "Monocle", "Apartamento", "editorial", "bento", "cultural"
Skills: `web-prototype-taste-editorial`, `open-design-landing`
Characteristics: Bento uneven rows; scroll-fade + stagger; IntersectionObserver reveals;
eyebrow tags; generous whitespace; editorial photography; serif display + sans body.
Do not use for: dense dashboards, developer tools, B2B SaaS.

**soft / consumer**
Signals: "Apple-like", "Linear", "Raycast", "premium consumer", "calm", "iOS feel"
Skills: `web-prototype-taste-soft`, `high-end-visual-design`
Characteristics: Squircle radii (24–32px); mandatory double-bezel on CTAs; button-in-button
pattern; spring motion (not linear); muted accent over white; system font stacks; no
decorative gradients.
Do not use for: editorial brands, developer tools that want authority, brutalist contexts.

**liquid-glass**
Signals: "iOS 26", "SwiftUI", "glass buttons", "visionOS", "WidgetKit", "namespace"
Skills: `liquid-glass-design`
Characteristics: Morphing glass surfaces; background material blur; namespace transitions;
specular highlights; elevated surface hierarchy. Web-incompatible — iOS/SwiftUI only.
Do not use for: web projects. Period.

**minimal**
Signals: "clean SaaS", "documentation", "Notion-tier", "quiet", "functional"
Skills: `minimalist-ui`
Characteristics: Warm off-white #FBFBFA; serif–sans optical pair; desaturated pastels;
no shadows above 4px blur; border over shadow for separation; ample whitespace as a
primary design element.
Do not use for: entertainment, gaming, anything requiring energy or excitement.

**terminal / developer**
Signals: "terminal", "hacker", "CLI tool", "monochrome", "code-first"
Skills: `industrial-brutalist-ui` (CRT dark variant)
Characteristics: Phosphor green or amber on near-black; monospace throughout; ASCII borders;
cursor blink animation; no decorative imagery.
Do not use for: consumer-facing products.

**high-end / award**
Signals: "award-winning", "$150k site", "premium brand", "luxury", "Awwwards"
Skills: `high-end-visual-design`, `gpt-taste` (prevent repetition), `emit-design-eng`
Characteristics: Absolute Zero anti-pattern enforcement; Creative Variance Engine; double-
bezel mandatory; custom cubic-bezier curves (not ease-in-out); GSAP-heavy; no
centered 3-column hero grid; no predictable scroll reveal.
Use for: high-budget brand sites, portfolio, luxury product.

---

## The Self-Improvement Loop

Every project that passes Phase 5 contributes to the improvement of every future project.
The mechanism has four parts:

**1. Receipt storage (per project)**
Phase 6 writes a taste receipt to gbrain. The receipt is queryable by fingerprint
similarity. This is the raw material for improvement.

**2. Pre-emption injection (session start)**
Phase 1 queries gbrain and surfaces the 3 closest past receipts. Their anti-patterns
are injected into the dial-inference step of `design-brief`, converting known bad paths
into hard constraints before the build skill runs. The system does not make the same
mistake twice on the same project type.

**3. TASTE.md accumulation (per project)**
Winning decisions from past receipts + decisions made during the current project
accumulate in a local `TASTE.md`. This file is the third context document (alongside
DESIGN.md and PRODUCT.md) and is read automatically by `impeccable load-context`.
Over time, `TASTE.md` becomes a project-specific taste memory that survives session
boundaries.

**4. Skill-gap promotion (after 5+ occurrences)**
When the same anti-pattern appears in 5+ receipts, it is written to `taste/skill-gaps`
in gbrain. The next time a design skill is edited, the editor queries this endpoint and
promotes pending rules to the hardcoded forbidden-pattern list. This keeps rule lists
empirically grounded — every rule has a documented provenance in real project failures,
not theoretical generation.

The result: project N+1 of type X always starts with better constraints than project N
of type X. The system is not static. It learns from its own outputs.

---

## DESIGN.md Template (complete, paste-ready)

```markdown
# DESIGN.md — [Project Name]

Generated: [date]
Brief fingerprint: app_type=[X] mood=[1-10] density=[1-10] variance=[1-10]

---

## 1. Palette

Primary background: #[hex]         <!-- main surface color -->
Secondary background: #[hex]       <!-- card / panel surface -->
Tertiary background: #[hex]        <!-- input / subtle surface -->

Primary text: #[hex]               <!-- body copy -->
Secondary text: #[hex]             <!-- muted labels, captions -->
Tertiary text: #[hex]              <!-- placeholders, disabled -->

Accent primary: #[hex]             <!-- CTA, interactive elements -->
Accent secondary: #[hex]           <!-- hover states, secondary actions -->
Accent danger: #[hex]              <!-- errors, destructive actions -->
Accent success: #[hex]             <!-- confirmation, success states -->
Accent warning: #[hex]             <!-- cautionary states -->

Border default: #[hex]             <!-- card borders, separators -->
Border strong: #[hex]              <!-- focus rings, emphasis borders -->

Dark mode: [yes / no / auto]
Dark surface: #[hex]               <!-- if dark mode: primary bg -->
Dark text: #[hex]                  <!-- if dark mode: primary text -->

Palette register: [warm / cool / neutral / high-contrast / muted]
Palette provenance: [e.g. "extracted from figma.com DOM" / "design-brief inference" / "manual"]

---

## 2. Typography

Display font: [family name]
  Source: [Google Fonts / system / CDN URL]
  Weights used: [400, 600, 700]
  Optical sizing: [yes / no]
  Letter spacing at display sizes: [e.g. -0.03em]
  Line height: [e.g. 1.1]

Body font: [family name]
  Source: [Google Fonts / system / CDN URL]
  Weights used: [400, 500]
  Letter spacing: [e.g. 0em]
  Line height: [e.g. 1.55]

UI / label font: [family name or "same as body"]
  Letter spacing: [e.g. 0.01em]
  Line height: [e.g. 1.25]

Mono font: [family name or "none"]
  Use case: [code blocks / data tables / metadata]

Type scale (rem):
  xs: 0.75
  sm: 0.875
  base: 1
  md: 1.125
  lg: 1.25
  xl: 1.5
  2xl: 1.875
  3xl: 2.25
  4xl: 3
  5xl: 3.75
  display: 5.5

Scale system: [fluid clamp() / breakpoint steps / fixed]
Fluid scale base: [e.g. clamp(1rem, 2.5vw, 1.25rem)]

Typography register: [editorial / UI / marketing / mono / mixed]

---

## 3. Spacing

Base unit: 4px
Scale multipliers: 1 2 3 4 6 8 10 12 16 20 24 32 40 48 64 80 96

Component padding inner: [e.g. "16px / 24px (sm / lg)"]
Section vertical rhythm: [e.g. "64px between sections, 32px within"]
Card padding: [e.g. "24px all sides"]
Input padding: [e.g. "12px 16px"]

Grid columns: [e.g. 12]
Grid gutter: [e.g. 24px]
Grid max-width: [e.g. 1280px]
Grid margin: [e.g. 24px mobile, 48px tablet, auto desktop]

Density dial: [1-10]
Density interpretation: [spacious: large padding, ample whitespace / dense: compact padding, tight grid]

---

## 4. Shape

Border radius:
  none: 0
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  2xl: 24px
  squircle: 28px     <!-- use for Apple/consumer register only -->
  full: 9999px       <!-- pills, badges, avatars -->

Shadow scale:
  1: 0 1px 2px rgba(0,0,0,0.05)        <!-- barely-there lift -->
  2: 0 2px 8px rgba(0,0,0,0.08)        <!-- card default -->
  3: 0 4px 16px rgba(0,0,0,0.10)       <!-- modal, dropdown -->
  4: 0 8px 32px rgba(0,0,0,0.12)       <!-- drawer, toast -->
  5: 0 16px 48px rgba(0,0,0,0.16)      <!-- overlay, hero element -->

Max shadow level in use: [1-5]
Shadows above 4px blur: [allowed / forbidden]    <!-- minimalist-ui: forbidden -->

Border width default: 1px
Border width strong: 2px

---

## 5. Motion

Motion vocabulary: [spring / linear / ease-out / custom cubic]
Spring config (if spring): stiffness=[X] damping=[Y] mass=[Z]
Custom bezier (if custom): cubic-bezier([a],[b],[c],[d])

Duration scale (ms):
  instant: 0
  fast: 100
  normal: 200
  slow: 350
  deliberate: 500
  narrative: 800

Reduced motion: [respect prefers-reduced-motion: yes / no]
  Fallback: [opacity only / no animation / same animation]

Scroll reveal: [yes / no]
  Type: [fade-up / stagger / clip-path reveal / none]
  IntersectionObserver threshold: [0.1 – 0.5]

GSAP: [required / optional / forbidden]
  Reason: [if required: why / if forbidden: use CSS only]

Motion register: [subtle / expressive / cinematic / none]

---

## 6. Layout Intent

Page type: [single-page / multi-section / app-shell / dashboard / article]
Navigation: [fixed top / sticky top / sidebar / none]
Hero pattern: [full-bleed / contained / split-screen / none]

Section order (if landing):
  1. [e.g. Hero: bold claim + single CTA]
  2. [e.g. Social proof: logos / numbers]
  3. [e.g. Feature grid: 3 asymmetric cards]
  4. [e.g. Deep feature: full-bleed image + copy]
  5. [e.g. Testimonial: pull quote]
  6. [e.g. Pricing: 3-tier table]
  7. [e.g. FAQ: accordion]
  8. [e.g. CTA banner: full-bleed repeat]
  9. [e.g. Footer: sitemap + legal]

Dashboard layout (if app shell):
  Sidebar: [fixed left / collapsible / top nav only]
  Main: [full-width / max-w constrained]
  Header: [fixed / scrolls with content]
  Footer: [yes / no]

Asymmetry: [required / preferred / neutral / avoid]
Bento grid: [yes / no]
Double-bezel CTA: [required / optional / not applicable]

---

## 7. Dark Mode

Stance: [system / forced-dark / forced-light / toggle / not-applicable]

If dark mode:
  Surface elevation model: [flat / 5-level / custom]
    Level 0 (base): #[hex]
    Level 1 (card): #[hex]
    Level 2 (elevated card): #[hex]
    Level 3 (modal): #[hex]
    Level 4 (tooltip/popover): #[hex]
    Level 5 (max): #[hex]

  Accent desaturation in dark: [yes — reduce chroma 15% / no]
  FART prevention: [yes — no instant theme flash on load / not applicable]
  Color scheme meta: <meta name="color-scheme" content="dark light">

---

## 8. Constraints and Anti-Patterns

Forbidden patterns (from gbrain taste receipts for this brief fingerprint):
  - [e.g. "centered hero with 3 equal cards in a row below fold"]
  - [e.g. "stock photo hero with blue gradient overlay"]
  - [e.g. "4 identical feature icons with one-sentence descriptions"]
  - [e.g. "testimonials section with circular avatar + 5 stars + lorem name"]

Register-specific constraints:
  - [from style register selection — e.g. "no decorative shadows above 4px (minimalist)"]
  - [e.g. "double-bezel mandatory on primary CTA (soft/consumer)"]
  - [e.g. "monospace metadata strip required on every card (brutalist)"]

Time budget: [unrestricted / [N] hours / ship by [date]]
  Scope decisions: [if time-constrained: which refinement steps to skip]

Stack constraints:
  Framework: [React / Next.js / plain HTML / SvelteKit / other]
  CSS: [Tailwind / CSS Modules / vanilla / styled-components]
  Animation: [GSAP / Framer Motion / CSS only / no animation]
  Image handling: [next/image / plain img / none]
  Icon set: [Lucide / Heroicons / Radix / custom SVG / none]
```

---

## design-tokens.json Template (complete, paste-ready)

```json
{
  "meta": {
    "project": "[project-name]",
    "generated": "[ISO date]",
    "brief_fingerprint": {
      "app_type": "landing",
      "mood": 6,
      "density": 4,
      "variance": 5,
      "audience": "[descriptor]",
      "stack": "Next.js"
    },
    "style_register": "soft",
    "design_md_sha": "[sha of DESIGN.md for drift detection]"
  },

  "color": {
    "background": {
      "primary": "#FFFFFF",
      "secondary": "#F8F8F7",
      "tertiary": "#F0EFED"
    },
    "text": {
      "primary": "#0F0F0F",
      "secondary": "#5C5C5C",
      "tertiary": "#9B9B9B"
    },
    "accent": {
      "primary": "#0066FF",
      "primary-hover": "#0052CC",
      "secondary": "#E8F0FF",
      "danger": "#DC2626",
      "success": "#16A34A",
      "warning": "#D97706"
    },
    "border": {
      "default": "#E4E4E2",
      "strong": "#BEBEBE",
      "focus": "#0066FF"
    },
    "dark": {
      "background-primary": "#0A0A0A",
      "background-secondary": "#141414",
      "background-tertiary": "#1C1C1C",
      "background-elevated-1": "#1A1A1A",
      "background-elevated-2": "#202020",
      "background-elevated-3": "#262626",
      "background-elevated-4": "#2C2C2C",
      "background-elevated-5": "#323232",
      "text-primary": "#FAFAFA",
      "text-secondary": "#A0A0A0",
      "text-tertiary": "#666666",
      "accent-primary": "#3D88FF",
      "border-default": "#2A2A2A",
      "border-strong": "#3D3D3D"
    }
  },

  "typography": {
    "font": {
      "display": {
        "family": "\"Inter Display\", \"Inter\", system-ui, sans-serif",
        "weights": [400, 600, 700],
        "optical-sizing": true,
        "letter-spacing-display": "-0.03em",
        "letter-spacing-large": "-0.02em",
        "letter-spacing-medium": "-0.01em",
        "line-height": 1.1
      },
      "body": {
        "family": "\"Inter\", system-ui, -apple-system, sans-serif",
        "weights": [400, 500],
        "letter-spacing": "0em",
        "line-height": 1.55
      },
      "ui": {
        "family": "\"Inter\", system-ui, sans-serif",
        "letter-spacing": "0.01em",
        "line-height": 1.25
      },
      "mono": {
        "family": "\"JetBrains Mono\", \"Fira Code\", monospace",
        "features": "tabular-nums slashed-zero"
      }
    },
    "scale": {
      "xs":      { "rem": 0.75,  "px": 12 },
      "sm":      { "rem": 0.875, "px": 14 },
      "base":    { "rem": 1,     "px": 16 },
      "md":      { "rem": 1.125, "px": 18 },
      "lg":      { "rem": 1.25,  "px": 20 },
      "xl":      { "rem": 1.5,   "px": 24 },
      "2xl":     { "rem": 1.875, "px": 30 },
      "3xl":     { "rem": 2.25,  "px": 36 },
      "4xl":     { "rem": 3,     "px": 48 },
      "5xl":     { "rem": 3.75,  "px": 60 },
      "display": { "rem": 5.5,   "px": 88 }
    },
    "fluid": {
      "sm":   "clamp(0.875rem, 2vw, 1rem)",
      "base": "clamp(1rem, 2.5vw, 1.125rem)",
      "lg":   "clamp(1.25rem, 3vw, 1.5rem)",
      "xl":   "clamp(1.5rem, 4vw, 2.25rem)",
      "2xl":  "clamp(1.875rem, 5vw, 3rem)",
      "display": "clamp(3rem, 8vw, 5.5rem)"
    },
    "detail": {
      "underline-offset": "0.2em",
      "underline-thickness": "1px",
      "underline-thickness-strong": "2px",
      "text-wrap-headings": "balance",
      "text-wrap-body": "pretty",
      "orphans": 2,
      "widows": 2,
      "hanging-punctuation": "first last",
      "ligatures": "common-ligatures"
    }
  },

  "spacing": {
    "base-unit": 4,
    "scale": {
      "0":  "0px",
      "1":  "4px",
      "2":  "8px",
      "3":  "12px",
      "4":  "16px",
      "5":  "20px",
      "6":  "24px",
      "8":  "32px",
      "10": "40px",
      "12": "48px",
      "16": "64px",
      "20": "80px",
      "24": "96px",
      "32": "128px",
      "40": "160px",
      "48": "192px"
    },
    "component": {
      "card-padding-sm": "16px",
      "card-padding-md": "24px",
      "card-padding-lg": "32px",
      "input-padding": "12px 16px",
      "button-padding-sm": "8px 16px",
      "button-padding-md": "12px 24px",
      "button-padding-lg": "16px 32px",
      "section-gap": "96px",
      "section-gap-sm": "64px",
      "subsection-gap": "48px"
    },
    "grid": {
      "columns": 12,
      "gutter": "24px",
      "max-width": "1280px",
      "margin-mobile": "24px",
      "margin-tablet": "48px",
      "margin-desktop": "auto"
    }
  },

  "shape": {
    "radius": {
      "none":     "0px",
      "xs":       "2px",
      "sm":       "4px",
      "md":       "8px",
      "lg":       "12px",
      "xl":       "16px",
      "2xl":      "24px",
      "squircle": "28px",
      "full":     "9999px"
    },
    "shadow": {
      "1": "0 1px 2px rgba(0,0,0,0.05)",
      "2": "0 2px 8px rgba(0,0,0,0.08)",
      "3": "0 4px 16px rgba(0,0,0,0.10)",
      "4": "0 8px 32px rgba(0,0,0,0.12)",
      "5": "0 16px 48px rgba(0,0,0,0.16)"
    },
    "border": {
      "width-default": "1px",
      "width-strong":  "2px",
      "width-focus":   "2px"
    }
  },

  "motion": {
    "easing": {
      "spring":       "cubic-bezier(0.34, 1.56, 0.64, 1)",
      "out":          "cubic-bezier(0.16, 1, 0.3, 1)",
      "in-out":       "cubic-bezier(0.65, 0, 0.35, 1)",
      "linear":       "linear",
      "snappy":       "cubic-bezier(0.2, 0, 0, 1)"
    },
    "duration": {
      "instant":      "0ms",
      "fast":         "100ms",
      "normal":       "200ms",
      "slow":         "350ms",
      "deliberate":   "500ms",
      "narrative":    "800ms"
    },
    "spring-config": {
      "stiffness": 300,
      "damping":   30,
      "mass":      1
    },
    "scroll-reveal": {
      "enabled":    true,
      "type":       "fade-up",
      "threshold":  0.15,
      "stagger-ms": 80
    },
    "reduced-motion": {
      "respect":   true,
      "fallback":  "opacity-only"
    }
  },

  "breakpoints": {
    "sm":  "640px",
    "md":  "768px",
    "lg":  "1024px",
    "xl":  "1280px",
    "2xl": "1536px"
  },

  "z-index": {
    "base":    0,
    "raised":  10,
    "dropdown": 100,
    "sticky":  200,
    "modal":   300,
    "toast":   400,
    "tooltip": 500
  },

  "dark-mode": {
    "strategy":   "class",
    "class-name": "dark",
    "fart-prevention": true,
    "color-scheme-meta": "dark light",
    "elevation-model": "5-level"
  },

  "forbidden_patterns": [
    "centered hero with 3 equal feature cards in a row directly below",
    "stock photo hero with blue/purple gradient overlay and white bold headline",
    "4 identical feature icons with one-sentence descriptions on white background",
    "testimonials section: circular avatar + 5 gold stars + full name + company",
    "pricing table: 3 equal-width cards, middle one highlighted with popular badge",
    "footer: 4 equal columns of links on dark background",
    "hamburger menu that slides in from right as full-screen overlay on mobile",
    "hero CTA: primary filled button + secondary ghost button side by side, centered",
    "section heading centered with subtitle centered underneath, both full-width",
    "progress bar with percentage labels for 'skills' section"
  ]
}
```

---

## Quick Reference — Skill Invocation Order

For any agent following this skill with no ambiguity about phase order:

```
Phase 1:  Read DESIGN.md, PRODUCT.md, TASTE.md
          → gbrain query "[fingerprint]"
          → extract anti-patterns from receipts

Phase 2:  design-extract [URL] (if reference URL exists)
          OR awesome-design-md (if no URL)

Phase 3:  design-brief → DESIGN.md
          → design-tokens.json (from template above)
          → TASTE.md (initialize with gbrain winning_decisions)

Phase 4:  [primary build skill from routing table]
          → [refinement layer: dark → high-end → motion → type]

Phase 5:  critique → vibecheck → typographic-detail (15 boxes) → ai-humanizer

Phase 6:  gbrain put taste/[project-slug] [receipt]
          → append winning_decision to TASTE.md
          → if anti-pattern seen 5+ times: gbrain put taste/skill-gaps/[slug]
```

Total phases: 6. Total verification steps: 4. Total memory writes: 1 per project minimum.
No phase is optional except Phase 2 (only runs when reference URL or explicit catalog
search is needed). Phase 6 is never optional.
```