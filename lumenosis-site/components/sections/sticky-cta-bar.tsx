"use client";

import { useEffect, useState } from "react";

export function StickyCtaBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY;
      const totalHeight = document.body.scrollHeight - window.innerHeight;
      const bookSection = document.getElementById("book");
      const beforeBooking = bookSection
        ? scrollY < bookSection.offsetTop - window.innerHeight * 0.2
        : true;
      const pastHero = scrollY > window.innerHeight * 0.9;
      const nearBottom = scrollY > totalHeight - 900;
      setShow(pastHero && beforeBooking && !nearBottom);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <aside
      aria-label="Request demo"
      aria-hidden={!show}
      className={`fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg)]/50 backdrop-blur-xl dark:bg-black/60 dark:border-white/[0.08] px-4 py-3 shadow-md transition-all md:inset-x-0 md:bottom-5 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <span className="min-w-0 flex-1 text-sm font-medium text-[var(--color-ink)]">
        Ready to stop losing paid inquiries?
      </span>
      {show && (
        <a
          href="#book"
          className="h-9 shrink-0 inline-flex items-center rounded-full bg-[var(--color-ink)] text-[var(--color-bg)] px-4 text-sm font-semibold hover:opacity-85 transition-opacity active:scale-[0.97]"
        >
          Request a Demo
        </a>
      )}
    </aside>
  );
}
