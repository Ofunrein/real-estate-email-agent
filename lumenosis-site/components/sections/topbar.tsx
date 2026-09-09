"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import React from "react";
import { cn } from "@/lib/utils";
import { MenuToggleIcon } from "@/components/ui/menu-toggle-icon";
import { runThemeTransition } from "@/lib/theme-transition";

function ThemeIcon({ dark }: { dark: boolean }) {
  if (dark) {
    return (
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
        <title>Dark mode</title>
        <path d="M19.55 15.82A7.55 7.55 0 0 1 8.18 6.45a.72.72 0 0 0-.82-1.04 8.5 8.5 0 1 0 11.23 11.23.72.72 0 0 0-.94-.94 7.3 7.3 0 0 1-1.9.25 7.55 7.55 0 0 1-7.55-7.55c0-.65.08-1.28.24-1.89a6.15 6.15 0 1 0 11.11 9.31z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <title>Light mode</title>
      <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 2.75v2.1M12 19.15v2.1M21.25 12h-2.1M4.85 12h-2.1M18.55 5.45l-1.48 1.48M6.93 17.07l-1.48 1.48M18.55 18.55l-1.48-1.48M6.93 6.93 5.45 5.45" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function Topbar() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => { setMounted(true); }, []);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => () => { document.body.style.overflow = ""; }, []);

  const homePrefix = pathname === "/" ? "" : "/";
  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => {
    runThemeTransition({
      nextTheme: isDark ? "light" : "dark",
      reduceMotion: Boolean(reduceMotion),
      updateTheme: setTheme,
    });
  };

  const links = [
    { label: "System", href: `${homePrefix}#agents` },
    { label: "Demo", href: `${homePrefix}#aria` },
    { label: "FAQ", href: `${homePrefix}#faq` },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-3 md:pt-4 pointer-events-none">
      {/* Main pill nav */}
      <nav
        className={cn(
          "pointer-events-auto relative flex items-center justify-between gap-4 rounded-full px-4 py-2.5 transition-all duration-500 ease-out",
          scrolled
            ? [
                "border w-[min(860px,calc(100vw-32px))]",
                "bg-[var(--color-bg)]/50 backdrop-blur-xl border-[var(--color-line)]",
                "dark:bg-black/60 dark:border-white/[0.08]",
                "shadow-[0_2px_20px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_20px_rgba(0,0,0,0.3)]",
              ]
            : "border-transparent w-[min(1000px,calc(100vw-32px))]",
        )}
      >
        {/* Mobile spacer keeps logo centered */}
        <div className="size-10 shrink-0 md:hidden" aria-hidden />

        {/* Logo — centered on mobile, left on desktop */}
        <a
          href={pathname === "/" ? "#top" : "/"}
          onClick={(e) => {
            if (pathname === "/") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
          }}
          className="absolute left-1/2 -translate-x-1/2 md:relative md:left-auto md:translate-x-0 md:flex-none inline-flex items-center gap-2 shrink-0"
        >
          <Image src="/images/lumenosis-logo-warm.png" alt="Lumenosis AI" width={32} height={32} className="rounded-lg" />
          <span className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--color-ink)]">
            Lumenosis <span className="text-[#6f4b16] dark:text-[var(--color-brand-amber)]">AI</span>
          </span>
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-0.5">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="px-3.5 py-1.5 text-[15px] font-medium text-[var(--color-ink)] transition-colors rounded-full hover:bg-[var(--color-line)]"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="grid size-9 place-items-center rounded-full text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={mounted && isDark ? "moon" : "sun"}
                  initial={reduceMotion ? false : { opacity: 0, rotate: -24, scale: 0.82 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 24, scale: 0.82 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ThemeIcon dark={mounted && isDark} />
                </motion.span>
              </AnimatePresence>
            </button>
            <a
              href="https://app.lumenosis.com"
              className="px-3.5 h-8 inline-flex items-center text-sm font-semibold text-[var(--color-ink)] transition-colors rounded-full border border-[var(--color-line)] dark:border-white/12"
            >
              Log in
            </a>
            <a
              href={`${homePrefix}#book`}
              className="px-4 h-8 inline-flex items-center text-sm font-semibold rounded-full bg-[var(--color-ink)] text-[var(--color-bg)] hover:opacity-85 transition-opacity active:scale-[0.97]"
            >
              Request Demo
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="grid size-9 place-items-center rounded-full border border-[var(--color-line)] text-[var(--color-ink)] md:hidden"
            aria-label="Toggle menu"
          >
            <MenuToggleIcon open={open} className="size-4" duration={300} />
          </button>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="pointer-events-auto absolute top-[calc(100%+6px)] left-4 right-4 rounded-2xl border border-[var(--color-line)] dark:border-white/[0.08] bg-[var(--color-bg)]/95 dark:bg-[#0f0f10]/95 backdrop-blur-xl shadow-xl p-3 flex flex-col gap-1 md:hidden">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="px-4 py-3 text-[15px] text-[var(--color-ink)] rounded-xl hover:bg-[var(--color-line)] transition-colors"
            >
              {link.label}
            </a>
          ))}
          <div className="h-px bg-[var(--color-line)] my-1" />
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-[var(--color-muted)]">Appearance</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="grid size-9 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-line)] transition-colors"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={mounted && isDark ? "mobile-moon" : "mobile-sun"}
                  initial={reduceMotion ? false : { opacity: 0, rotate: -24, scale: 0.82 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 24, scale: 0.82 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ThemeIcon dark={mounted && isDark} />
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
          <a
            href="https://app.lumenosis.com"
            onClick={() => setOpen(false)}
            className="px-4 py-3 text-[15px] font-semibold text-[var(--color-ink)] rounded-xl hover:bg-[var(--color-line)] transition-colors text-center"
          >
            Log in
          </a>
          <a
            href={`${homePrefix}#book`}
            onClick={() => setOpen(false)}
            className="flex items-center justify-center h-11 rounded-full text-[14px] font-semibold bg-[var(--color-ink)] text-[var(--color-bg)] hover:opacity-85 transition-opacity mt-1"
          >
            Request Demo
          </a>
        </div>
      )}
    </header>
  );
}
