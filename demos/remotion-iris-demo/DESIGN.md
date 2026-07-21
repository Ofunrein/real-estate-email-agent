# Design System — Iris Email Operations Film

_Aesthetic target: brokerage terminal meets editorial broadcast motion. Generated 2026-07-21._

## Palette

Near-black green `#0B0E0C` frames warm paper `#F2EFE8`. Clay `#D56F45` marks work; mint `#64B78A` marks safe completion. Values extend existing Brokerage Terminal UI and attached reference's restrained black field.

## Typography

- Display: Avenir Next Condensed, 64–168px, tight tracking.
- Body: Avenir Next, 16–28px.
- Mono: SF Mono, 13–16px, labels and machine state only.
- Hierarchy uses abrupt scale changes, not extra decoration.

## Spacing and shape

- 5px base. Scale: 5, 10, 15, 25, 40, 65, 105, 170px.
- Full-bleed 1920×1080. Asymmetric grids and large negative space.
- Radius capped at 6px. UI panels mostly 2–4px.
- Borders carry structure; shadows reserved for camera-separated hero panels.

## Motion

- All motion frame-derived through Remotion hooks.
- 180ms cuts, 520ms UI moves, 1100ms camera moves.
- Vocabulary: depth-stack parallax, masked type, data streams, match cuts, orbiting context, camera push/pull, focus falloff.
- No CSS keyframes or transitions.

## Prohibitions

- No Inter, blue-500, generic glass cards, random particles, oversized rounded tiles, default centered SaaS hero.
- No `transition: all`, CSS animation, GSAP, Hyperframes, or generated footage.
- No hardcoded color outside token mapping.

## Reference components

- Existing product captures: `public/property-detail.png`, `public/search-results.png`, `public/seller-lead.png`.
- Motion vocabulary: `/tmp/watch-remotion-reference/contact-sheet.jpg` supplied by user.
