# Lumenosis Website Copy Refresh

## Branch: `feature/website-copy-refresh`

## Priority Order

1. Hero subheading rewrite (hero.tsx line 131-133) — highest-visibility copy on the page, mandatory per brief.
2. Pull-quote em dash (pull-quote.tsx &mdash; entity) — hard rule violation, one-line fix.
3. Theo SMS em dash (aria-deep-dive.tsx theoThread sms-2) — em dash inside product demo copy, one-character fix.
4. Trust strip UI: gradient fade replacing hard border between hero and trust strip.
5. TwoWaysIn path 01 description em dash replacement (two-ways-in.tsx).
6. Aria deep dive heading rewrite ('never sleeps and never asks for a raise' -> affirmative).
7. Aria deep dive body paragraph rule-of-three agent name chain.
8. 'Channel memory' microfeature passive voice fix.
9. Final CTA heading tighten ('actually worth your time' -> diagnostic outcome).
10. Sticky CTA bar body rewrite ('Ready to scale?' -> 'See it handle a live lead.').
11. Problem agitation leak card 02 trim.
12. Trust strip eyebrow rewrite ('Trusted by' -> outcome frame).
13. Case study wall heading 'actually say' -> 'say'.
14. FAQ pricing placeholder $X/$Y fill — blocked on pricing decision, flag for Martin.
15. Run grep for AI vocabulary words across content/ and components/sections/ before launch.

---

## Hero Changes

**File:** `components/sections/hero.tsx` lines 131-133

OLD → NEW (subheading):
- OLD: `Olivia answers your website. Aria answers the phone. Theo texts every lead in under sixty seconds. Iris turns inbound emails into booked valuations.`
- NEW: `Every lead gets a reply in under sixty seconds. Every call gets answered. Every inquiry gets qualified, followed up, and pushed toward a booking. Your team shows up to the meeting.`

No video poster to remove — no video element exists in hero.tsx. Static product card mockup via Next.js `<Image>`. No action required.

Hero stat callouts, CTA button, and H1 rotating niche slot: keep as-is.

---

## Section Changes

### trust-strip.tsx

> Trusted by top real estate teams

**Real estate teams that stopped losing leads**

*The original is a vague authority claim. The replacement anchors in the outcome that got these teams onto the page. Stronger frame for the ICP.*

---

### problem-agitation.tsx

> The team does not capture timeline, intent, financing, property type, or next step cleanly.

**The team never captures timeline, financing, or who owns the next call.**

*The original lists five items in a row. Three of them are low-stakes. This version names the two that create the most expensive downstream failures (timeline, financing) and adds accountability (ownership). Shorter, more credible.*

---

### aria-deep-dive.tsx

> The front desk that never sleeps and never asks for a raise.

**Your front desk. Open every hour. No salary, no sick days, no dropped calls.**

*Original uses a double-negative parallel ('never...never'). Replacement states the positives directly with a three-beat rhythm that reads as a short staccato list rather than a rhetorical flourish. No em dash, no hedging.*

---

> A buyer asks about a listing. Iris replies with real property details, Aria answers the call, and Theo keeps the text thread moving until a showing or valuation is booked.

**A buyer asks about a listing. Iris replies with real property details before the lead opens another tab. Aria picks up if they call. The thread keeps moving until a showing is on the calendar.**

*The original forces all three agent names into one sentence as a triad. Splitting into three sentences removes the rule-of-three feel, gives each action its own weight, and removes the passive-sounding 'is booked' at the end.*

---

> Yes it is — 3 bed, 2 bath, $529k. Are you pre-approved or working with an agent?

**Yes, still available: 3 bed, 2 bath, $529k. Are you pre-approved or working with an agent?**

*Em dash replaced with colon. No meaning change.*

---

> Email, voice, and SMS share the same lead context.

**Every channel reads from the same lead record.**

*Original names three channels in a list. Replacement collapses them and uses active voice with a clear subject ('every channel').*

---

### two-ways-in.tsx

> The complete AI front desk for solo agents and small teams who want to stop losing leads to slow follow-up — in 30 days.

**The complete AI front desk for solo agents and small teams who want to stop losing leads to slow follow-up. Fully running in 30 days.**

*Em dash replaced by a period and a new short sentence. Reads cleaner, more confident.*

---

### pull-quote.tsx

> &mdash; Real Estate Professional, Austin TX

**Real Estate Professional, Austin TX**

*Em dash entity removed. Attribution stands on its own as plain text, which is standard in print-style citations. The italic blockquote provides enough visual separation.*

---

### sticky-cta-bar.tsx

> Ready to scale? Book a demo.

**See it handle a live lead. Book a demo.**

*Original assumes visitor intent (scaling). Replacement uses the demo angle: 'See it handle a live lead' matches product demo positioning and lowers the perceived commitment of booking.*

---

### final-cta.tsx

> Have a thirty-minute conversation that's actually worth your time.

**Thirty minutes. Walk away knowing exactly what your lead handoff costs you.**

*Original hedges with 'actually worth your time', which signals insecurity. Replacement states the concrete outcome of the call (diagnostic clarity on lead cost), which is more persuasive and aligns with the audit-led offer framing.*

---

### faq.tsx / content/faq.ts

> Two paths. Build with us starts at $X for a one-time install. Scale with us starts at $Y per month for ongoing coverage. The strategy call walks through which one fits.

**Two paths. Build starts at $[PRICE] as a one-time install. Scale starts at $[PRICE]/month for ongoing coverage. The strategy call walks through which one fits your team.**

*Placeholder $X/$Y replaced with explicit fill-in markers. Blocked on pricing decision — flag for Martin before launch.*

---

### case-study-wall.tsx / content/case-studies.ts

> What real estate teams actually say.

**What real estate teams say.**

*'Actually' is a filler qualifier. Removing it makes the heading more direct.*

---

### meet-the-team.tsx / content/agents.ts

No changes. Agent bullets are clean and specific. No AI vocabulary found.

---

### timeline-30day.tsx / content/timeline.ts

No changes. All four steps are clean fragment copy. Section heading 'Thirty days to a fully running system.' is direct.

---

## UI Changes

- **trust-strip.tsx — gradient fade:** Remove hard `border-b border-[var(--color-line)]` visual between hero and trust strip. Add a div as the last child of the hero `<section>` with class `pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[var(--color-bg-cream)] dark:to-black/40 z-10`. This softens the hard line without touching TrustStrip itself. File: `components/sections/hero.tsx` and/or `trust-strip.tsx`.
- **AI vocabulary grep — run before launch:** `grep -r 'seamlessly\|revolutionize\|leverage\|utilize\|streamline\|empower\|cutting-edge\|next-gen\|holistic\|robust' /Users/martinofunrein/Downloads/atlas/lumenosis-site/content /Users/martinofunrein/Downloads/atlas/lumenosis-site/components/sections`

---

## Execution Rules

- Do NOT edit aria-deep-dive.tsx demo message content (SMS/email/voice demo strings) — exception: the Theo SMS em dash fix in priority item 3 is permitted.
- Dark mode: leave as-is.
- Merge via PR to main after review.
