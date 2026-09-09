# Lumenosis Polish Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix light-mode cream colors, transparent dark-mode section bgs (Aurora shows through), replace star-button with exact source, pill-shaped topbar on scroll, "Book a Demo" CTA, ScaleYourClinic 2-path pricing, Framer Motion spring hero animation.

**Architecture:** Token-based dual mode — light reads `#F5F4EE` cream, dark reads `transparent`/`rgba(0,0,0,0.25)` so fixed Aurora canvas bleeds through every section. All components updated in place, no new pages needed.

**Tech Stack:** Next.js 15, Tailwind v4, Framer Motion (already installed), next-themes (already installed), shadcn/ui.

---

## Task 1: Restore cream light mode + transparent dark sections in globals.css

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1.1: Replace globals.css @theme block and .dark overrides**

Open `app/globals.css`. Replace the ENTIRE file with:

```css
@import "tailwindcss";
@import "tw-animate-css";

@theme {
  /* LIGHT MODE (default) */
  --color-bg-cream: #f5f4ee;
  --color-ink-charcoal: #1a1a1a;
  --color-primary-indigo: #1e1b4b;
  --color-brand-violet: #cb6ce6;
  --color-brand-violet-soft: rgba(203, 108, 230, 0.12);
  --color-brand-purple: #cb6ce6;
  --color-brand-purple-soft: rgba(203, 108, 230, 0.12);
  --color-gold-italic: #9a7a3e;
  --color-dark-section: #0f1612;
  --color-line: #e2ddd1;
  --color-muted: #52615b;
  --color-brand-charcoal: #1a1a1a;

  /* Typography */
  --font-display: var(--font-newsreader), "Tiempos Headline", Georgia, serif;
  --font-body: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, monospace;

  /* Type scale */
  --text-display-hero: clamp(2.5rem, 7vw, 5.5rem);
  --text-display-section: clamp(2rem, 4.5vw, 3.5rem);
  --text-body-lg: 1.1875rem;
  --text-body: 1rem;
  --text-eyebrow: 0.75rem;

  /* Shadows */
  --shadow-soft: 0 18px 45px rgba(17, 21, 19, 0.08);
  --shadow-glow-violet: 0 0 60px rgba(203, 108, 230, 0.45);

  /* Radius */
  --radius: 0.625rem;
  --radius-pill: 999px;

  /* Star button */
  --animate-star-btn: star-btn calc(var(--duration)*1s) linear infinite;
}

/* ---------- BASE ---------- */
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
  transition: background 0.3s ease, color 0.3s ease;
}

/* ---------- DARK MODE — transparent so Aurora canvas shows ---------- */
.dark {
  --color-bg-cream: transparent;
  --color-ink-charcoal: #ffffff;
  --color-primary-indigo: #cb6ce6;
  --color-brand-violet: #cb6ce6;
  --color-brand-violet-soft: rgba(203, 108, 230, 0.15);
  --color-line: rgba(255, 255, 255, 0.1);
  --color-muted: rgba(255, 255, 255, 0.55);
  --color-gold-italic: #e8c47a;
  --color-shadow-soft: 0 18px 45px rgba(0, 0, 0, 0.4);
}

.dark body {
  background: #1a1a1a;
  color: #ffffff;
}

/* Aurora canvas — fixed full-screen, dark mode only */
.aurora-canvas {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.5;
}

.dark .aurora-canvas {
  display: block;
}

/* All main content sits above the aurora canvas */
header, main, footer {
  position: relative;
  z-index: 1;
}

/* ---------- STAR BUTTON ANIMATION ---------- */
@keyframes star-btn {
  0% { offset-distance: 0%; }
  100% { offset-distance: 100%; }
}

/* ---------- REDUCED MOTION ---------- */
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 1.2: Verify build passes**

```bash
cd /Users/martinofunrein/Downloads/atlas/lumenosis-site && pnpm build 2>&1 | tail -10
```

Expected: zero errors, 5 routes generated.

- [ ] **Step 1.3: Commit**

```bash
git add app/globals.css
git commit -m "fix: restore cream light mode, transparent dark mode so Aurora shows through"
```

---

## Task 2: Make ALL section bgs transparent in dark mode

**Files:**
- Modify: every file in `components/sections/` that has a hardcoded bg

Dark mode token `--color-bg-cream` is now `transparent`. BUT `bg-[var(--color-bg-cream)]` → `transparent` in dark makes section text float on pure Aurora — need a subtle dark overlay for readability.

Replace the section outer `className` bg in each file as follows:

### Rule:

- Light sections (cream/white bg): change `bg-white` and `bg-[var(--color-bg-cream)]` to:
  ```
  bg-[var(--color-bg-cream)] dark:bg-black/25
  ```
- Dark accent sections (aria-deep-dive, timeline dark steps): use:
  ```
  dark:bg-black/50
  ```
- Hero: fully transparent in dark:
  ```
  dark:bg-transparent
  ```
- Cards inside sections (GlowCard, pricing cards, article elements): use:
  ```
  dark:bg-black/40 dark:backdrop-blur-sm
  ```

### Files to update:

- [ ] **Step 2.1: problem-agitation.tsx**

Section className: change `bg-[var(--color-bg-cream)]` → `bg-[var(--color-bg-cream)] dark:bg-black/25`

- [ ] **Step 2.2: founder-vsl.tsx**

Section `bg-white` → `bg-white dark:bg-black/25`

- [ ] **Step 2.3: meet-the-team.tsx**

Section `bg-white` → `bg-white dark:bg-black/25`

- [ ] **Step 2.4: case-study-wall.tsx**

Section `bg-[var(--color-bg-cream)]` → `bg-[var(--color-bg-cream)] dark:bg-black/25`

- [ ] **Step 2.5: calendar-cta.tsx**

Section `bg-white` → `bg-white dark:bg-black/25`

- [ ] **Step 2.6: faq.tsx**

Section `bg-[var(--color-bg-cream)]` → `bg-[var(--color-bg-cream)] dark:bg-black/25`

- [ ] **Step 2.7: final-cta.tsx**

Section `bg-[var(--color-bg-cream)]` → `bg-[var(--color-bg-cream)] dark:bg-transparent`

- [ ] **Step 2.8: pull-quote.tsx**

Section `bg-white` → `bg-white dark:bg-black/20`

- [ ] **Step 2.9: footer.tsx**

Section `bg-[var(--color-bg-cream)]` → `bg-[var(--color-bg-cream)] dark:bg-black/40`

- [ ] **Step 2.10: trust-strip.tsx**

Section `bg-[var(--color-brand-charcoal)]/40` → `bg-[var(--color-bg-cream)]/60 dark:bg-black/30`

- [ ] **Step 2.11: aria-deep-dive.tsx**

Section `bg-black` → `bg-[var(--color-dark-section)] dark:bg-black/60`

- [ ] **Step 2.12: timeline-30day.tsx**

Section `bg-[var(--color-bg-cream)]` → `bg-[var(--color-bg-cream)] dark:bg-black/25`

- [ ] **Step 2.13: Build + commit**

```bash
pnpm build 2>&1 | tail -5
git add components/sections/
git commit -m "fix: all sections transparent in dark mode — Aurora canvas bleeds through"
```

---

## Task 3: Replace star-button with exact React Bits source

**Files:**
- Create: `components/ui/star-button.tsx` (EXACT source)
- Modify: all imports (currently `@/components/star-button` → `@/components/ui/star-button`)

- [ ] **Step 3.1: Create `components/ui/star-button.tsx` with exact source**

```tsx
"use client";

