

# SYSTEMDESIGN

I'll design this system with specificity — every piece must be directly implementable.

---

## A. THE PRE-BUILD PROTOCOL

Checklist every coding agent runs before writing any UI code for a new project.

```markdown
# UI Pre-Build Protocol — Required Before Any UI Code

## Gate 1: Brief Exists
- [ ] App name, domain, user persona, primary action defined in writing
- [ ] Anti-goals listed ("this is NOT a ___")
- [ ] Aesthetic target named (not "modern" — name a reference: "Stripe Docs", "Linear", "Monocle magazine")

## Gate 2: Research Complete
- [ ] Run: /ui-research-and-spec <app-name> <aesthetic-reference> <domain>
- [ ] RESEARCH.md exists at project root with: competitor screenshots, X patterns, color palette teardown
- [ ] At least 2 non-web references named (print, film, physical product)

## Gate 3: Design System Exists
- [ ] design-tokens.json at project root — all 12 mandatory fields populated
- [ ] DESIGN.md at project root — typography, spacing, motion, prohibitions sections
- [ ] Zero fields defaulted to Inter / #3B82F6 / rounded-lg / 0 1px 3px shadow / transition:all

## Gate 4: Slop Pre-flight
Run: node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs src/
- [ ] No Inter in font stack
- [ ] No #3B82F6 or blue-500 in tokens
- [ ] No "transition: all" anywhere
- [ ] No "0 1px 3px rgba(0,0,0,0.1)" shadow
- [ ] No "auto-fit, minmax(300px" grid
- [ ] No max-width: 1200px centered container
Slop score must be <20 before proceeding.

## Gate 5: Spec Exists
- [ ] SPEC.md per component — acceptance criteria, anti-patterns, reference screenshot
- [ ] Component scope confirmed: single component per agent session (not full page)

## Gate 6: Context Loaded
- [ ] DESIGN.md is FIRST context block in agent prompt (not appended)
- [ ] design-tokens.json pasted inline
- [ ] Reference screenshot attached or URL provided
```

**Enforcement:** Add to project `.claude/CLAUDE.md`:
```
Before writing any UI: run /ui-research-and-spec. Gates must pass. No exceptions.
```

---

## B. THE DESIGN TOKEN SYSTEM

### `design-tokens.json` — Mandatory 12 Fields

```json
{
  "_meta": {
    "project": "",
    "aesthetic_target": "",
    "references": [],
    "generated": "",
    "slop_score": null
  },
  "color": {
    "bg": "",
    "surface": "",
    "surface_elevated": "",
    "text_primary": "",
    "text_secondary": "",
    "text_muted": "",
    "accent": "",
    "accent_muted": "",
    "border": "",
    "border_subtle": "",
    "destructive": "",
    "success": ""
  },
  "typography": {
    "font_display": "",
    "font_body": "",
    "font_mono": "",
    "scale": {
      "xs": "",
      "sm": "",
      "base": "",
      "md": "",
      "lg": "",
      "xl": "",
      "2xl": "",
      "3xl": ""
    },
    "weight_light": "",
    "weight_regular": "",
    "weight_medium": "",
    "weight_bold": "",
    "leading_tight": "",
    "leading_normal": "",
    "leading_loose": "",
    "tracking_tight": "",
    "tracking_normal": "",
    "tracking_wide": ""
  },
  "spacing": {
    "unit": null,
    "scale": [null, null, null, null, null, null, null, null]
  },
  "radius": {
    "none": "0px",
    "sm": "",
    "md": "",
    "lg": "",
    "full": "9999px"
  },
  "shadow": {
    "none": "none",
    "sm": "",
    "md": "",
    "lg": ""
  },
  "motion": {
    "duration_fast": "",
    "duration_base": "",
    "duration_slow": "",
    "easing_standard": "",
    "easing_enter": "",
    "easing_exit": "",
    "reduced_motion_fallback": "none"
  },
  "border": {
    "width_hairline": "",
    "width_base": "",
    "width_thick": ""
  },
  "z_index": {
    "base": 0,
    "raised": 10,
    "overlay": 100,
    "modal": 200,
    "toast": 300
  },
  "prohibitions": {
    "forbidden_colors": [],
    "forbidden_patterns": [],
    "forbidden_fonts": [],
    "forbidden_components": []
  },
  "breakpoints": {
    "sm": "640px",
    "md": "768px",
    "lg": "1024px",
    "xl": "1280px"
  },
  "reuse_pattern": ""
}
```

### `DESIGN.md` — Template

