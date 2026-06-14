# UI Skill Synthesis

## 1. SKILL CAPABILITY MAP

| Skill | Phase | Unique Capability | Chains To | Gap |
|---|---|---|---|---|
| `design-brief` | Pre-build | Parses natural language → 8-dim DESIGN.md spec | design-taste-frontend, impeccable | No brand asset ingestion (logos, existing screens) |
| `awesome-design-md` | Pre-build | Picks reference DESIGN.md from upstream catalog | Any build skill | Catalog is static; no similarity search |
| `design-extract` | Pre-build / Audit | Reverse-engineers live DOM → tokens, Tailwind config, shadcn theme, 17+ files | impeccable, design-taste-frontend | No screenshot-to-token path; DOM-only |
| `design-taste-frontend` | Build | Brief→Dial inference, 100+ rules, 78-box pre-flight, motion, dark mode | critique, vibecheck | No image-gen orchestration; no content copy |
| `design-taste-frontend-v1` | Build | Backward-compat v1 of above | critique | Fewer rules; silent Tailwind version assumptions |
| `stitch-design-taste` | Build | Translates taste → semantic DESIGN.md for Google Stitch agent | Manual Stitch paste | No MCP integration; human must relay spec |
| `gpt-taste` | Build | Deterministic RNG + AIDA + GSAP; prevents layout repetition | critique | Mock RNG; GSAP-heavy; no a11y; overkill for minimal briefs |
| `impeccable` | Build + Refine | 25-command orchestrator; context-driven via PRODUCT.md/DESIGN.md; live browser mode | All refinement skills | Requires context files; no greenfield cold-start |
| `impeccable-frontend` | Build | Aesthetic direction framework; tone + typography + layout before code | impeccable commands | No audit/refine loop; no dark mode |
| `impeccable-dark` | Refine | Depth model, elevation scale (5 levels), desaturation rules, FART prevention | impeccable color/theme | Light mode agnostic; no retroactive WCAG fix |
| `frontend-design` | Build | Bold aesthetic direction; full-page redesign from scratch | redesign-existing-projects | Less structured; no audit framework |
| `frontend-skill` | Build | Image-led hierarchy; content planning (hero→CTA); award constraints | high-end-visual-design | Not for dense dashboards; assumes image-forward |
| `high-end-visual-design` | Build | $150k anti-patterns ("Absolute Zero"), Creative Variance Engine, double-bezel, cubic-beziers | emil-design-eng | Complex setup; over-engineered for simple sites |
| `redesign-existing-projects` | Audit + Refine | 30-item audit checklist; prioritized fix list; stack-agnostic | impeccable, critique | Not for greenfield; assumes design exists |
| `emil-design-eng` | Refine | Animation decision framework; spring physics; clip-path; transform+opacity perf rules | Any build skill | Not a starting point; assumes interface exists |
| `critique` | Post-build | 5-dim radar (Philosophy/Hierarchy/Detail/Function/Innovation); Keep/Fix/Quick-wins | impeccable polish commands | Self-check only; no human feedback integration |
| `vibecheck` | Post-build | Silent narration of async/auth/middleware/closure/security gotchas | Any after code gen | Design-blind; code patterns only |
| `ai-humanizer` | Post-build | Kills em-dashes, AI vocab, clichés in prose/docs/READMEs | Publish step | No design copy tone enforcement |
| `industrial-brutalist-ui` | Build (register) | Swiss print (light) OR CRT (dark); hazard red; viewport-breaking type; ASCII ornament | web-prototype-taste-brutalist | Single substrate per project; no mixed-mode |
| `minimalist-ui` | Build (register) | Warm off-white #FBFBFA; serif-sans pair; desaturated pastels; no shadows above 4px | web-prototype-taste-editorial | No interactive state patterns |
| `liquid-glass-design` | Build (register) | iOS 26 morphing glass; SwiftUI/UIKit/WidgetKit; namespace transitions | Native iOS only | Web-incompatible; iOS-only |
| `web-prototype-taste-brutalist` | Build | Newsprint substrate; monospace metadata strip; specimen block; reveal-only motion | critique | Single-page only; no multi-section app shell |
| `web-prototype-taste-editorial` | Build | Bento uneven rows; scroll-fade+stagger; IntersectionObserver; eyebrow tags | critique | Not for marketing heavy CTA density |
| `web-prototype-taste-soft` | Build | Squircle radii; mandatory double-bezel; button-in-button CTA; spring motion | high-end-visual-design | Apple-aesthetic lock-in; not universal |
| `open-design-landing` | Build | Atelier Zero editorial; inputs.json→gpt-image-2→single HTML; 16 collage slots | Astro fork option | Manual inputs.json; no brief-to-config automation |