import React, { useRef, useEffect, ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface StarBackgroundProps {
  color?: string;
}

function StarBackground({ color }: StarBackgroundProps) {
  return (
    <svg
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      viewBox="0 0 100 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_408_119)">
        <path
          d="M32.34 26.68C32.34 26.3152 32.0445 26.02 31.68 26.02C31.3155 26.02 31.02 26.3152 31.02 26.68C31.02 27.0448 31.3155 27.34 31.68 27.34C32.0445 27.34 32.34 27.0448 32.34 26.68Z"
          fill="black"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M56.1 3.96C56.4645 3.96 56.76 4.25519 56.76 4.62C56.76 4.98481 56.4645 5.28 56.1 5.28C55.9131 5.28 55.7443 5.20201 55.624 5.07762C55.5632 5.01446 55.5147 4.93904 55.4829 4.8559C55.4552 4.78243 55.44 4.70315 55.44 4.62C55.44 4.5549 55.4494 4.49174 55.4668 4.43244C55.4906 4.35188 55.5292 4.27775 55.5795 4.21329C55.7004 4.05926 55.8885 3.96 56.1 3.96ZM40.26 17.16C40.6245 17.16 40.92 17.4552 40.92 17.82C40.92 18.1848 40.6245 18.48 40.26 18.48C39.8955 18.48 39.6 18.1848 39.6 17.82C39.6 17.4552 39.8955 17.16 40.26 17.16ZM74.58 5.28C74.7701 5.28 74.9413 5.36057 75.0618 5.48882C75.073 5.50043 75.0837 5.51268 75.094 5.52557C75.1088 5.54426 75.1231 5.56359 75.1359 5.58357L75.1479 5.60291L75.1595 5.62353C75.1711 5.64481 75.1814 5.66672 75.1906 5.68928C75.2226 5.76662 75.24 5.85106 75.24 5.94C75.24 6.1585 75.1336 6.3525 74.9699 6.47238C74.9158 6.51234 74.8555 6.54393 74.7908 6.56584C74.7247 6.58775 74.6538 6.6 74.58 6.6C74.2156 6.6 73.92 6.30481 73.92 5.94C73.92 5.87684 73.929 5.8156 73.9455 5.7576C73.9596 5.70862 73.979 5.66221 74.0032 5.61903C74.0657 5.50688 74.1595 5.41471 74.2728 5.35541C74.3647 5.30707 74.4691 5.28 74.58 5.28ZM21.66 33.52C22.0245 33.52 22.32 33.8152 22.32 34.18C22.32 34.5448 22.0245 34.84 21.66 34.84C21.2955 34.84 21 34.5448 21 34.18C21 33.8152 21.2955 33.52 21.66 33.52ZM8.16 32.86C8.16 32.4952 7.8645 32.2 7.5 32.2C7.1355 32.2 6.84 32.4952 6.84 32.86C6.84 33.2248 7.1355 33.52 7.5 33.52C7.8645 33.52 8.16 33.2248 8.16 32.86ZM7.5 23.68C7.8645 23.68 8.16 23.9752 8.16 24.34C8.16 24.7048 7.8645 25 7.5 25C7.1355 25 6.84 24.7048 6.84 24.34C6.84 23.9752 7.1355 23.68 7.5 23.68ZM19.32 18.48C19.32 18.1152 19.0245 17.82 18.66 17.82C18.2955 17.82 18 18.1152 18 18.48C18 18.8448 18.2955 19.14 18.66 19.14C19.0245 19.14 19.32 18.8448 19.32 18.48ZM5.66 11.84C6.0245 11.84 6.32001 12.1352 6.32001 12.5C6.32001 12.8648 6.0245 13.16 5.66 13.16C5.2955 13.16 5 12.8648 5 12.5C5 12.1352 5.2955 11.84 5.66 11.84ZM35.16 35.5C35.16 35.1352 34.8645 34.84 34.5 34.84C34.1355 34.84 33.84 35.1352 33.84 35.5C33.84 35.8648 34.1355 36.16 34.5 36.16C34.8645 36.16 35.16 35.8648 35.16 35.5ZM53.5 36.18C53.8645 36.18 54.16 36.4752 54.16 36.84C54.16 37.2048 53.8645 37.5 53.5 37.5C53.1355 37.5 52.84 37.2048 52.84 36.84C52.84 36.4752 53.1355 36.18 53.5 36.18ZM48.5 28.66C48.5 28.2952 48.2045 28 47.84 28C47.4755 28 47.18 28.2952 47.18 28.66C47.18 29.0248 47.4755 29.32 47.84 29.32C48.2045 29.32 48.5 29.0248 48.5 28.66ZM60.34 27.34C60.7045 27.34 61 27.6352 61 28C61 28.3648 60.7045 28.66 60.34 28.66C59.9755 28.66 59.68 28.3648 59.68 28C59.68 27.6352 59.9755 27.34 60.34 27.34ZM56.284 16.5C56.284 16.1352 55.9885 15.84 55.624 15.84C55.2595 15.84 54.964 16.1352 54.964 16.5C54.964 16.8648 55.2595 17.16 55.624 17.16C55.9885 17.16 56.284 16.8648 56.284 16.5ZM46.2 7.26C46.2 6.89519 45.9045 6.6 45.54 6.6C45.5174 6.6 45.4953 6.60129 45.4733 6.60387L45.453 6.60579L45.4124 6.61225L45.3857 6.61804L45.3845 6.61836C45.3675 6.62277 45.3504 6.62721 45.3341 6.63287C45.2522 6.65929 45.1774 6.70184 45.1134 6.75597C45.0627 6.79916 45.0186 6.84943 44.9828 6.90551C44.9178 7.00799 44.88 7.12981 44.88 7.26C44.88 7.62481 45.1755 7.92 45.54 7.92C45.7372 7.92 45.9141 7.83363 46.0353 7.69635C46.0808 7.64478 46.1182 7.58613 46.1459 7.52232C46.1807 7.4424 46.2 7.35346 46.2 7.26ZM33 9.34C33 8.9752 32.7045 8.68 32.34 8.68C31.9755 8.68 31.68 8.9752 31.68 9.34C31.68 9.7048 31.9755 10 32.34 10C32.7045 10 33 9.7048 33 9.34ZM16 4.8559C16.3645 4.8559 16.66 5.1511 16.66 5.5159C16.66 5.8807 16.3645 6.1759 16 6.1759C15.6355 6.1759 15.34 5.8807 15.34 5.5159C15.34 5.1511 15.6355 4.8559 16 4.8559ZM69.66 21.16C69.66 20.7952 69.3645 20.5 69 20.5C68.6355 20.5 68.34 20.7952 68.34 21.16C68.34 21.5248 68.6355 21.82 69 21.82C69.3645 21.82 69.66 21.5248 69.66 21.16ZM80.52 15.18C80.52 14.8152 80.2245 14.52 79.86 14.52C79.4956 14.52 79.2 14.8152 79.2 15.18C79.2 15.5448 79.4956 15.84 79.86 15.84C80.2245 15.84 80.52 15.5448 80.52 15.18ZM78.16 34.84C78.16 34.4752 77.5 34.18 77.5 34.18C77.5 34.18 76.84 34.4752 76.84 34.84C76.84 35.2048 77.1355 35.5 77.5 35.5C77.8645 35.5 78.16 35.2048 78.16 34.84ZM85.66 24.34C86.0245 24.34 86.32 24.6352 86.32 25C86.32 25.3648 86.0245 25.66 85.66 25.66C85.2955 25.66 85 25.3648 85 25C85 24.6352 85.2955 24.34 85.66 24.34ZM91.32 10C91.32 9.6352 91.0245 9.34 90.66 9.34C90.2955 9.34 90 9.6352 90 10C90 10.3648 90.2955 10.66 90.66 10.66C91.0245 10.66 91.32 10.3648 91.32 10ZM138.6 0H0V46.2H138.6V0ZM92.64 34.84C92.64 34.4752 91.98 34.18 91.98 34.18C91.98 34.18 91.32 34.4752 91.32 34.84C91.32 35.2048 91.6155 35.5 91.98 35.5C92.3445 35.5 92.64 35.2048 92.64 34.84Z"
          fill={color || "currentColor"}
        />
      </g>
      <defs>
        <clipPath id="clip0_408_119">
          <rect width="100" height="40" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

interface StarButtonProps {
  children: ReactNode;
  lightWidth?: number;
  duration?: number;
  lightColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
}

export function StarButton({
  children,
  lightWidth = 110,
  duration = 3,
  lightColor = "#cb6ce6",
  backgroundColor = "currentColor",
  borderWidth = 2,
  className,
  ...props
}: StarButtonProps) {
  const pathRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pathRef.current) {
      const div = pathRef.current;
      div.style.setProperty(
        "--path",
        `path('M 0 0 H ${div.offsetWidth} V ${div.offsetHeight} H 0 V 0')`,
      );
    }
  }, []);

  return (
    <button
      style={
        {
          "--duration": duration,
          "--light-width": `${lightWidth}px`,
          "--light-color": lightColor,
          "--border-width": `${borderWidth}px`,
          isolation: "isolate",
        } as CSSProperties
      }
      ref={pathRef}
      className={cn(
        "relative z-[3] overflow-hidden h-10 px-4 py-2 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-3xl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 group/star-button",
        className,
      )}
      {...props}
    >
      <div
        className="absolute aspect-square inset-0 animate-star-btn bg-[radial-gradient(ellipse_at_center,var(--light-color),transparent,transparent)]"
        style={
          {
            offsetPath: "var(--path)",
            offsetDistance: "0%",
            width: "var(--light-width)",
          } as CSSProperties
        }
      />
      <div
        className="absolute inset-0 dark:border-white/15 border-black/10 z-[4] overflow-hidden rounded-[inherit] dark:text-black text-white"
        style={{ borderWidth: "var(--border-width)" }}
        aria-hidden="true"
      >
        <StarBackground color={backgroundColor} />
      </div>
      <span className="z-10 relative dark:text-white text-[var(--color-ink-charcoal)]">
        {children}
      </span>
    </button>
  );
}
```

- [ ] **Step 3.2: Update all imports from `@/components/star-button` → `@/components/ui/star-button`**

Run:
```bash
cd /Users/martinofunrein/Downloads/atlas/lumenosis-site
grep -rl "from \"@/components/star-button\"" components/ app/ | xargs sed -i '' 's|from "@/components/star-button"|from "@/components/ui/star-button"|g'
grep -rl "from '@/components/star-button'" components/ app/ | xargs sed -i '' "s|from '@/components/star-button'|from '@/components/ui/star-button'|g"
```

- [ ] **Step 3.3: Build + commit**

```bash
pnpm build 2>&1 | tail -5
git add components/ui/star-button.tsx components/
git commit -m "feat: replace star-button with exact React Bits source + full SVG dot pattern"
```

---

## Task 4: Topbar — "Book a Demo", pill on scroll, no magnet on nav CTA, show logo

**Files:**
- Modify: `components/sections/topbar.tsx`

- [ ] **Step 4.1: Replace topbar.tsx completely**

```tsx
"use client";
import React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { MenuToggleIcon } from "@/components/ui/menu-toggle-icon";
import { useScroll } from "@/components/ui/use-scroll";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { StarButton } from "@/components/ui/star-button";

