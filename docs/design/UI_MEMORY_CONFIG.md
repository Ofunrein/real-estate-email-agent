## 1. GBRAIN TASTE MEMORY FORMAT

**Slug convention:** `taste/<project-slug>` (e.g., `taste/lumenosis-landing`, `taste/avm-dashboard`)

**Required fields:**

```markdown
# Taste Memory: <Project Name>

## Meta
- slug: taste/<project-slug>
- date: YYYY-MM-DD
- skill: <ui-craft | impeccable | frontend-skill | etc>
- type: <landing | dashboard | component | carousel | mobile | admin>
- verdict: <shipped | iterated | scrapped>

## Stack
- framework: <Next.js | plain HTML | React | etc>
- styling: <Tailwind | CSS modules | inline | etc>
- motion: <Framer Motion | CSS | none>
- fonts: <list>
- palette: <hex codes or token names>

## What Worked
- <specific pattern, e.g. "editorial grid: 3-col asymmetric with bleed image left">
- <e.g. "sparse nav — logo + 1 CTA only, no hamburger on desktop">
- <e.g. "60px section gaps felt tight; 120px was right for this density">

## What Failed
- <e.g. "glassmorphism on dark bg — looked generic, reverted">
- <e.g. "hero video autoplay blocked on mobile, wasted 2 iterations">

## Reusable Patterns
- <copy-paste-ready class combos or component descriptions>
- <e.g. "section rhythm: py-24 md:py-40 with max-w-5xl mx-auto px-6">

## Design Refs Used
- <URLs or DESIGN.md path that informed the build>

## Prompt Delta
<!-- What prompt addition would have gotten this right on pass 1 -->
- <e.g. "Specify 'no cards, no shadows, flat editorial' explicitly">
```

**Example entry** (`gbrain put taste/lumenosis-landing < file.md`):

```markdown
# Taste Memory: Lumenosis Landing

## Meta
- slug: taste/lumenosis-landing
- date: 2026-06-12
- skill: impeccable
- type: landing
- verdict: shipped

## Stack
- framework: Next.js App Router
- styling: Tailwind v4
- motion: Framer Motion (scroll-triggered only)
- fonts: Geist Sans, Geist Mono
- palette: #0A0A0A bg, #F5F5F0 text, #7C3AED accent

## What Worked
- Full-bleed hero with single h1, no subheadline clutter
- Mono font for stat callouts — creates editorial tension
- Section separator: 1px border-white/10, no padding card boxes
- CTA above fold as text link, not button — converted better in tests

## What Failed
- Animated gradient mesh — killed perf on mid-range Android
- 3-column feature grid — felt like SaaS template, removed

## Reusable Patterns
- Hero: `min-h-screen flex flex-col justify-end pb-24 px-6 max-w-none`
- Body sections: `py-32 px-6 max-w-4xl mx-auto`
- Stat block: `font-mono text-6xl font-light tabular-nums`

## Design Refs Used
- ~/claude-md-push/skills/design-taste-frontend/DESIGN.md
- https://linear.app (spacing reference)

## Prompt Delta
- Add: "editorial, not SaaS; no feature cards; mono stats; dark bg"
```

---

## 2. TASTE MEMORY QUERY PATTERN

**Query to run at session start for any UI task:**

```bash
gbrain query "taste UI <project-type> what worked design patterns"
# e.g.:
gbrain query "taste landing page what worked dark editorial"
gbrain query "taste dashboard component patterns"
```

**Secondary targeted query if project-type is known:**

```bash
gbrain query "taste/<slug>" 2>/dev/null || gbrain query "taste UI <type>"
```

**Injection pattern — paste into build prompt:**

```
## Past Taste Learnings (load before building)
<paste gbrain query output here>

Weight: newer entries (2025+) > older. If conflict, newer wins.
Apply "What Worked" as constraints. Apply "What Failed" as hard exclusions.
Apply "Prompt Delta" additions verbatim to this prompt.
```

**Weighting rule:**
- Entries < 90 days old: full weight (apply as hard rules)
- 90–180 days: soft guidance (apply unless contradicted by DESIGN.md)
- > 180 days: reference only (note pattern, but defer to current DESIGN.md)