---

## 2. THE OPTIMAL CHAIN

### Foundation (all project types)
**Step 1:** `design-brief` — parse natural language brief → structured DESIGN.md (palette, typography, mood, density, constraints, layout intent). *Output: DESIGN.md.*

**Step 2:** `awesome-design-md` — match DESIGN.md against reference catalog → anchor brand register. *Output: reference DESIGN.md + upstream design system pointer.*

**Step 3 (conditional):** `design-extract` — if a reference site exists (competitor, inspiration URL), reverse-engineer its DOM → tokens, Tailwind config, motion values. *Output: 17+ token files.*

---

### Branch: Landing Page / Marketing Site
**Step 4:** `frontend-skill` (image-led, award constraints) OR `open-design-landing` (editorial collage) — generate scaffold with content hierarchy hero→support→detail→CTA. *Output: component scaffold.*

**Step 5:** `design-taste-frontend` — apply Brief→Dial→System mapping over scaffold; enforce 78-box pre-flight; add motion, dark mode protocol. *Output: production component.*

**Step 6:** `high-end-visual-design` — apply Absolute Zero anti-patterns, double-bezel where applicable, custom cubic-beziers. *Output: polished component.*

**Step 7:** `emil-design-eng` — spring physics, clip-path transitions, transform+opacity perf enforcement. *Output: animated component.*

---

### Branch: App Shell / Dashboard
**Step 4:** `impeccable-frontend` — establish aesthetic direction (tone + typography + layout constraints before code). *Output: design direction document.*

**Step 5:** `impeccable craft` (via PRODUCT.md + DESIGN.md loaded) — generate app shell with register-aware decisions. *Output: working app shell.*

**Step 6:** `impeccable-dark` — apply elevation scale, desaturated accents, FART prevention if dark mode required. *Output: dark theme tokens + component overrides.*

**Step 7:** `redesign-existing-projects` — run 30-item audit checklist against generated shell to surface weak points before shipping. *Output: prioritized fix list.*

---

### Branch: Prototype / Quick Spike
**Step 4:** Select style register by brief tone:
- "Swiss/brutal/manifesto" → `web-prototype-taste-brutalist`
- "Warm/editorial/Notion-tier" → `web-prototype-taste-editorial`
- "Apple/Linear/premium consumer" → `web-prototype-taste-soft`
- "Prevent repetition/GSAP/AIDA" → `gpt-taste`

**Step 5:** `critique` — 5-dim radar review; Keep/Fix/Quick-wins. *Output: scored review report.*

---

### Closing (all branches)
**Step N-1:** `vibecheck` — flag async/auth/closure/security gotchas in generated code. *Output: narrated pattern warnings.*

**Step N:** `ai-humanizer` — decontaminate any generated copy, docs, commit messages. *Output: human-voice prose.*

---

## 3. WHAT X SAYS IS MISSING

From the Twitter research, five clear patterns have no current skill coverage:

**1. Browser-native design tooling (Agentation pattern)**
Theo's highest-bookmark tweet: "design tooling moving to the browser and augmenting your real UI." No skill operates *on a live running app* to suggest design changes in situ. `impeccable live` exists but chains through a command, not a persistent browser overlay. Gap: no skill that connects to a running Chrome tab, identifies weak visual areas, and proposes/applies fixes interactively — the design-in-browser loop.

**2. Drag-and-drop HTML primitive layer**
rauchg's #1 tweet by velocity: "HTML is so back. Drag and drop." The celebration is raw HTML primitives beating component-framework abstractions for expressiveness. No skill generates plain HTML-first (no React, no Tailwind) with drag-and-drop interaction as a first-class output. All current skills assume a framework.

**3. Brief-to-ship pipeline timing pressure**
"181 days before GTA 6" as viral urgency frame. No skill enforces or communicates a shipping deadline constraint that affects design decisions (scope reduction, which polish is worth it, what to cut). The system has no concept of "ship quality vs. time budget."

**4. Rounded typographic details as craft signal**
pacocoursey's only cached tweet: praising rounded underlines. The craft community signals taste through sub-pixel typographic details (underline thickness, rounded terminals, optical sizing). No skill audits or enforces these — `redesign-existing-projects` has a typography checklist but no line-level detail enforcement.