export function Topbar() {
  const [open, setOpen] = React.useState(false);
  const scrolled = useScroll(10);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const links = [
    { label: "Method", href: "#method" },
    { label: "Agents", href: "#agents" },
    { label: "Process", href: "#process" },
    { label: "FAQ", href: "#faq" },
  ];

  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300 ease-out",
        // Not scrolled: full-width, transparent/light
        !scrolled && "bg-[var(--color-bg-cream)]/80 backdrop-blur-sm border-b border-[var(--color-line)]",
        // Scrolled: floating pill centered
        scrolled && !open && [
          "flex justify-center",
          "bg-transparent border-none",
          "py-3",
        ],
      )}
    >
      <nav
        className={cn(
          "flex h-16 items-center justify-between px-4 transition-all duration-300 ease-out",
          // Not scrolled: full width
          !scrolled && "w-full max-w-none mx-0",
          // Scrolled: pill shape
          scrolled && !open && [
            "w-[min(900px,calc(100%-32px))]",
            "rounded-full",
            "bg-[var(--color-bg-cream)]/90 dark:bg-black/70",
            "border border-[var(--color-line)]",
            "backdrop-blur-md",
            "shadow-[var(--shadow-soft)]",
            "h-12 px-5",
          ],
        )}
      >
        {/* Logo */}
        <a href="#top" className="inline-flex items-center gap-2 shrink-0">
          <Image
            src="/images/lumenosis-logo.png"
            alt="Lumenosis AI"
            width={32}
            height={32}
            className="rounded-lg"
          />
          <span className="font-semibold text-[var(--color-ink-charcoal)]">
            Lumenosis <span className="text-[var(--color-brand-violet)]">AI</span>
          </span>
        </a>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="px-3 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink-charcoal)] transition-colors rounded-md hover:bg-[var(--color-brand-violet-soft)]"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Right side: theme toggle + CTA */}
        <div className="hidden md:flex items-center gap-2">
          {mounted && (
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-brand-violet)] hover:border-[var(--color-brand-violet)] transition-colors"
              aria-label="Toggle dark/light mode"
            >
              {resolvedTheme === "dark" ? (
                <svg viewBox="0 0 24 24" className="size-4 fill-current"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="size-4 fill-current"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              )}
            </button>
          )}
          {/* CTA — StarButton, NO Magnet */}
          <StarButton
            lightColor="#cb6ce6"
            className="bg-[var(--color-brand-violet)] text-white px-5 h-10 text-sm"
          >
            <a href="#book">Book a Demo</a>
          </StarButton>
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="grid size-9 place-items-center rounded-md border border-[var(--color-line)] text-[var(--color-ink-charcoal)] md:hidden"
          aria-label="Toggle menu"
        >
          <MenuToggleIcon open={open} className="size-5" duration={300} />
        </button>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed top-16 inset-x-0 bottom-0 z-50 bg-[var(--color-bg-cream)] flex flex-col p-4 gap-2 md:hidden border-t border-[var(--color-line)]">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="px-4 py-3 text-lg text-[var(--color-ink-charcoal)] rounded-md hover:bg-[var(--color-brand-violet-soft)] transition-colors"
            >
              {link.label}
            </a>
          ))}
          <div className="mt-auto">
            <StarButton
              lightColor="#cb6ce6"
              className="w-full bg-[var(--color-brand-violet)] text-white h-12 text-base justify-center"
            >
              <a href="#book">Book a Demo</a>
            </StarButton>
          </div>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 4.2: Build + verify logo loads**

