"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import React from "react";
import { cn } from "@/lib/utils";
import { MenuToggleIcon } from "@/components/ui/menu-toggle-icon";
import { ThemeToggle } from "@/components/theme-toggle";

export function Topbar() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => () => { document.body.style.overflow = ""; }, []);

  const homePrefix = pathname === "/" ? "" : "/";

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
            <ThemeToggle />
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
            <ThemeToggle className="text-[var(--color-muted)]" />
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