```markdown
# Design System — [Project Name]
_Aesthetic target: [reference]. Generated: [date]. Reuse pattern: [slug]._

## Palette
| Token | Value | Usage |
|-------|-------|-------|
| bg | [hex] | Page background — surfaces, not components |
| surface | [hex] | Cards, panels |
| surface_elevated | [hex] | Modals, popovers |
| text_primary | [hex] | All body copy, headings |
| text_secondary | [hex] | Labels, captions |
| accent | [hex] | One interactive element per viewport max |
| border | [hex] | Dividers, input borders |

## Typography
- Display: [font], weights [X, Y, Z]
- Body: [font], weights [X, Y]
- Mono: [font] — code, data, timestamps only
- Scale: [list actual px values — NOT "text-sm" aliases]
- Line-height: [tight for headings], [normal for body]
- Letter-spacing: [specific values for display vs body]

## Spacing
- Unit: [Npx] (NOT 4 or 8 unless that's the deliberate choice)
- Allowed values: [explicit list]
- Section gap: [Npx]
- Component internal: [Npx]
- Between related elements: [Npx]

## Motion
- Default duration: [Nms] (must not be 200ms or 300ms unless intentional)
- Easing: [named cubic-bezier, not "ease-in-out"]
- What animates: transform, opacity ONLY — no layout properties
- prefers-reduced-motion: all transitions set to `none`

## Radius
- Components: [Npx]
- Buttons: [Npx]
- Inputs: [Npx]
- Cards: [Npx] — justify if > 6px

## Shadows
[Either: "No shadows. Use borders and whitespace." OR specific values for each level]

## Grid
- Columns: [N]
- Max content width: [Npx] — justify if 1200px
- Gutter: [Npx]

## Prohibitions (hard rules, no exceptions)
- DO NOT use Inter unless explicitly overridden
- DO NOT use #3B82F6 or any blue-500 equivalent
- DO NOT use `transition: all`
- DO NOT use `box-shadow: 0 1px 3px rgba(0,0,0,0.1)` — the default shadow
- DO NOT use `border-radius` > [Npx] without comment
- DO NOT hardcode hex values in component files — use tokens only
- DO NOT center hero sections without explicit approval
- DO NOT use `auto-fit, minmax(` grid without approval

## Reference components
[Screenshots or URLs for: card, button, form input, nav, hero]
```

### Token Population Rules

When populating tokens, the agent must:

1. **Color** — derive from aesthetic reference, not from defaults. Warm off-white (`#FAF8F5`) not gray-50. Terracotta or vermillion accent, not blue. If research shows blue is right, log justification in `_meta.references`.

2. **Typography** — pick fonts in order: editorial serif for display if content-heavy, grotesque for product/tool, monospace emphasis for data. Never default to Inter unless explicitly chosen. Font weights: use the lightest weight the design can support.

3. **Spacing unit** — use 5, 6, or 7px base unit instead of 4 or 8 to create non-default rhythm. Scale must include at least one non-round value.

4. **Radius** — default to lower than you think (2-4px for most components). Only go higher if reference explicitly shows soft UI.

5. **Shadows** — default to "none, use borders instead." Add shadows only if reference UI uses them.

6. **Motion** — pick a specific cubic-bezier from the reference UI (DevTools → Animations panel). Never copy-paste `ease-in-out`.

---

## C. THE RESEARCH WORKFLOW TEMPLATE

### `ui-research-and-spec` — Core Workflow

This is the callable workflow pattern. Runs as a skill or direct agent invocation.

**Inputs:**
```
app_name: str
domain: str              # "analytics dashboard" | "landing page" | "onboarding flow" | etc
aesthetic_target: str    # "Stripe Docs" | "Linear" | "Monocle magazine" | etc
x_accounts: list[str]   # optional: @accounts to pull from
competitor_urls: list[str]  # optional: sites to screenshot
brand_brief: str         # one paragraph
```

**Step 1: X Research (if x_accounts provided)**
```bash
for account in $X_ACCOUNTS; do
  twitter-pp-cli fetch --user $account --limit 50 --format json > research/x_${account}.json
done
# LLM pass: extract visual language signals from content
# What colors appear in screenshots? What aesthetic do viral posts use?
# Output: research/x_patterns.md
```

**Step 2: Competitor UI Teardown**
```bash
for url in $COMPETITOR_URLS; do
  # browser-harness screenshot
  # Extract: font stack, color palette, spacing rhythm, component patterns
  # DevTools: computed styles on body, h1, primary button, card
done
# Output: research/competitor_teardown.md with extracted token values
```

**Step 3: Reference Aesthetic Analysis**

Fetch the aesthetic reference (e.g., "Stripe Docs"):
- Screenshot or fetch URL via browser-harness
- Extract: background color, text colors, accent, font names, spacing values, border-radius, shadow strategy
- Log as concrete hex/px values, not descriptions

**Step 4: Non-Web Reference**

For the named aesthetic target, derive 2 non-web references:
- Print: magazine, book, newspaper in same aesthetic family
- Physical: packaging, product, architecture
- Film/Video: titles, interfaces, color grading
- Log: what visual principles transfer (density, texture, whitespace ratio, typographic hierarchy)

**Step 5: Slop Immunization**

Review research findings. Explicitly answer:
- What color would the default agent use here? Block it.
- What font would the default agent use here? Block it.
- What layout would the default agent use here? Block it.
- What would the statistically average output look like? Document it in `prohibitions`.

**Step 6: Generate RESEARCH.md**
```markdown
# Research — [App Name]

## Aesthetic Target
[Reference] → key principles extracted:
- [principle 1 with concrete value]
- [principle 2 with concrete value]

## X/Social Patterns
[What visual language appears in high-engagement content in this domain]

## Competitor Teardown
| Site | BG | Accent | Font | Radius | Shadow |
|------|----|--------|------|--------|--------|
| [URL] | [hex] | [hex] | [name] | [px] | [value] |

## Non-Web References
1. [Print reference] — borrowing: [specific visual principle]
2. [Physical reference] — borrowing: [specific visual principle]

## Extracted Token Draft
[Pre-filled design-tokens.json with concrete values from research]

## What the Default Agent Would Generate
BG: #F9FAFB, Font: Inter, Accent: #3B82F6, Radius: 8px, Shadow: 0 1px 3px rgba(0,0,0,0.1)

## Anti-Slop Immunization
[Specific prohibitions derived from the above]
```

**Step 7: Generate design-tokens.json + DESIGN.md**

Populate all 12 token fields from research findings. Every value must be traceable to a finding in RESEARCH.md — no invented values.

**Step 8: Slop Check**
```bash
node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs design-tokens.json
# Must score < 20 before DESIGN.md is considered complete
```

**Output files:**
```
research/
  RESEARCH.md
  x_patterns.md
  competitor_teardown.md
  screenshots/
design-tokens.json
DESIGN.md
PRODUCT.md (scaffolded, requires human review)
```

---

## D. THE VERIFICATION LOOP

### After Build: Automated Checks

**Step 1: Slop Check (code level)**
```bash
# slop-check.mjs — scans built files
node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs src/

CHECKS=(
  'Inter'                                    # 20pts
  '#3B82F6|blue-500|blue-400'               # 15pts
  '0 1px 3px rgba(0,0,0,0.1)'              # 15pts
  'transition: all'                          # 10pts
  'max-width: 1200px'                        # 10pts
  'auto-fit, minmax(300px'                   # 10pts
  'rounded-lg|rounded-md'                    # 5pts each
  '#F9FAFB|gray-50'                         # 5pts
  'font-family.*Inter'                       # 20pts
  'ease-in-out'                              # 5pts
)
# Total > 50: FAIL. 20-50: WARN. < 20: PASS.
```

**Step 2: Token Compliance Check**
```bash
# Verify no hardcoded values in component files
grep -rn '#[0-9a-fA-F]\{3,6\}' src/components/ --include="*.css" --include="*.tsx" --include="*.vue"
grep -rn 'font-size: [0-9]' src/components/
grep -rn 'padding: [0-9]\|margin: [0-9]' src/components/
# Any match = FAIL
```

**Step 3: Visual Screenshot + Impeccable Critique**
```bash
# browser-harness screenshot
browser-harness screenshot http://localhost:3000 --output verify/screenshot-$(date +%Y%m%d).png

# Then invoke impeccable critique
# /impeccable critique — against the screenshot
# Captures 5-dimension scores: philosophy, hierarchy, detail, functionality, innovation
# Threshold: total score must be > 35/50 to ship
```

**Step 4: Responsive Check**
```bash
# browser-harness screenshot at 4 breakpoints
for width in 375 768 1024 1440; do
  browser-harness screenshot http://localhost:3000 --width $width --output verify/responsive-${width}.png
done
# LLM vision pass: flag overflow, clipping, touch targets < 44px, text < 14px
```

**Step 5: Accessibility Pass**
```bash
# Via browser-harness JS eval
browser-harness eval "axe.run()" --output verify/a11y-report.json
# WCAG 2.2 AA violations = FAIL
```

### What Gets Saved to Gbrain

After a successful build (slop score < 20, impeccable score > 35/50, no a11y failures):

```bash
gbrain put design-pattern-$(slug $REUSE_PATTERN) << EOF
$(cat design-tokens.json)
---
impeccable_scores: $(cat verify/critique-scores.json)
slop_score: $(cat verify/slop-score.txt)
screenshot: verify/screenshot-latest.png
build_date: $(date +%Y-%m-%d)
project: $APP_NAME
EOF
```

**What's stored:**
- Complete `design-tokens.json` with all values
- Impeccable scores per dimension
- Slop score
- `deviations_from_default` — explicitly what was different from AI defaults
- `reuse_pattern` slug — retrievable for future projects

**Retrieval in future sessions:**
```bash
gbrain query "analytics dashboard editorial dense taste memory"
# Returns: matching design patterns with token values
# Agent uses as starting point for new project's design-tokens.json
```

### Taste Memory Query Format

At the start of a new build, query before running research:
```bash
gbrain query "design pattern ${DOMAIN} ${AESTHETIC_TARGET}"
```

If a match with score > 7/10 exists:
- Use its tokens as the starting draft for design-tokens.json
- Research phase verifies/updates rather than generates from scratch
- Iteration compounds rather than restarts

---

## E. THE SKILL FILE SPEC: `ui-research-and-spec`

### `~/.claude/skills/ui-research-and-spec/SKILL.md`

```markdown
---
name: ui-research-and-spec
version: 1.0.0
description: >
  Research-first UI design system generator. Runs before any UI code is written.
  Pulls X trends, screenshots competitors, tears down reference aesthetics, generates
  non-slop design-tokens.json and DESIGN.md. Chains to impeccable (post-build critique)
  and design-taste-frontend (code generation with tokens loaded).
trigger:
  - "new app"
  - "new UI"
  - "design system"
  - "starting a project"
  - "before writing UI"
  - explicitly: /ui-research-and-spec
inputs:
  required:
    - app_name: string
    - domain: string           # "dashboard" | "landing" | "onboarding" | "tool" | etc
    - aesthetic_target: string # Named reference, not adjective
    - brand_brief: string
  optional:
    - x_accounts: list[string]
    - competitor_urls: list[string]
    - constraints: list[string]  # explicit prohibitions
    - reuse_pattern: string      # slug to load from gbrain instead of researching
outputs:
  - research/RESEARCH.md
  - design-tokens.json
  - DESIGN.md
  - PRODUCT.md (scaffolded)
  - verify/slop-score-preflight.txt
chains_to:
  - impeccable: post-build (critique, audit, polish)
  - design-taste-frontend: during build (loads tokens, enforces prohibitions)
  - gbrain: post-verify (store successful patterns as taste memory)
scripts:
  - scripts/slop-check.mjs
  - scripts/token-validate.mjs
  - scripts/responsive-check.sh
  - scripts/research-pull.sh
---

## When to Invoke

- Any new app with a UI surface
- Any component build that doesn't have design-tokens.json at project root
- When /impeccable critique scores < 35/50 on an existing build (research phase may need redo)
- When gbrain query returns no matching taste memory (novel domain or aesthetic)

## When NOT to Invoke

- Content-only changes (copy edits, data changes)
- Backend-only work
- If design-tokens.json already exists and slop score < 20

## Invocation Pattern

```
/ui-research-and-spec \
  --app "Revenue Dashboard" \
  --domain "analytics dashboard" \
  --aesthetic "Bloomberg Terminal meets Stripe Docs" \
  --brief "Internal tool for sales team. Dense data. Trusted, not playful." \
  --competitors "linear.app, vercel.com/dashboard" \
  --x-accounts "@stripe @linear"
```

## Chain to Impeccable

After build:
```
/impeccable critique   # scores → gbrain if pass
/impeccable audit      # token compliance + a11y
/impeccable polish     # targeted refinements
```

## Chain to design-taste-frontend

In build prompt, prepend:
```
[Load: design-tokens.json]
[Load: DESIGN.md — read prohibitions section first]
Apply design-taste-frontend rules. Token values override any defaults.
```
```

---

## F. CLAUDE.MD UPDATE

Add these 3 lines to the `## Tools & CLIs` section and create a new `## UI System` section:

```markdown
## UI System
- Pre-build: /ui-research-and-spec required before any new UI surface. Outputs design-tokens.json + DESIGN.md. No UI code without these.
- Slop gate: slop-check.mjs must score < 20 on tokens before build and < 20 on src/ after build. Inter / #3B82F6 / transition:all / 0 1px 3px shadow / rounded-lg / max-width:1200px are auto-fail signals.
- Post-build: /impeccable critique → score > 35/50 → gbrain put design-pattern-[slug] with full token set. Future projects query gbrain first before researching from scratch.
```

Same block goes into `AGENTS.md` and `GEMINI.md` (behavior-equivalent phrasing for Gemini).

---

## Implementation Order

1. Create `~/.claude/skills/ui-research-and-spec/` directory and SKILL.md above
2. Write `scripts/slop-check.mjs` — the grep-based scorer, JSON output, exit code 1 if > 50
3. Write `scripts/research-pull.sh` — wraps twitter-pp-cli, browser-harness, outputs RESEARCH.md
4. Write `scripts/token-validate.mjs` — scans component files for hardcoded values
5. Add `design-tokens.json` template to `~/.claude/skills/ui-research-and-spec/templates/`
6. Add DESIGN.md template to same dir
7. Update CLAUDE.md + sync via `bash ~/claude-md-push/scripts/sync-global-instructions.sh`
8. Push to gbrain: `gbrain put ui-system-protocol < ui-system-spec.md`

The slop-check script is the highest-leverage single file. Everything else is scaffolding — that one script creates an objective gate that every agent session runs against automatically.

# SKILLFILE

Skill is installed. Here is what was written:

**Files created:**

- `/Users/martinofunrein/.claude/skills/ui-research-and-spec/SKILL.md` — complete skill file (6 steps, full templates, gbrain integration)
- `/Users/martinofunrein/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs` — scanner with 11 pattern checks, scored 0-50+, exits 1 on FAIL
- `/Users/martinofunrein/.claude/skills/ui-research-and-spec/scripts/token-validate.mjs` — flags hardcoded hex/px in component files, exits 1 on violations
- `/Users/martinofunrein/.claude/skills/ui-research-and-spec/scripts/research-pull.sh` — wraps browser-harness + twitter-pp-cli for X research, competitor screenshots, and DevTools teardown extraction

**Skill structure:**

- Frontmatter with `chains_to`, `scripts`, `templates` declared
- 6-gate pre-build protocol (Brief → Research → Tokens → Slop → Spec → Context)
- Step 1: gbrain query first, then X research, competitor teardown, reference aesthetic analysis, 2 non-web references, anti-slop immunization
- Step 2: token generation rules with explicit population logic per field (color, type, spacing, radius, shadow, motion) — anti-default rationale for each
- Step 3: DESIGN.md template with all mandatory sections and a `prohibitions` block
- Step 4: SPEC.md per component with acceptance criteria, anti-patterns, scope boundary
- Step 5: build invocation pattern — DESIGN.md loads first, CSS custom property mapping required, tokens inline in prompt
- Step 6: verification chain — slop check on src/, token-validate, browser-harness screenshot + `/impeccable critique` (threshold 35/50), responsive at 4 breakpoints, axe WCAG AA pass
- Gbrain write format with slug convention `design-pattern-{domain}-{aesthetic-slug}`, deviations-from-default field, retrieval query pattern for future sessions

**Invoke with:**
```bash
/ui-research-and-spec --app NAME --domain DOMAIN --aesthetic "REFERENCE" --brief "PARAGRAPH"
```

# WORKFLOWTEMPLATE

```javascript
// ~/.claude/workflows/ui-research.js
// UI Research Workflow — generic template for any project
// Usage: Workflow({scriptPath: "~/.claude/workflows/ui-research.js", args: {appName: "MyApp", brief: "...", referenceUIs: ["linear.app"], xSearchTerms: ["product design"]}})

export const meta = {
  name: "ui-research",
  description: "Research reference UIs, synthesize design tokens, and write DESIGN.md for any project",
  args: {
    appName: { type: "string", required: true, description: "Name of the app being designed" },
    brief: { type: "string", required: true, description: "One-paragraph design brief describing the product and target feel" },
    referenceUIs: { type: "array", required: false, default: [], description: "List of reference UI URLs or app names (e.g. ['linear.app', 'superhuman.com'])" },
    xSearchTerms: { type: "array", required: false, default: [], description: "Additional Twitter/X search terms for design trend research" },
    outputDir: { type: "string", required: false, default: ".", description: "Directory to write DESIGN.md and design-tokens.json" },
  },
};

export default async function uiResearch({ appName, brief, referenceUIs = [], xSearchTerms = [], outputDir = "." }, { agent, parallel }) {

  // ── Phase 1: Research ──────────────────────────────────────────────────────

  const defaultSearchTerms = [
    `${appName} UI design`,
    "app design trends 2025",
    "product design inspiration",
    "design system tokens",
  ];

  const allSearchTerms = [...defaultSearchTerms, ...xSearchTerms];

  const twitterSearchTasks = allSearchTerms.map((term) =>
    agent({
      description: `Twitter/X search: "${term}"`,
      prompt: `
        Use twitter-pp-cli to search Twitter/X for: "${term}"
        Collect the top 10-15 posts. Extract:
        - Recurring visual patterns mentioned (colors, typography, spacing, motion)
        - Specific UI components praised or criticized
        - Designer/studio names producing standout work in this space
        - Any links to live examples or Figma files
        Return a JSON object: { term: string, patterns: string[], components: string[], influencers: string[], links: string[] }
      `,
      tools: ["Bash"],
    })
  );

  const referenceUITasks = referenceUIs.map((url) =>
    agent({
      description: `Reference UI analysis: ${url}`,
      prompt: `
        Analyze the UI/UX of "${url}" as a reference for designing "${appName}".
        Use WebFetch or browser tools to inspect the live site if possible.
        Extract:
        - Color palette (primary, secondary, surface, text, accent — with hex values if detectable)
        - Typography (font families, size scale, weight usage)
        - Spacing rhythm (base unit, common spacings)
        - Border radius scale
        - Shadow / elevation system
        - Motion / animation character (snappy, smooth, minimal, playful)
        - Key interaction patterns (hover states, transitions, loading states)
        - Overall aesthetic adjectives (3-5 words)
        Return a JSON object: { url: string, colors: object, typography: object, spacing: object, radii: object, shadows: object, motion: string, patterns: string[], aesthetic: string[] }
      `,
      tools: ["WebFetch", "Bash"],
    })
  );

  const [twitterResults, referenceResults] = await parallel([
    parallel(twitterSearchTasks),
    parallel(referenceUITasks),
  ]);

  // ── Phase 2: Token Generation ──────────────────────────────────────────────

  const synthesisResult = await agent({
    description: "Synthesize research into design tokens",
    prompt: `
      You are a senior product designer synthesizing UI research for "${appName}".

      ## Product Brief
      ${brief}

      ## Twitter/X Research Findings
      ${JSON.stringify(twitterResults, null, 2)}

      ## Reference UI Analysis
      ${JSON.stringify(referenceResults, null, 2)}

      Your task: Synthesize all research into a cohesive design language for "${appName}".

      Produce two outputs:

      ### 1. DESIGN.md content
      A brand-style design document (Markdown) covering:
      - **Aesthetic Direction** — 3-5 adjectives, one paragraph vision statement
      - **Color System** — primary, secondary, accent, surface, background, text, border, error, success (light + dark mode)
      - **Typography** — font stack, size scale (xs/sm/base/lg/xl/2xl/3xl), weights, line heights
      - **Spacing** — base unit, scale (1-12 steps)
      - **Border Radius** — none/sm/md/lg/xl/full
      - **Shadows / Elevation** — 4-5 levels
      - **Motion** — duration scale, easing curves, interaction character
      - **Component Patterns** — buttons, inputs, cards, navigation, data tables (key rules only)
      - **Do / Don't** — 5 rules each
      - **Reference Influences** — which references informed which decisions

      ### 2. design-tokens.json content
      A flat JSON of CSS custom property tokens:
      {
        "color-primary": "#...",
        "color-primary-hover": "#...",
        "color-surface": "#...",
        "color-surface-dark": "#...",
        ... (complete set, light + dark mode variants with -dark suffix)
        "font-sans": "...",
        "font-mono": "...",
        "text-xs": "...",
        ... (complete type scale)
        "space-1": "4px",
        ... (12-step scale)
        "radius-sm": "...",
        ...
        "shadow-sm": "...",
        ...
        "duration-fast": "...",
        "duration-base": "...",
        "duration-slow": "...",
        "ease-default": "...",
        "ease-spring": "..."
      }

      Return a JSON object with two string fields:
      { "designMd": "<full markdown string>", "tokensJson": "<stringified JSON>" }
    `,
    tools: [],
  });

  let designMd, tokensJson;
  try {
    const parsed = typeof synthesisResult === "string" ? JSON.parse(synthesisResult) : synthesisResult;
    designMd = parsed.designMd;
    tokensJson = parsed.tokensJson;
  } catch {
    designMd = synthesisResult;
    tokensJson = "{}";
  }

  // ── Phase 3: Write Files ───────────────────────────────────────────────────

  await parallel([
    agent({
      description: "Write DESIGN.md",
      prompt: `
        Write the following content to the file at: ${outputDir}/DESIGN.md
        Create parent directories if needed (mkdir -p).

        Content:
        ${designMd}

        Use the Write tool or Bash. Confirm the file was written successfully.
      `,
      tools: ["Write", "Bash"],
    }),
    agent({
      description: "Write design-tokens.json",
      prompt: `
        Write the following content to the file at: ${outputDir}/design-tokens.json
        Create parent directories if needed (mkdir -p).

        Content:
        ${tokensJson}

        Use the Write tool or Bash. Confirm the file was written successfully.
      `,
      tools: ["Write", "Bash"],
    }),
  ]);

  // ── Phase 4: Gbrain ────────────────────────────────────────────────────────

  await agent({
    description: "Save taste learnings to Gbrain",
    prompt: `
      Save UI research learnings for "${appName}" to Gbrain.

      Run this command:
      gbrain put "ui-research/${appName.toLowerCase().replace(/\s+/g, "-")}" <<'EOF'
      # UI Research: ${appName}
      Date: ${new Date().toISOString().split("T")[0]}

      ## Brief
      ${brief}

      ## References Analyzed
      ${referenceUIs.join(", ") || "none"}

      ## Key Design Decisions
      (Extracted from synthesis — paste top 5 token choices and rationale here)

      ## Aesthetic Adjectives
      (From DESIGN.md)

      ## Files Written
      - ${outputDir}/DESIGN.md
      - ${outputDir}/design-tokens.json
      EOF

      If gbrain is not available, skip silently. Report success or skip.
    `,
    tools: ["Bash"],
  });

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    appName,
    filesWritten: [`${outputDir}/DESIGN.md`, `${outputDir}/design-tokens.json`],
    twitterSearchCount: twitterResults.length,
    referenceUICount: referenceResults.length,
    status: "complete",
  };
}
```

Key design decisions:

- **Phase 1 is fully parallel** — all Twitter searches and all reference UI fetches fire simultaneously with `parallel([parallel(...), parallel(...)])`.
- **Token names** follow CSS custom property conventions with `-dark` suffix variants so they map directly to `:root {}` or Tailwind config without transformation.
- **Synthesis agent gets no tools** — pure reasoning pass over structured JSON inputs keeps it fast and deterministic.
- **Phase 3 is parallel** — DESIGN.md and design-tokens.json write concurrently.
- **Gbrain slug** is auto-derived from `appName` so runs don't collide across projects.
- **`outputDir` arg** defaults to `.` so it writes next to wherever you invoke it, but you can pass your project root.

Save to `~/.claude/workflows/ui-research.js` and invoke as shown in the meta block.

# FINALPLAN

# UI Excellence System — Implementation Plan

## What We're Building

A research-first gate that runs before any UI code is written. Every new project passes through a mandatory pipeline: gbrain query (taste memory retrieval) → X/competitor research → aesthetic teardown → slop-immunized token generation → DESIGN.md + design-tokens.json → code with tokens pre-loaded → post-build critique and score threshold before shipping. The system prevents AI default aesthetics (Inter/blue-500/rounded-lg/1px-shadow) from appearing by making the slop-check a hard exit code 1 gate, not a suggestion.

The benefit compounds. Each successful build that passes the verification loop gets stored in gbrain as a taste memory slug. Future projects in the same domain query gbrain first and inherit the successful token set rather than researching from scratch. Over time the system builds a personal design vocabulary that agents retrieve automatically, so quality asymptotes toward high rather than regressing to statistical average with each new session.

---

## Files To Create

```
~/.claude/skills/ui-research-and-spec/
  SKILL.md                              — main skill file, frontmatter + 6-gate protocol
  scripts/
    slop-check.mjs                      — scores src/ or tokens file, exits 1 if > 50
    token-validate.mjs                  — scans component files for hardcoded hex/px values
    research-pull.sh                    — wraps browser-harness + twitter-pp-cli, outputs RESEARCH.md
  templates/
    design-tokens.json                  — 12-field template, all values blank
    DESIGN.md                           — section template with mandatory headings
    SPEC.md                             — per-component acceptance criteria template

~/.claude/workflows/
  ui-research.js                        — parallel workflow: research → synthesize → write → gbrain

~/.claude/skills/ui-research-and-spec/scripts/
  responsive-check.sh                   — browser-harness screenshot at 375/768/1024/1440
```

---

## CLAUDE.md/AGENTS.md Addition

Add to `## UI System` section (new section, after `## Tools & CLIs`):

```
## UI System
- Pre-build gate: /ui-research-and-spec required before any new UI surface. No UI code without design-tokens.json + DESIGN.md at project root. Slop score must be < 20.
- Hard prohibitions (auto-fail): Inter font, #3B82F6, `transition: all`, `0 1px 3px rgba(0,0,0,0.1)`, `rounded-lg` without override, `max-width: 1200px`, `auto-fit, minmax(300px`.
- Taste memory: after build passes impeccable score > 35/50, run `gbrain put design-pattern-{domain}-{aesthetic}` with full token set. Future projects: `gbrain query "design pattern {domain} {aesthetic}"` before researching.
```

Same block in AGENTS.md verbatim. GEMINI.md: swap `/ui-research-and-spec` for `invoke ui-research-and-spec skill` and drop the slash-command syntax.

---

## Installation Steps

**1. Create skill directory**
```bash
mkdir -p ~/.claude/skills/ui-research-and-spec/scripts
mkdir -p ~/.claude/skills/ui-research-and-spec/templates
mkdir -p ~/.claude/workflows
```

**2. Write SKILL.md**

File already created at `/Users/martinofunrein/.claude/skills/ui-research-and-spec/SKILL.md`. Verify:
```bash
head -5 ~/.claude/skills/ui-research-and-spec/SKILL.md
```

**3. Write slop-check.mjs**

File already created at `/Users/martinofunrein/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs`. Test immediately:
```bash
node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs ~/.claude/skills/ui-research-and-spec/templates/design-tokens.json
# Expect: PASS (blank template has no slop values)
```

**4. Write token-validate.mjs**

File already created at `/Users/martinofunrein/.claude/skills/ui-research-and-spec/scripts/token-validate.mjs`. Test:
```bash
echo 'color: #3B82F6;' > /tmp/test.css
node ~/.claude/skills/ui-research-and-spec/scripts/token-validate.mjs /tmp/test.css
# Expect: exit 1 with violation logged
```

**5. Write research-pull.sh**

File already created. Make executable:
```bash
chmod +x ~/.claude/skills/ui-research-and-spec/scripts/research-pull.sh
```

**6. Write the templates**
```bash
# design-tokens.json template — copy the 12-field blank from plan section B
# DESIGN.md template — copy from plan section B
# SPEC.md — create minimal: Name, Acceptance Criteria, Anti-patterns, Scope
```

**7. Write the workflow**
```bash
# ~/.claude/workflows/ui-research.js — already specced above
# File already created per workflow template
```

**8. Update CLAUDE.md**
```bash
# Add ## UI System block to ~/.claude/CLAUDE.md
# Then sync:
bash ~/claude-md-push/scripts/sync-global-instructions.sh
```

**9. Mirror to claude-md-push**
```bash
rsync -a ~/.claude/skills/ui-research-and-spec/ ~/claude-md-push/skills/ui-research-and-spec/
cd ~/claude-md-push && git add skills/ui-research-and-spec/ CLAUDE.md AGENTS.md GEMINI.md
git commit -m "feat: ui-research-and-spec skill + slop gate + taste memory system"
git push
```

**10. Seed gbrain**
```bash
gbrain put ui-system-protocol << 'EOF'
# UI Excellence System Protocol
Date: 2026-06-12

## Purpose
Research-first gate before any UI code. Prevents AI default aesthetics.

## Skill
~/.claude/skills/ui-research-and-spec/
Invoke: /ui-research-and-spec --app NAME --domain DOMAIN --aesthetic "REFERENCE" --brief "PARAGRAPH"

## Hard Prohibitions
Inter, #3B82F6, transition:all, 0 1px 3px rgba(0,0,0,0.1), rounded-lg, max-width:1200px

## Taste Memory Slug Pattern
design-pattern-{domain}-{aesthetic-slug}
Query: gbrain query "design pattern {domain} {aesthetic}"

## Verification Threshold
slop score < 20, impeccable > 35/50, WCAG AA pass

## Workflow
~/.claude/workflows/ui-research.js
EOF
```

**11. Sync skill symlinks**
```bash
bash ~/claude-md-push/scripts/sync-skill-symlinks.sh
```

**12. Verify end-to-end**
```bash
# Smoke test: run slop-check on a file you know has slop
echo 'font-family: Inter; color: #3B82F6;' > /tmp/slop-test.css
node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs /tmp/slop-test.css
# Expect: FAIL, exit 1, score > 50
```

---

## How Future Projects Use This

**Scenario: "I want to build a real estate search app"**

1. **Query taste memory first**
```bash
gbrain query "design pattern real estate search editorial"
# If match > 7/10: load that token set as draft, skip to step 4
# If no match: continue
```

2. **Run the research workflow**
```bash
/ui-research-and-spec \
  --app "HomeSearch" \
  --domain "real estate search" \
  --aesthetic "NYT Real Estate section meets Rightmove UK" \
  --brief "Property search tool. Dense listings. Trust over playfulness. Photography-forward." \
  --competitors "rightmove.co.uk, zillow.com" \
  --x-accounts "@zillow @compass"
```
Outputs: `research/RESEARCH.md`, `design-tokens.json`, `DESIGN.md`

3. **Verify tokens pass slop gate**
```bash
node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs design-tokens.json
# Must exit 0, score < 20
```

4. **Load into coding agent context**

Start the build session with this exact context order:
```
[1] Paste design-tokens.json inline
[2] Paste DESIGN.md — agent reads prohibitions section first
[3] Invoke design-taste-frontend skill
[4] State the component scope (one component per session)
```

5. **Build with skill chain**
```
/design-taste-frontend
# Builds against loaded tokens
# Token values override any defaults
# CSS custom properties only — no hardcoded hex in component files
```

6. **Run post-build verification**
```bash
# Slop check on built files
node ~/.claude/skills/ui-research-and-spec/scripts/slop-check.mjs src/

# Token compliance
node ~/.claude/skills/ui-research-and-spec/scripts/token-validate.mjs src/components/

# Visual critique
/impeccable critique
# Scores per dimension → must total > 35/50

# Responsive
bash ~/.claude/skills/ui-research-and-spec/scripts/responsive-check.sh http://localhost:3000
```

7. **Save to taste memory if passing**
```bash
gbrain put design-pattern-real-estate-editorial << EOF
$(cat design-tokens.json)
---
project: HomeSearch
impeccable_score: 38/50
slop_score: 12
deviations_from_default:
  - Used Canela Display (not Inter) for property headlines
  - Accent: #C4622D terracotta (not blue)
  - Shadow: none — borders + whitespace only
  - Radius: 2px (not 8px)
  - Base unit: 6px (not 4px or 8px)
build_date: 2026-06-12
EOF
```

---

## The Taste Memory System

**Storage format in gbrain:**

Slug convention: `design-pattern-{domain-slug}-{aesthetic-slug}`

Examples:
- `design-pattern-analytics-dashboard-bloomberg`
- `design-pattern-landing-page-editorial-monocle`
- `design-pattern-onboarding-flow-linear`
- `design-pattern-real-estate-nyt`

Each entry contains:
```
Full design-tokens.json values (all 12 fields)
impeccable_score: N/50
slop_score: N
deviations_from_default: [list of what was deliberately different from AI defaults]
project: [app name that generated this]
build_date: YYYY-MM-DD
references_used: [list of reference UIs analyzed]
```

**Retrieval at session start:**
```bash
gbrain query "design pattern analytics dashboard dense"
# Returns: closest matching slug + token set
# Agent uses as draft — research phase verifies rather than generates from scratch
```

**Match threshold:** Score > 7/10 from gbrain → use as starting draft. Score 5-7 → use as reference, still run research. Score < 5 → run full research pipeline.

**What compounds:** Each successful build adds one entry. After 5-10 projects, gbrain contains a curated set of anti-slop token sets across domains. The retrieval starts returning high-quality starting points instead of blank templates. Iteration compresses from 2 hours (full research) to 20 minutes (verify + adjust existing pattern).

---

## Integration With Existing Skills

**→ impeccable**

Runs post-build. Receives screenshot from browser-harness. Scores 5 dimensions (philosophy, hierarchy, detail, functionality, innovation). Threshold: 35/50 total. Below threshold: agent returns specific fixes, not a full rebuild. Above threshold: gbrain write fires automatically.

Chain:
```
build complete → /impeccable critique → score < 35 → /impeccable polish (targeted) → re-score → gbrain if pass
```

**→ design-taste-frontend**

Loads at build start. DESIGN.md must be in context before this skill activates. Token values in design-tokens.json override anything design-taste-frontend would otherwise generate. The skill enforces the token contract — any component it produces maps to `var(--token-name)`, never hardcoded values.

Chain:
```
design-tokens.json + DESIGN.md loaded → /design-taste-frontend → builds component → token-validate passes → done
```

**→ browser-harness**

Used in two phases:
1. Research phase: screenshots competitor URLs, extracts computed styles via JS eval (`getComputedStyle` on key elements)
2. Verification phase: screenshots built UI at 4 breakpoints, feeds to impeccable critique

Browser-harness connects to running Chrome Beta via CDP. research-pull.sh invokes it directly. No Playwright fallback during research — CDP gives live computed styles, not static HTML.

**→ gbrain**

Runs in two phases:
1. Session start: query for matching taste memory → pre-populate tokens
2. Session end (post-verify): write successful pattern with full token set + scores

gbrain is the only durable storage. RESEARCH.md and DESIGN.md are project-local artifacts. gbrain holds the distilled learnings that travel across projects and machines.

---

## Success Criteria

**Measurable: what "no slop" looks like**

| Signal | Slop | Pass |
|--------|------|------|
| Font | Inter in stack | Any intentional alternative with written justification |
| Primary accent | #3B82F6 ± 10% hue | Any color derivable from research findings |
| Shadow | `0 1px 3px rgba(0,0,0,0.1)` | Either "none" or a value from reference UI DevTools |
| Radius | 8px default | Value traceable to RESEARCH.md |
| Spacing unit | 4px or 8px | Any non-default unit with written rationale |
| Transition | `transition: all` | Property-specific transitions only |
| Layout max-width | 1200px | Value from reference UI or justified differently |

**Automated gates (exit codes):**
- `slop-check.mjs` on tokens: exit 0 (score < 20) before build starts
- `slop-check.mjs` on src/: exit 0 (score < 20) before shipping
- `token-validate.mjs` on src/components/: exit 0 (no hardcoded hex/px)
- impeccable critique: total score > 35/50

**The system is working when:**
1. An agent starting a new project immediately runs `/ui-research-and-spec` without being told to
2. The slop-check blocks a build before any slop ships
3. gbrain returns a matching taste pattern for a domain within 3 projects of that domain being built
4. Two different projects in the same domain by different agents produce visually distinct but both non-slop outputs