```bash
pnpm build 2>&1 | tail -5
# Also verify logo file exists:
ls -la /Users/martinofunrein/Downloads/atlas/lumenosis-site/public/images/lumenosis-logo.png
```

Expected: file ~1MB, no 404.

- [ ] **Step 4.3: Commit**

```bash
git add components/sections/topbar.tsx
git commit -m "feat: topbar pill on scroll, Book a Demo CTA, no magnet, logo + theme toggle"
```

---

## Task 5: Hero — Framer Motion spring animation for niche words

**Files:**
- Modify: `components/sections/hero.tsx`

The `RotatingText` component uses Framer Motion `AnimatePresence` crossfade. Replace with the **animated-hero.tsx pattern**: vertical spring slide (y: 0 active, y: -150 above, y: 150 below) — more dramatic than crossfade.

- [ ] **Step 5.1: Replace `components/sections/hero.tsx`**

```tsx
"use client";
import { useEffect, useState, Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "framer-motion";
import Magnet from "@/components/magnet";
import { StarButton } from "@/components/ui/star-button";
import { GlassStatCallout } from "@/components/glass-stat-callout";
import { niches } from "@/content/niches";
import Image from "next/image";

const Aurora = lazy(() => import("@/components/aurora"));

export function Hero() {
  const [titleIndex, setTitleIndex] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => {
      setTitleIndex((i) => (i + 1) % niches.length);
    }, 2000);
    return () => clearTimeout(t);
  }, [titleIndex, reduce]);

  return (
    <section
      id="top"
      className="relative overflow-hidden border-b border-[var(--color-line)] bg-[var(--color-bg-cream)] dark:bg-transparent pb-16 pt-20 md:pt-28"
    >
      {/* Dark overlay for text legibility over Aurora */}
      <div className="absolute inset-0 z-0 hidden dark:block bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(0,0,0,0.55)_80%)] pointer-events-none" />

      <div className="relative z-10 mx-auto grid w-[min(1200px,calc(100%-32px))] items-start gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-12">
        <div>
          <p className="mb-3 text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-violet)]">
            5.0 from 50+ verified real estate professionals
          </p>

          {/* Animated headline — spring vertical slide on niche word */}
          <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-display-hero)] font-semibold leading-[1.04] tracking-tight text-[var(--color-ink-charcoal)]">
            AI agents for your{" "}
            <span className="relative inline-flex h-[1.1em] overflow-hidden align-bottom">
              {niches.map((niche, index) => (
                <motion.span
                  key={niche}
                  className="absolute italic text-[var(--color-gold-italic)]"
                  initial={{ opacity: 0, y: 150 }}
                  transition={{ type: "spring", stiffness: 50 }}
                  animate={
                    titleIndex === index
                      ? { y: 0, opacity: 1 }
                      : { y: titleIndex > index ? -150 : 150, opacity: 0 }
                  }
                >
                  {niche}
                </motion.span>
              ))}
              {/* Invisible spacer to reserve width for longest word */}
              <span className="invisible" aria-hidden>
                {niches.reduce((a, b) => (a.length >= b.length ? a : b))}
              </span>
            </span>{" "}
            team.
          </h1>

          <p className="mt-5 max-w-xl text-[length:var(--text-body-lg)] leading-snug text-[var(--color-muted)]">
            Olivia answers your website. Aria answers the phone. Theo texts every lead in
            under sixty seconds. Iris turns inbound emails into booked valuations.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Magnet padding={60} magnetStrength={5}>
              <StarButton
                lightColor="#cb6ce6"
                className="bg-[var(--color-brand-violet)] text-white px-6 h-12 text-base"
              >
                <a href="#book">Book a Demo</a>
              </StarButton>
            </Magnet>
            <Magnet padding={60} magnetStrength={5}>
              <StarButton
                lightColor="#ffffff"
                className="bg-white/10 border border-[var(--color-line)] text-[var(--color-ink-charcoal)] dark:text-white px-6 h-12 text-base backdrop-blur-sm"
              >
                <a href="#vsl">Watch 90s overview</a>
              </StarButton>
            </Magnet>
          </div>
        </div>

        {/* Product card mockup */}
        <div className="relative aspect-[4/5] w-full max-w-[460px] justify-self-center md:max-w-none">
          <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[var(--color-brand-charcoal)] border border-[var(--color-line)]">
            <Image
              src="/images/product-card-mockup.png"
              alt="Lumenosis AI dashboard with CRM, iMessage thread, and booked appointment"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 460px"
              className="object-cover opacity-80"
            />
          </div>
          <GlassStatCallout label="Avg response" value="60 seconds" className="absolute -left-3 top-8 md:-left-6" />
          <GlassStatCallout label="More bookings" value="+300%" className="absolute -right-3 top-1/2 hidden md:-right-8 md:block" />
          <GlassStatCallout label="Coverage" value="24 / 7" className="absolute -bottom-4 left-12 md:-bottom-6" />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5.2: Build + commit**

```bash
pnpm build 2>&1 | tail -5
git add components/sections/hero.tsx
git commit -m "feat: hero Framer Motion spring word animation (vertical slide in/out)"
```

---

## Task 6: ScaleYourClinic 2-path pricing (not 4-tier, not creative pricing)

**Files:**
- Modify: `components/sections/two-ways-in.tsx`

Reference: Images 25/26 — ScaleYourClinic "Two ways in. One destination."
- Left card: light cream bg, "PATH 01 · LAUNCH", "Start your team."
- Right card: dark forest (brand charcoal), "PATH 02 · SCALE", "Scale your operation.", gold "MOST POPULAR" badge
- "BEST FOR" label under description
- Check marks for features
- "Book a Demo →" button in each card
- NOT the 4-tier grid, NOT the tilted creative pricing card

```tsx
"use client";
import Image from "next/image";
import { StarButton } from "@/components/ui/star-button";
import { Check } from "lucide-react";

