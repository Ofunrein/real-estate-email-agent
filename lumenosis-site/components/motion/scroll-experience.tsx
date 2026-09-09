"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";

// Scroll choreography director. Mounted only on /preview/scroll — production
// pages never load this module. All motion is transform/opacity/clip-path,
// selected via inert data-motion hooks in the section components.
// Timing + easing contract: MOTION.md.

const EASE = "power3.out";
const D = { fast: 0.5, base: 0.85, slow: 1.5 };

/** Line-draws an icon's ink strokes, then pops its accent shapes. */
function drawIcon(svg: SVGSVGElement, tl: gsap.core.Timeline, at: number) {
  const shapes = svg.querySelectorAll<SVGGeometryElement>("path, circle, rect");
  shapes.forEach((el) => {
    if (el.getAttribute("stroke") === "none") {
      // Filled accent (amber seal, cursor, knob…) — pops after the ink draws.
      tl.from(
        el,
        {
          scale: 0,
          opacity: 0,
          transformOrigin: "50% 50%",
          duration: 0.4,
          ease: "back.out(2.4)",
        },
        at + 0.5,
      );
      return;
    }
    const len = el.getTotalLength();
    tl.fromTo(
      el,
      { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" },
      at,
    );
  });
}

export function ScrollExperience() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const tickerFns: Array<(t: number) => void> = [];

    const mm = gsap.matchMedia();

    mm.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        fine: "(pointer: fine)",
        lg: "(min-width: 1024px)",
      },
      (ctx) => {
        const { motion, fine, lg } = ctx.conditions as {
          motion: boolean;
          fine: boolean;
          lg: boolean;
        };
        // Reduced motion: no Lenis, no timelines — the static page is the experience.
        if (!motion) return;

        let lenis: Lenis | null = null;
        if (fine) {
          lenis = new Lenis({ autoRaf: false, anchors: true });
          lenis.on("scroll", ScrollTrigger.update);
          const raf = (t: number) => lenis?.raf(t * 1000);
          gsap.ticker.add(raf);
          tickerFns.push(raf);
          gsap.ticker.lagSmoothing(0);
        }

        // Defer trigger creation one frame: gsap.matchMedia re-runs this
        // callback synchronously inside its media-change handler, and creating
        // ScrollTriggers there races its own revert/refresh loop
        // ("Cannot read properties of undefined (reading 'end')").
        const buildFrame = requestAnimationFrame(() => ctx.add(build));

        function build() {
          /* ---- Amber progress spine (desktop) ---- */
          if (lg) {
            gsap.to("[data-motion='spine-fill']", {
              scaleY: 1,
              ease: "none",
              scrollTrigger: { trigger: document.body, start: "top top", end: "max", scrub: 0.4 },
            });
            gsap.to("[data-motion='spine-dot']", {
              top: "100%",
              ease: "none",
              scrollTrigger: { trigger: document.body, start: "top top", end: "max", scrub: 0.4 },
            });

            // Ruler ticks: one notch per section boundary, so the spine reads
            // as a table of contents for the scroll.
            const spine = document.querySelector<HTMLElement>("[data-motion='spine']");
            if (spine) {
              const max = document.documentElement.scrollHeight;
              const sections = document.querySelectorAll<HTMLElement>(
                "main > section, main section[id]",
              );
              const seen = new Set<HTMLElement>();
              sections.forEach((sec) => {
                if (seen.has(sec)) return;
                seen.add(sec);
                const top = sec.getBoundingClientRect().top + window.scrollY;
                if (top <= 0) return;
                const tick = document.createElement("div");
                tick.setAttribute("data-spine-tick", "");
                tick.style.cssText = `position:absolute;left:-2px;width:7px;height:1px;background:var(--color-muted);opacity:0.5;top:${(top / max) * 100}%`;
                spine.appendChild(tick);
              });
            }
          }

          /* ---- Act I: hero title sequence (on load, not scroll) ---- */
          // Headline lines set themselves like composed type: each line rises out
          // of a clip mask, then the supporting copy settles in with a soft blur.
          const heroLines = gsap.utils.toArray<HTMLElement>(
            "[data-motion='hero-copy'] h1 span[aria-hidden] > span",
          );
          const heroRest = gsap.utils.toArray<HTMLElement>("[data-motion='hero-copy'] > *:not(h1)");
          const heroTl = gsap.timeline({ delay: 0.2 });
          if (heroLines.length) {
            heroTl.from(heroLines, {
              yPercent: 108,
              clipPath: "inset(0 0 100% 0)",
              duration: 1.05,
              ease: "power4.out",
              stagger: 0.14,
              clearProps: "all",
            });
          }
          if (heroRest.length) {
            heroTl.from(
              heroRest,
              {
                y: 26,
                opacity: 0,
                filter: "blur(6px)",
                duration: 1.0,
                ease: EASE,
                stagger: 0.12,
                clearProps: "all",
              },
              0.55,
            );
          }

          /* Hero exhale — copy and landscape part at unequal speeds on the way out. */
          gsap
            .timeline({
              scrollTrigger: {
                trigger: "section#top",
                start: "top top",
                end: "bottom top",
                scrub: true,
              },
            })
            .to("[data-motion='hero-copy']", { y: -110, opacity: 0.3, ease: "none" }, 0)
            .to("[data-motion='hero-media']", { scale: 1.07, y: 46, ease: "none" }, 0);

          /* ---- Trust strip: aperture reveal ---- */
          gsap.fromTo(
            "[data-motion='trust']",
            { clipPath: "inset(0 42% 0 42%)", opacity: 0 },
            {
              clipPath: "inset(0 0% 0 0%)",
              opacity: 1,
              duration: D.slow,
              ease: "power2.out",
              scrollTrigger: {
                trigger: "[data-motion='trust']",
                start: "top 92%",
                toggleActions: "play none none none",
              },
            },
          );

          /* ---- Act II: Iris — the pinned centerpiece ---- */
          const irisHeader = document.querySelector("[data-motion='iris-header']");
          if (irisHeader) {
            const tl = gsap.timeline({
              scrollTrigger: {
                trigger: irisHeader,
                start: "top 80%",
                toggleActions: "play none none none",
              },
            });
            tl.from(irisHeader.querySelector("p.font-mono"), {
              opacity: 0,
              letterSpacing: "0.5em",
              duration: D.base,
              ease: "power2.out",
            })
              .from(
                irisHeader.querySelector("h2"),
                { y: 44, opacity: 0, duration: D.base, ease: EASE },
                0.12,
              )
              .from(
                irisHeader.querySelector("h2 + p"),
                { y: 26, opacity: 0, duration: D.base, ease: EASE },
                0.28,
              );
          }

          gsap.from("[data-motion='iris-card']", {
            x: -44,
            opacity: 0,
            duration: 1.1,
            ease: EASE,
            scrollTrigger: {
              trigger: "[data-motion='iris-card']",
              start: "top 78%",
              toggleActions: "play none none none",
            },
          });

          // Each channel row ignites as it crosses the sticky card: rail draws,
          // number turns amber, the icon line-draws itself, and the matching
          // stat on the card pulses once — one shared memory, four channels.
          document.querySelectorAll<HTMLElement>("[data-motion='iris-row']").forEach((row) => {
            const rail = row.querySelector<HTMLElement>("[data-motion='iris-rail']");
            const num = row.querySelector<HTMLElement>("[data-motion='iris-num']");
            const icon = row.querySelector<SVGSVGElement>("svg");
            const statCell = row.dataset.stat
              ? document.querySelector<HTMLElement>(`[data-stat-cell='${row.dataset.stat}'] p`)
              : null;

            const tl = gsap.timeline({
              scrollTrigger: {
                trigger: row,
                start: "top 74%",
                toggleActions: "play none none none",
              },
            });
            tl.from(row, { y: 38, opacity: 0, duration: D.base, ease: EASE }, 0);
            if (rail) {
              gsap.set(rail, { transition: "none" });
              tl.fromTo(
                rail,
                { height: 0 },
                { height: "calc(100% - 3.5rem)", duration: 0.7, ease: "power2.out" },
                0.2,
              );
              // After igniting, the rail settles back so focus stays with the
              // row currently crossing the card — not four lit rails at once.
              tl.to(rail, { opacity: 0.4, duration: 0.8, ease: "power2.inOut" }, 1.6);
            }
            if (num) tl.to(num, { color: "var(--color-brand-amber)", duration: 0.4 }, 0.25);
            if (icon) drawIcon(icon, tl, 0.15);
            if (statCell) {
              // Fired via call() so the amber from-state never pre-renders on
              // rows that haven't triggered yet (ScrollTrigger reverts render
              // fromTo states at setup).
              tl.call(
                () => {
                  gsap.fromTo(
                    statCell,
                    {
                      color: "var(--color-brand-amber)",
                      scale: 1.14,
                      transformOrigin: "left center",
                    },
                    { scale: 1, duration: 0.9, ease: "power2.out", clearProps: "color,scale" },
                  );
                },
                [],
                0.55,
              );
            }
          });

          /* ---- Act III: the demo floor ---- */
          gsap.from("[data-motion='demo-copy'] > div:first-child", {
            x: -48,
            opacity: 0,
            duration: 1.0,
            ease: EASE,
            scrollTrigger: {
              trigger: "#aria",
              start: "top 74%",
              toggleActions: "play none none none",
            },
          });
          gsap.from("[data-motion='demo-copy'] .grid > *", {
            scale: 0.92,
            y: 22,
            opacity: 0,
            duration: D.base,
            ease: EASE,
            stagger: 0.09,
            scrollTrigger: {
              trigger: "[data-motion='demo-copy'] .grid",
              start: "top 82%",
              toggleActions: "play none none none",
            },
          });
          document
            .querySelectorAll<HTMLElement>("[data-motion='demo-panel']")
            .forEach((panel, i) => {
              gsap.from(panel, {
                y: 90 + i * 22,
                opacity: 0,
                duration: 1.15,
                ease: EASE,
                scrollTrigger: {
                  trigger: panel,
                  start: "top 86%",
                  toggleActions: "play none none none",
                },
              });
            });
          // The ambient amber pools in the demo drift with scroll — a living room.
          document.querySelectorAll<HTMLElement>("[data-motion='demo-glow']").forEach((glow, i) => {
            gsap.to(glow, {
              y: i === 0 ? 140 : -120,
              ease: "none",
              scrollTrigger: {
                trigger: "#aria",
                start: "top bottom",
                end: "bottom top",
                scrub: true,
              },
            });
          });

          /* ---- Plans: the two doors swing in from opposite sides ---- */
          const planCards = document.querySelectorAll("#plans .grid > *");
          planCards.forEach((card, i) => {
            gsap.from(card, {
              x: i % 2 === 0 ? -56 : 56,
              opacity: 0,
              duration: 1.0,
              ease: EASE,
              scrollTrigger: {
                trigger: card,
                start: "top 84%",
                toggleActions: "play none none none",
              },
            });
          });
          gsap.from("#plans h2, #plans h2 + p", {
            y: 34,
            opacity: 0,
            duration: D.base,
            ease: EASE,
            stagger: 0.12,
            scrollTrigger: {
              trigger: "#plans",
              start: "top 78%",
              toggleActions: "play none none none",
            },
          });

          /* ---- Calendar CTA: settles into place ---- */
          gsap.from("#book > div", {
            scale: 0.965,
            y: 34,
            opacity: 0,
            duration: 1.1,
            ease: EASE,
            scrollTrigger: {
              trigger: "#book",
              start: "top 82%",
              toggleActions: "play none none none",
            },
          });

          /* ---- FAQ: ledger lines ---- */
          gsap.from("#faq h2", {
            y: 30,
            opacity: 0,
            duration: D.base,
            ease: EASE,
            scrollTrigger: {
              trigger: "#faq",
              start: "top 80%",
              toggleActions: "play none none none",
            },
          });
          gsap.from("#faq [data-slot='accordion-item'], #faq .w-full > *", {
            y: 18,
            opacity: 0,
            duration: 0.7,
            ease: EASE,
            stagger: 0.055,
            scrollTrigger: {
              trigger: "#faq",
              start: "top 74%",
              toggleActions: "play none none none",
            },
          });

          /* ---- Act IV: deceleration ---- */
          const finalH2 = document.querySelector("[data-motion='final-cta'] h2");
          if (finalH2) {
            gsap.from(finalH2, {
              letterSpacing: "0.06em",
              opacity: 0,
              y: 24,
              duration: 1.4,
              ease: "power2.out",
              scrollTrigger: {
                trigger: finalH2,
                start: "top 82%",
                toggleActions: "play none none none",
              },
            });
          }
          gsap.from("[data-motion='final-cta'] h2 ~ *", {
            y: 22,
            opacity: 0,
            duration: D.base,
            ease: EASE,
            stagger: 0.1,
            scrollTrigger: {
              trigger: "[data-motion='final-cta']",
              start: "top 74%",
              toggleActions: "play none none none",
            },
          });

          // End card: the quote fades up slowly, the attribution after.
          const quote = document.querySelector("[data-motion='pull-quote']");
          if (quote) {
            const tl = gsap.timeline({
              scrollTrigger: {
                trigger: quote,
                start: "top 84%",
                toggleActions: "play none none none",
              },
            });
            tl.from(quote.querySelector("blockquote p"), {
              y: 26,
              opacity: 0,
              duration: 1.7,
              ease: "power2.out",
            }).from(
              quote.querySelector("footer"),
              { opacity: 0, duration: 1.0, ease: "power2.out" },
              0.8,
            );
          }
        }

        return () => {
          cancelAnimationFrame(buildFrame);
          lenis?.destroy();
          document.querySelectorAll("[data-spine-tick]").forEach((t) => t.remove());
        };
      },
    );

    const refresh = () => ScrollTrigger.refresh();
    if (document.fonts?.ready) document.fonts.ready.then(refresh);
    window.addEventListener("load", refresh);

    return () => {
      window.removeEventListener("load", refresh);
      for (const fn of tickerFns) {
        gsap.ticker.remove(fn);
      }
      mm.revert();
    };
  }, []);

  return (
    <div
      aria-hidden
      data-motion="spine"
      className="pointer-events-none fixed inset-y-0 left-4 z-40 hidden w-px bg-[var(--color-line)] lg:block"
    >
      <div
        data-motion="spine-fill"
        className="h-full w-full origin-top scale-y-0 bg-[var(--color-brand-amber)]"
      />
      <div
        data-motion="spine-dot"
        className="absolute left-1/2 top-0 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand-amber)] shadow-[0_0_12px_rgba(196,154,82,0.85)]"
      />
    </div>
  );
}