Date-sort: `gbrain query` returns newest first by default; take top 3 matching entries.

---

## 3. CLAUDE.MD / AGENTS.MD ADDITIONS

Add these lines to the **Prime Rules** section, after the Canvas LMS bullet:

```
- UI: never write any UI without first reading the relevant DESIGN.md (`~/claude-md-push/skills/design-taste-frontend/DESIGN.md` for web; `~/claude-md-push/skills/design-taste-frontend-v1/` for fallback). Run `gbrain query "taste UI <type>"` and inject top-3 results as hard constraints before the first line of code.
- UI skill routing: landing/hero/marketing → `impeccable` or `frontend-skill`; component/system → `impeccable-frontend`; dark editorial → `impeccable-dark`; admin/analytics → `dashboard`; mobile → `mobile-app`. Load with Skill tool before generating any HTML/JSX.
- After any UI project ships, write a taste memory (`gbrain put taste/<slug>`) using the format in `~/claude-md-push/docs/taste-memory-format.md`. Required fields: stack, what worked, what failed, reusable patterns, prompt delta.
- Taste memory lives in gbrain under `taste/*` slugs. Query before build, write after ship. This is not optional.
```

---

## 4. SKILL INSTALLATION COMMANDS

```bash
# Install ui-craft (if published to skills registry)
npx -y skills add ui-craft -g --copy

# Install ui-research-and-spec
npx -y skills add ui-research-and-spec -g --copy

# If installing from local/custom path:
cp -r ~/path/to/ui-craft ~/.claude/skills/ui-craft
cp -r ~/path/to/ui-research-and-spec ~/.claude/skills/ui-research-and-spec

# Mirror to claude-md-push backup
rsync -a ~/.claude/skills/ui-craft/ ~/claude-md-push/skills/ui-craft/
rsync -a ~/.claude/skills/ui-research-and-spec/ ~/claude-md-push/skills/ui-research-and-spec/

# Sync symlinks to all agent dirs
bash ~/claude-md-push/scripts/sync-skill-symlinks.sh
```

**Where files live:**
- Live canonical: `~/.claude/skills/ui-craft/` and `~/.claude/skills/ui-research-and-spec/`
- Git mirror: `~/claude-md-push/skills/ui-craft/` and `~/claude-md-push/skills/ui-research-and-spec/`
- Symlinked automatically to: `~/.cursor/skills/`, `~/.codex/skills/`, `~/.anthropic-claude/skills/`, `~/.gemini/skills/`

---

## 5. BOOTSTRAP INTEGRATION

Add to `~/claude-md-push/bootstrap.sh` after the existing skills sync block:

```bash
# --- UI Taste System ---
echo "[bootstrap] Installing UI craft skills..."

# Install skills if not present
for skill in ui-craft ui-research-and-spec design-taste-frontend impeccable; do
  if [ ! -d "$HOME/.claude/skills/$skill" ]; then
    if [ -d "$HOME/claude-md-push/skills/$skill" ]; then
      cp -r "$HOME/claude-md-push/skills/$skill" "$HOME/.claude/skills/$skill"
      echo "  restored $skill from claude-md-push"
    else
      echo "  WARN: $skill not found in claude-md-push/skills/ — install manually"
    fi
  fi
done

# Write taste memory format doc so agents can reference it
mkdir -p "$HOME/claude-md-push/docs"
if [ ! -f "$HOME/claude-md-push/docs/taste-memory-format.md" ]; then
  echo "  WARN: taste-memory-format.md missing from docs/ — add from gbrain"
  # gbrain get taste-memory-format > "$HOME/claude-md-push/docs/taste-memory-format.md" 2>/dev/null || true
fi

# Sync all skill symlinks
bash "$HOME/claude-md-push/scripts/sync-skill-symlinks.sh"

echo "[bootstrap] UI taste system ready."
```

Also add the taste memory format doc to gbrain on first run:

```bash
# One-time seed (run manually after writing taste-memory-format.md):
gbrain put taste-memory-format < ~/claude-md-push/docs/taste-memory-format.md
```