**5. Agent capability composability (Skills API = npm for agents)**
rauchg's Skills API tweet (558 likes, 321 bookmarks): "npm registry for agent capabilities." The pattern devs are saving: modular agent skills that snap together like design tokens. No current skill teaches how to compose multiple design skills into a reusable pipeline artifact. Each skill is invoked manually; no meta-skill generates a project-specific skill composition manifest.

---

## 4. THE UNIFIED TRIGGER LOGIC

```
INPUT: user request + working directory context
         │
         ▼
┌─────────────────────────────┐
│ Does DESIGN.md exist?       │
│ Does PRODUCT.md exist?      │
└─────────────────────────────┘
         │ NO                    YES ──────────────────────────────►  impeccable [load-context]
         ▼
   design-brief  (always first, produces DESIGN.md)
         │
         ▼
┌─────────────────────────────┐
│ Is there a reference site   │
│ or competitor URL?          │
└─────────────────────────────┘
         │ YES                   NO
         ▼                        ▼
   design-extract           awesome-design-md
   (tokens → files)         (catalog match)
         │                        │
         └──────────┬─────────────┘
                    ▼
┌───────────────────────────────────────────────────────────────┐
│ APP TYPE                                                       │
├───────────────────────────────────────────────────────────────┤
│ Landing / Marketing         → frontend-skill                   │
│   + editorial collage       → open-design-landing             │
│   + Swiss/brutal            → web-prototype-taste-brutalist    │
│   + warm/Notion             → web-prototype-taste-editorial    │
│   + Apple/consumer          → web-prototype-taste-soft         │
│   + prevent repetition      → gpt-taste                       │
│                                                               │
│ App Shell / Dashboard       → impeccable-frontend             │
│   + dense data              → industrial-brutalist-ui         │
│   + clean SaaS              → minimalist-ui                   │
│                                                               │
│ iOS App                     → liquid-glass-design             │
│                                                               │
│ Existing site (audit)       → redesign-existing-projects      │
│                                                               │
│ Unknown / vague             → design-taste-frontend (default) │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ REFINEMENT LAYER            │
│                             │
│ Dark mode needed?           │──► impeccable-dark
│ Premium motion needed?      │──► emil-design-eng
│ $150k finish needed?        │──► high-end-visual-design
│ Self-check before commit?   │──► critique
│ Code gotchas?               │──► vibecheck
│ Any generated prose?        │──► ai-humanizer
└─────────────────────────────┘
```

**Routing heuristics (keyword triggers):**

| Signal in request | Route |
|---|---|
| "from scratch", "new app", "build me" + no context files | design-brief → branch |
| "redesign", "improve", "audit this" | redesign-existing-projects → critique |
| "Swiss", "brutal", "manifesto", "data dashboard" | industrial-brutalist-ui |
| "clean", "SaaS", "documentation", "minimal" | minimalist-ui |
| "Apple-like", "Linear", "premium consumer", "calm" | web-prototype-taste-soft |
| "iOS", "SwiftUI", "glass buttons", "iOS 26" | liquid-glass-design |
| "editorial", "magazine", "Monocle", "collage" | open-design-landing |
| "landing page", "marketing", "hero" (generic) | frontend-skill → design-taste-frontend |
| "dashboard", "admin", "analytics" | impeccable-frontend → minimalist-ui or brutalist |
| "animate", "motion", "interaction" | emil-design-eng (post-build) |
| "dark mode" anywhere | impeccable-dark (add to chain) |
| "make it less generic", "AI slop", "looks basic" | high-end-visual-design → critique |

---

## 5. SELF-IMPROVEMENT MECHANISM

**What gets saved after each project:**

After each completed project, the agent writes a taste receipt to gbrain. The receipt captures:
- Brief fingerprint: app type, audience, primary mood dial value, density dial value, variance dial value
- Which skill chain was invoked and in what order
- Which pre-flight boxes failed on first pass and required iteration
- Which anti-patterns were caught (by which skill) and what the fix was
- Final critique scores (5-dim radar values)
- One "design decision that worked" — the single most non-obvious choice that made the output distinctive

**Format for taste memory in gbrain:**