const paths = [
  {
    path: "PATH 01 · LAUNCH",
    title: "Start your",
    titleItalic: "team.",
    description: "The complete AI front desk for solo agents and small teams who want to stop losing leads to slow follow-up — in 30 days.",
    bestFor: "Solo agents & small teams",
    features: [
      "Olivia website chat agent",
      "Aria 24/7 voice receptionist",
      "Theo SMS sales agent",
      "CRM auto-sync + lead scoring",
      "30-day launch sprint",
      "2 weeks optimization included",
    ],
    popular: false,
    dark: false,
    cta: "Book a Demo →",
    price: "Starts at $197/mo",
  },
  {
    path: "PATH 02 · SCALE",
    title: "Scale your",
    titleItalic: "operation.",
    description: "Already running a team? We flood your pipeline with qualified booked appointments every month using the same system driving 300%+ booking lifts.",
    bestFor: "Brokerages, property management & multi-location teams",
    features: [
      "Everything in Launch",
      "Iris email assistant",
      "Per-agent + per-location coverage",
      "Monthly review with Martin",
      "Lead recovery sweep on dormant contacts",
      "Priority new-agent buildouts",
    ],
    popular: true,
    dark: true,
    cta: "Book a Demo →",
    price: "Starts at $397/mo",
  },
] as const;

