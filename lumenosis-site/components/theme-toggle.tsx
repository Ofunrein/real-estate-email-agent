"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTheme } from "next-themes";
import React from "react";
import { runThemeTransition } from "@/lib/theme-transition";

function ThemeIcon({ dark }: { dark: boolean }) {
  if (dark) {
    return (
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
        <path d="M19.55 15.82A7.55 7.55 0 0 1 8.18 6.45a.72.72 0 0 0-.82-1.04 8.5 8.5 0 1 0 11.23 11.23.72.72 0 0 0-.94-.94 7.3 7.3 0 0 1-1.9.25 7.55 7.55 0 0 1-7.55-7.55c0-.65.08-1.28.24-1.89a6.15 6.15 0 1 0 11.11 9.31z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 2.75v2.1M12 19.15v2.1M21.25 12h-2.1M4.85 12h-2.1M18.55 5.45l-1.48 1.48M6.93 17.07l-1.48 1.48M18.55 18.55l-1.48-1.48M6.93 6.93 5.45 5.45" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  const toggleTheme = () => {
    runThemeTransition({
      nextTheme: isDark ? "light" : "dark",
      reduceMotion: Boolean(reduceMotion),
      updateTheme: setTheme,
    });
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`grid size-9 place-items-center rounded-full text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "moon" : "sun"}
          initial={reduceMotion ? false : { opacity: 0, rotate: -24, scale: 0.82 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 24, scale: 0.82 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <ThemeIcon dark={isDark} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