```
slug: taste/[project-slug]
---
brief_fingerprint:
  app_type: landing | dashboard | app_shell | prototype
  mood: [dial value 1-10]
  density: [dial value 1-10]
  variance: [dial value 1-10]
  audience: [descriptor]
  stack: [React/Next/plain HTML/etc]

chain_used: [ordered list of skill names]

pre_flight_failures:
  - box: [which of 78 boxes failed]
    fix: [what resolved it]

anti_patterns_caught:
  - pattern: [e.g. "centered hero with 3 equal cards"]
    caught_by: [skill]
    resolution: [asymmetric bento / staggered grid / etc]

critique_scores:
  philosophy: [0-10]
  hierarchy: [0-10]
  detail: [0-10]
  functionality: [0-10]
  innovation: [0-10]

winning_decision: [one non-obvious design choice that worked]
```

**How future sessions load and use past learnings:**

At session start, when a new brief is parsed, `design-brief` queries gbrain: `gbrain query "app_type:[X] mood:[Y] density:[Z]"`. It surfaces the 3 closest taste receipts by fingerprint similarity. These are injected into the dial-inference step — if past projects with similar fingerprints caught the same anti-pattern, the current session pre-empts it rather than waiting for critique.

The winning decisions accumulate into a project-local `TASTE.md` that becomes the third context file alongside PRODUCT.md and DESIGN.md. `impeccable`'s `load-context.mjs` reads it automatically.

**How the skill itself updates:**

After 5+ projects with the same anti-pattern repeatedly surfacing, the agent files a `skill-update` note to gbrain under `taste/skill-gaps`. When the skill is next opened for editing, these notes are surfaced at the top of the skill file as pending rule candidates. The human reviews and promotes them to the hardcoded anti-pattern list. This keeps the forbidden-pattern list empirically grounded rather than theoretically generated.

---

## 6. THE THREE SKILL GAPS TO FILL

### Gap 1: `design-live` — Browser-Overlay Design Iteration

**Purpose:** Connect to a running Chrome tab via CDP, visually identify weak areas in the live rendered UI, propose specific CSS/component fixes, and apply them in real time without leaving the browser context. Closes the Agentation gap identified in Twitter research.

**Inputs:**
- CDP connection to running Chrome (via browser-harness daemon)
- DESIGN.md + PRODUCT.md (optional, loaded from project root)
- Scope: element selector OR "full page audit"

**Outputs:**
- Narrated list of visual weaknesses (typography, spacing, color, hierarchy) with DOM selectors attached
- Proposed CSS overrides (inline or class-based, user's choice)
- Applied changes visible immediately in browser
- Diff of proposed changes saved as `design-live-patch.css` for promotion to codebase

**Chains to:** `impeccable polish`, `critique` (post-iteration), `redesign-existing-projects`

---

### Gap 2: `typographic-detail` — Sub-Pixel Craft Enforcement

**Purpose:** Audit and enforce the craft-level typographic details that distinguish professional design from AI-default output — rounded underlines, optical sizing, kern pairs, text-wrap balance, ligatures, line-height calibration per font, underline offset tuning. Closes the pacocoursey "rounded underlines" gap.

**Inputs:**
- Running component or static HTML
- Font stack (detected or specified)
- Target register: editorial / UI / marketing / mono

**Outputs:**
- Annotated list of typographic weaknesses with specific fix values
- CSS additions: `text-underline-offset`, `text-decoration-thickness`, `font-variant-ligatures`, `text-wrap: balance`, `font-optical-sizing: auto`, `letter-spacing` per size
- Font pairing validation (optical harmony check between display and body)
- Pre-flight block: 15 typographic boxes that must pass before shipping

**Chains to:** `impeccable typeset`, `emil-design-eng` (for animated text reveals), `ai-humanizer` (prose quality runs alongside typographic quality)

---

### Gap 3: `design-pipeline` — Skill Composition Manifest Generator

**Purpose:** Given a project brief, generate a reusable, version-controlled pipeline manifest (JSON + shell script) that specifies exactly which skills to invoke, in what order, with what inputs — analogous to rauchg's "npm registry for agent capabilities" pattern. Closes the agent composability gap.

**Inputs:**
- DESIGN.md (from design-brief)
- App type + team size + time budget (from brief or interactive prompt)
- Existing skills installed in `~/.claude/skills/`

**Outputs:**
- `pipeline.json`: ordered skill invocation spec with inputs, outputs, conditional branches, estimated token cost per step
- `run-pipeline.sh`: executable that invokes each skill in sequence, passing outputs as inputs to the next step
- `PIPELINE.md`: human-readable explanation of why each skill was chosen and what it contributes
- Gbrain entry under `taste/pipelines/[project-slug]` for reuse on similar future projects

**Chains to:** Every skill in the ecosystem (it is the orchestrator); updates based on `critique` scores and `vibecheck` findings from completed runs