export function TwoWaysIn() {
  return (
    <section className="border-b border-[var(--color-line)] bg-[var(--color-bg-cream)] dark:bg-black/25 py-16 md:py-24">
      <div className="mx-auto w-[min(1200px,calc(100%-32px))]">
        {/* Section header */}
        <div className="mb-12">
          <p className="mb-3 text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-violet)]">
            06 — Programs
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-display-section)] font-semibold leading-[1.05] text-[var(--color-ink-charcoal)]">
            Two ways in. <em className="text-[var(--color-gold-italic)]">One destination.</em>
          </h2>
        </div>

        {/* 2-card grid */}
        <div className="grid gap-5 md:grid-cols-2">
          {paths.map((p) => (
            <article
              key={p.path}
              className={`relative rounded-2xl border p-8 flex flex-col ${
                p.dark
                  ? "bg-[var(--color-brand-charcoal)] border-[var(--color-brand-violet)]/20 text-white"
                  : "bg-[var(--color-bg-cream)] dark:bg-black/40 border-[var(--color-line)] text-[var(--color-ink-charcoal)]"
              }`}
            >
              {p.popular && (
                <span className="absolute -top-3 right-6 rounded-full bg-[var(--color-gold-italic)] text-black px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
                  MOST POPULAR
                </span>
              )}

              {/* Path label */}
              <p
                className={`text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] mb-4 ${
                  p.dark ? "text-[var(--color-gold-italic)]" : "text-[var(--color-brand-violet)]"
                }`}
              >
                {p.path}
              </p>

              {/* Title */}
              <h3 className="font-[family-name:var(--font-display)] text-4xl font-semibold mb-3">
                {p.title}{" "}
                <em
                  className={`${
                    p.dark ? "text-[var(--color-gold-italic)]" : "text-[var(--color-brand-violet)]"
                  }`}
                >
                  {p.titleItalic}
                </em>
              </h3>

              {/* Description */}
              <p
                className={`text-base mb-5 ${
                  p.dark ? "text-white/65" : "text-[var(--color-muted)]"
                }`}
              >
                {p.description}
              </p>

              {/* Divider + Best for */}
              <div
                className={`border-t pb-4 pt-4 mb-5 flex items-center gap-2 text-sm ${
                  p.dark ? "border-white/10 text-white/45" : "border-[var(--color-line)] text-[var(--color-muted)]"
                }`}
              >
                <span className="font-semibold uppercase tracking-wider text-[10px]">
                  BEST FOR
                </span>
                <span className={`font-medium ${p.dark ? "text-white/80" : "text-[var(--color-ink-charcoal)]"}`}>
                  {p.bestFor}
                </span>
              </div>

              {/* Features */}
              <ul className="grid gap-3 mb-8 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check
                      className={`size-4 shrink-0 mt-0.5 ${
                        p.dark ? "text-[var(--color-gold-italic)]" : "text-[var(--color-brand-violet)]"
                      }`}
                    />
                    <span
                      className={`text-sm ${p.dark ? "text-white/75" : "text-[var(--color-ink-charcoal)]"}`}
                    >
                      {f}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Price */}
              <p
                className={`text-xs font-semibold uppercase tracking-widest mb-3 ${
                  p.dark ? "text-[var(--color-gold-italic)]" : "text-[var(--color-brand-violet)]"
                }`}
              >
                {p.price}
              </p>

              {/* CTA */}
              <StarButton
                lightColor={p.dark ? "#e8c47a" : "#cb6ce6"}
                backgroundColor={p.dark ? "#e8c47a" : "#cb6ce6"}
                className={`w-full justify-center h-12 text-sm rounded-xl ${
                  p.dark
                    ? "bg-[var(--color-gold-italic)] text-black"
                    : "bg-[var(--color-brand-charcoal)] dark:bg-[var(--color-brand-violet)] text-white"
                }`}
                onClick={() => {
                  document.getElementById("book")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {p.cta}
              </StarButton>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6.2: Build + commit**

```bash
pnpm build 2>&1 | tail -5
git add components/sections/two-ways-in.tsx
git commit -m "feat: TwoWaysIn ScaleYourClinic 2-path style — light + dark cards, gold MOST POPULAR badge"
```

---

## Task 7: Fix GlassStatCallout for dual mode

**Files:**
- Modify: `components/glass-stat-callout.tsx`

- [ ] **Step 7.1: Update GlassStatCallout**

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
      className={`pointer-events-none rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-cream)]/90 dark:bg-black/70 px-4 py-3 text-[var(--color-ink-charcoal)] shadow-[var(--shadow-soft)] backdrop-blur-md ${className ?? ""}`}
    >
      <div className="text-[15px] font-semibold leading-tight">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
    </div>
  );
}
```

- [ ] **Step 7.2: Build + commit**

```bash
pnpm build 2>&1 | tail -5
git add components/glass-stat-callout.tsx
git commit -m "fix: GlassStatCallout dual light/dark mode"
```

---

## Task 8: Final push to Vercel

- [ ] **Step 8.1: Full build verification**

```bash
pnpm build 2>&1 | grep -E "(error|Error|✓|Route)" | head -20
```

Expected: zero errors, 5 routes.

- [ ] **Step 8.2: Push + auto-deploy**

```bash
git push
```

Vercel webhook triggers auto-deploy from GitHub. Done.

---

## Self-review

| Requirement | Task |
|---|---|
| Light mode cream `#F5F4EE` | Task 1 (globals.css) |
| Dark sections transparent → Aurora shows | Task 1 + Task 2 |
| `Book a Demo` nav CTA | Task 4 |
| No magnet on nav button | Task 4 |
| Topbar pill on scroll | Task 4 |
| Logo showing | Task 4 (Image fixed to `/images/lumenosis-logo.png`) |
| Theme toggle | Task 4 |
| Star button exact source (full SVG dots + orbit) | Task 3 |
| Hero spring animation (vertical slide) | Task 5 |
| Framer Motion animated-hero pattern | Task 5 |
| ScaleYourClinic 2-path pricing (not 4-tier) | Task 6 |
| Gold "MOST POPULAR" badge | Task 6 |
| "PATH 01 · LAUNCH / PATH 02 · SCALE" label | Task 6 |
| "BEST FOR" label | Task 6 |
| GlassStatCallout dual mode | Task 7 |
| Deploy | Task 8 |
