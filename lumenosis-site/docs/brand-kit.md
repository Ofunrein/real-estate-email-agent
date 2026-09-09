# Lumenosis AI — Brand Kit

**Updated:** 2026-05-25

## Color palette

| Token | Hex | Use |
|---|---|---|
| `--brand-purple` | `#cb6ce6` | Primary brand, CTAs, glow, brand recognition |
| `--brand-black` | `#000000` | Pure black bg in dark mode hero / aurora canvas only |
| `--brand-charcoal` | `#1a1a1a` | Primary dark background (confirmed from Canva); cards, sections in dark mode |
| `--brand-white` | `#ffffff` | Text on dark, surfaces in light mode |

## Aurora gradient stops

For dark mode Aurora background (React Bits Aurora component):

```ts
colorStops={["#cb6ce6", "#9333ea", "#cb6ce6"]}  // brand purple → deeper violet → brand purple
blend={0.5}
amplitude={1.0}
speed={0.4}
```

## Logo

`./lumenosis-logo.png` — purple lightbulb mark on charcoal/black bg. Use on:
- Topbar / header (32-40px height)
- Footer (24px height)
- Open Graph / Twitter card (full size, padded)

## Tagline rule

**NO TAGLINE.** Do not use "RESPOND INSTANTLY • SAVE TIME • MORE BOOKINGS" or any variant. Brand focuses on logo + clean design.

## Usage rules

- Brand purple `#cb6ce6` = primary CTA, glow, accent. Replaces previous violet `#7C3AED`.
- Black `#000000` = aurora canvas, max-contrast hero in dark mode ONLY.
- Charcoal `#1a1a1a` = primary dark background, card surfaces in dark mode (confirmed from Canva).
- White `#ffffff` = text on dark, body bg in light mode.
- Cream `#F5F4EE` (legacy) = REMOVED. Light mode bg is now pure white `#ffffff` per brand kit.
- Aurora gradient: `#cb6ce6` → `#9333ea` → `#cb6ce6` at blend 0.5, amplitude 1.0, speed 0.4.

## Dark mode is default

Site loads in dark mode by default. Light mode is opt-in toggle.

In dark mode:
- bg = charcoal `#1a1a1a` (primary) with Aurora animated overlay; pure black `#000000` in hero/aurora canvas only
- cards = charcoal `#1a1a1a` with transparency + spotlight glow
- text = white `#ffffff` / 90% white for body
- accents = brand purple `#cb6ce6` glow on CTAs
