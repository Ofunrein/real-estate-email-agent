# Motion system

Scroll choreography for lumenosis.com. Mounted on the production homepage
(`app/page.tsx`) and on `/preview/scroll` (kept as a staging ground for
future motion work).

## Architecture

- `components/motion/scroll-experience.tsx` — the director. One client component
  that mounts Lenis + GSAP ScrollTrigger and choreographs the existing DOM.
  Sections stay server components; they expose inert `data-motion` attributes
  (no behavior or visual change when the director is absent).
- `components/reveal.tsx` — static passthrough wrapper. It forwards extra props
  so sections can hang `data-motion` hooks on it. Do not put animation back in
  here; entry motion belongs to the director.
- Libraries: `gsap` (ScrollTrigger) + `lenis` (smooth scroll, `anchors: true`).

## Timing + easing tokens

- Durations: fast `0.5s`, base `0.85s`, slow `1.5s`; end-card beats run 1.4–1.7s.
- Ease: `power3.out` for entrances, `power4.out` for the hero mask,
  `power2.inOut` for line-draws, `back.out(2.4)` for accent pops, `none` for scrubs.
- Scroll-linked properties are transform/opacity/clip-path only.

## The story (section beats)

1. **Hero** (`hero-copy`, `hero-media`) — title sequence on load: the two
   headline lines rise out of clip masks, supporting copy settles with a soft
   blur. On exit, a scrubbed "exhale": copy drifts up faster than the page,
   the landscape scales to 1.07.
2. **Trust strip** (`trust`) — aperture reveal (clip-path opens from center).
3. **Iris** (`iris-header`, `iris-card`, `iris-row`/`iris-rail`/`iris-num`,
   `data-stat` → `data-stat-cell`) — the centerpiece. Sticky card holds while
   each channel row ignites as it crosses: rail draws, number turns amber, the
   editorial icon line-draws (stroke-dashoffset; amber accents pop after), and
   the matching stat on the card pulses once. Rails settle to 40% opacity after
   igniting so focus stays with the current row.
4. **Demo** (`demo-copy`, `demo-panel`, `demo-glow`) — copy slides in from the
   left, micro-feature cards scale in, and demo panels rise without 3D tilt.
   Ambient amber pools drift on scrub.
5. **Plans** (`#plans`) — the two package cards swing in from opposite sides.
6. **Calendar** (`#book`) — scales/settles into place.
7. **FAQ** (`#faq`) — ledger-line stagger.
8. **Final CTA** (`final-cta`) — heading letter-spacing settles wide→tight.
9. **Pull quote** (`pull-quote`) — end card: quote fades up slow, attribution after.
10. **Spine** — fixed amber progress hairline at the left edge (desktop only)
    with a moving dot and ruler ticks at section boundaries.

## Contracts

- **Reduced motion**: `gsap.matchMedia` gates everything behind
  `(prefers-reduced-motion: no-preference)`. Reduced = no Lenis, no timelines;
  the static SSR page is the experience. Verified: rows/stats render at full
  opacity with no JS-applied states.
- **Touch**: Lenis only mounts on `(pointer: fine)`; touch keeps native momentum.
- **Mobile**: no pinning, no horizontal overflow (verified at 390px); the spine
  is desktop-only (`lg`).
- **SSR**: first paint is complete without JS; all from-states are applied
  client-side. Never pre-render a colored/scaled from-state on elements that
  haven't triggered — use `tl.call(() => gsap.fromTo(...))` (see the stat pulse).
- **ScrollTrigger creation is deferred one rAF** inside the matchMedia callback.
  Creating triggers synchronously in `_onMediaChange` races GSAP's own
  revert/refresh loop ("Cannot read properties of undefined (reading 'end')").
  Keep the deferral if you add new triggers. Use
  `toggleActions: "play none none none"` instead of `once: true` — self-killing
  triggers mutate GSAP's internal array mid-iteration.
- The Iris rail/number hover styles are overridden by inline GSAP values once a
  row has ignited on the preview; this is intentional (scroll replaces hover as
  the reveal mechanism there).

## Verifying changes

Dev server + agent-browser: screenshots at hero/iris/demo/plans/faq/end,
1440×900 and 390×844, dark + light (`localStorage.theme`), plus
`prefers-reduced-motion`. Check `agent-browser errors --json` — note the error
buffer is session-cumulative; install a `window.__errs` collector to test a
single load. Flip emulated media (light↔dark) to exercise the matchMedia re-run.
