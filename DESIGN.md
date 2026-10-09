<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

---
name: SentinelDesk
description: A private review desk for outgoing files.
---

# Design System: SentinelDesk

## 1. Overview

**Creative North Star: "The Quiet Desk"**

SentinelDesk is a calm, exact, discreet workbench for a tense moment — about to share a folder outside the organization. The system borrows its familiarity from Notion, Figma, and Stripe Dashboard: dense but legible lists, consistent panels, trustworthy data presentation. Restrained color keeps attention on evidence, not chrome. Motion only conveys state. The tool disappears into the review task so the user can send with confidence.

This system explicitly rejects SaaS marketing landing tropes and neon security-ops decor. No gradient heroes, no metric tiles, no glowing alarms.

**Key Characteristics:**
- Familiar product density over decoration
- Evidence-first hierarchy: what, where, why, how detected
- Restrained surfaces with one deliberate accent
- State-driven motion only

## 2. Colors

Restrained strategy: cool slate neutrals plus one deep pine/teal accent used on ≤10% of any screen.

**The Restrained Rule.** One accent carries primary actions, current selection, and state indicators only. Its rarity is the point.

- **Primary accent hue:** deep pine/teal family [to be resolved during implementation]
- **Neutrals:** cool slate ramp for background, surface, borders, ink [to be resolved during implementation]
- **Status roles:** error, warning, success treatments to be defined alongside findings taxonomy [to be resolved during implementation]

## 3. Typography

Single technical sans direction for the whole product: one tuned sans carries headings, buttons, labels, body, and data.

- **Display / Headline / Title / Body / Label:** single sans family, tighter scale ratio 1.125–1.2, fixed rem steps [font pairing to be chosen at implementation]
- **Evidence quotes, paths, hashes:** mono treatment to be decided at implementation (sans + mono pairing is approved if evidence legibility wins)

**The One Family Rule.** No display serif in UI labels, buttons, or data tables. Contrast comes from weight and size steps, not font switching.

## 4. Elevation

Flat by default. Depth comes from tonal layering (second neutral layer for sidebars and panels), not shadows. Shadows appear only as a response to state such as hover, popover, or focus.

## 5. Components

No components exist yet — omitted intentionally. Document button, input, finding card, evidence viewer, badge, and navigation once shadcn primitives land. Do not invent variants before code exists.

## 6. Do's and Don'ts

### Do:
- **Do** use one sans across labels, data, and body with consistent button and form vocabulary screen to screen.
- **Do** reserve the pine/teal accent for primary actions, selection, and state; keep everything else neutral.
- **Do** give every interactive component full states: default, hover, focus, active, disabled, loading, error.
- **Do** pair every image-region finding with a text equivalent and keep body line length at 65–75ch for prose.

### Don't:
- **Don't** build SaaS marketing landing patterns: gradient heroes, hero-metric tiles, identical icon-card grids.
- **Don't** use tiny uppercase tracked kickers above every section or numbered 01/02/03 section markers.
- **Don't** use side-stripe borders greater than 1px, gradient text, or decorative glassmorphism.
- **Don't** use decorative motion or orchestrated page-load sequences; motion conveys state only in 150–250 ms.
- **Don't** say "safe" or "clean" in results language; the only success copy is "Reviewed. No open detected findings."
