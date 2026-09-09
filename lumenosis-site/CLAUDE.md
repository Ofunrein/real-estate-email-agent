# Project Instructions

## Overview
- Active app inside the broader `atlas` workspace. Work in this repo, not the archive/research files at the parent root.
- Marketing site for Lumenosis AI built on Next.js App Router with MDX legal pages and one webhook-style API route.

## Tech Stack
- TypeScript 5, `strict: true`
- Next.js 16 App Router, React 19
- Tailwind CSS v4 with CSS-variable tokens in [`app/globals.css`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/app/globals.css)
- Biome for formatting/linting
- MDX via `@next/mdx`
- Framer Motion for animated sections
- Zod for env validation in [`lib/env.ts`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/lib/env.ts)

## Commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Start: `pnpm start`
- Format: `pnpm format`
- Lint: `pnpm lint`

## Project Structure
- [`app/page.tsx`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/app/page.tsx): homepage composition from section components
- [`app/layout.tsx`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/app/layout.tsx): fonts, metadata, theme provider, global shell
- [`app/api/lead/route.ts`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/app/api/lead/route.ts): lead intake webhook endpoint
- [`app/privacy/page.mdx`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/app/privacy/page.mdx), [`app/terms/page.mdx`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/app/terms/page.mdx): legal content
- [`components/sections/`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/components/sections): landing-page sections, one file per section
- [`components/ui/`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/components/ui): reusable primitives and token docs
- [`content/`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/content): typed content arrays for FAQs, pricing, niches, case studies
- [`lib/env.ts`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/lib/env.ts): env contract
- [`docs/brand-kit.md`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/docs/brand-kit.md): brand reference

## Conventions
- Default to server components. Add `"use client"` only when hooks, browser APIs, or Framer Motion require it.
- Component files are kebab-case; exported React components are PascalCase.
- Shared copy/data lives in `content/*.ts`, not inline in page composition when it can be structured.
- Use the `@/*` import alias.
- Use `cn()` from [`lib/utils.ts`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/lib/utils.ts) for class merging.
- Before changing spacing, color, cards, or responsive layout, read [`components/ui/design-tokens.md`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/components/ui/design-tokens.md).
- Tailwind v4 tokens must use arbitrary values like `bg-[var(--color-brand-violet)]`. Do not invent utility names from `@theme` tokens.
- Keep reduced-motion behavior intact. Existing animated sections pair Framer Motion with `useReducedMotion()`.
- Env vars are optional-but-validated strings from `.env`. Keep additions mirrored in `.env.example` and `lib/env.ts`.

## API Notes
- `POST /api/lead` parses JSON, requires a signature header in production, logs the payload, and returns `{ ok: true }`.
- HMAC verification and downstream forwarding are still TODOs. Keep webhook handlers fast and side effects explicit.

## Testing
- No test runner or test directory is established yet.
- `pnpm lint` currently runs `biome check --write app/ public/`, so changes in `components/`, `content/`, and `lib/` are not fully covered by the script.

## Git Signals
- Local branches are plain names: `main`, `plan`.
- Recent commits use short imperative subjects focused on UI/layout changes, for example `fix hero text overlap`.

## Notes
- [`README.md`](/Users/martinofunrein/Downloads/atlas/projects/lumenosis-site/README.md) is still the default `create-next-app` template. Trust the code and this file over the README.
