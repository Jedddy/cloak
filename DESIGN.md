---
name: Cloak
description: A private review desk for outgoing files.
colors:
  pine: "oklch(0.46 0.07 175)"
  pine-foreground: "oklch(0.985 0.005 175)"
  pine-selection: "oklch(0.94 0.025 175)"
  canvas: "oklch(0.985 0.003 250)"
  sheet: "oklch(1 0 0)"
  panel: "oklch(0.963 0.005 250)"
  hover-slate: "oklch(0.945 0.007 250)"
  ink: "oklch(0.22 0.015 255)"
  ink-muted: "oklch(0.5 0.016 255)"
  rule: "oklch(0.905 0.008 250)"
  field-edge: "oklch(0.65 0.012 250)"
  brick: "oklch(0.53 0.17 28)"
  ochre: "oklch(0.52 0.11 70)"
  ochre-wash: "oklch(0.96 0.035 85)"
  highlighter: "oklch(0.93 0.075 95)"
  redaction: "oklch(0.16 0.01 255)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.225rem"
  md: "0.3rem"
  lg: "0.375rem"
  xl: "0.525rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.pine-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklch, oklch(0.46 0.07 175) 80%, transparent)"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline-hover:
    backgroundColor: "{colors.panel}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.panel}"
  button-destructive:
    backgroundColor: "color-mix(in oklch, oklch(0.53 0.17 28) 10%, transparent)"
    textColor: "{colors.brick}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive-hover:
    backgroundColor: "color-mix(in oklch, oklch(0.53 0.17 28) 20%, transparent)"
---

# Design System: Cloak

## Overview

**Creative North Star: "The Quiet Desk"**

Cloak is a calm, exact, discreet workbench for a tense moment: the user is about to share a folder outside the organization. The system takes its familiarity from Notion, Figma, and Stripe Dashboard: dense but legible lists, consistent panels, data presented so that it can be trusted. Cool slate neutrals carry almost every pixel. One deep pine accent marks what the user can act on and what is selected. Evidence (highlighted quotes, solid redaction blocks, mono paths) is the most visible material on the screen, not the chrome around it.

The tool follows the system light or dark setting. Light is the reference theme for daytime desk work; dark is a full, tuned token set, not an inversion. Motion conveys state only. The tool disappears into the review task so the user can send with confidence.

The system rejects SaaS marketing tropes and neon security-ops decor: no gradient heroes, no metric tiles, no glowing alarms, no red-alarm panels.

**Key Characteristics:**
- Product density over decoration: 14px body text, 32px controls, 6px corners
- Evidence-first hierarchy: what, where, why, how detected
- Slate neutrals with one pine accent on 10% or less of any screen
- Flat surfaces; depth from tonal layers
- State-driven motion only, 150–250 ms

## Colors

Restrained: a cool slate ramp (hue 250–255, chroma under 0.02) plus one deep pine accent (hue 175). Status colors are muted earth tones that read as information, not alarm. All values are OKLCH, which is the source format in `app/globals.css`. The frontmatter holds the light theme; the sidecar holds the dark values.

### Primary
- **Deep Pine** (`pine`): primary buttons, the selected finding row, focus rings, the caret, and the "Reviewed. No open detected findings." state. White text on pine is 6.6:1. In dark mode it lifts to a lighter sage-pine so that it stays the most visible control color.
- **Pine Selection** (`pine-selection`): background of the selected list row and of text selection. Ink on this tint is 14.6:1.

### Neutral
- **Canvas** (`canvas`): the app background, a near-white with a cool cast.
- **Sheet** (`sheet`): pure white for the document preview and popovers, so that the file under review looks like paper.
- **Panel** (`panel`): the second tonal layer for sidebars, the file list, and the details column. This layer, not a shadow, separates the three Review columns.
- **Hover Slate** (`hover-slate`): hover and pressed background of menu items and list rows.
- **Ink** (`ink`): all primary text. 16.6:1 on canvas.
- **Muted Ink** (`ink-muted`): secondary text, metadata, file sizes, timestamps. 5.7:1 on canvas and 5.4:1 on panel, so it passes AA on both layers.
- **Rule** (`rule`): 1px dividers and container borders.
- **Field Edge** (`field-edge`): input and checkbox borders. It is darker than Rule so that form fields meet the 3:1 non-text contrast minimum.

### Status
- **Brick** (`brick`): destructive actions, failed files, and errors. Muted red-brown, never a full alarm red. Use it as text or icon color, or as a 10% tint behind text.
- **Ochre** (`ochre`) on **Ochre Wash** (`ochre-wash`): "needs decision" suggestions, coverage gaps (file not processed, AI skipped), and a remote model endpoint. Ochre on wash is 5.0:1.
- **Highlighter** (`highlighter`): background of the exact evidence span in a text preview and in quotes. Ink on highlighter is 14.1:1.
- **Redaction** (`redaction`): the solid fill of an approved redaction. Near-black in light mode and true black in dark mode. Never striped, never blurred, never transparent.

### Named Rules
**The One Accent Rule.** Pine is used for primary actions, selection, focus, and the reviewed state only. It covers 10% or less of any screen. Its rarity is the point.

**The No Alarm Rule.** No status color fills a panel, a banner, or a full row. Status is a small icon, a text color, or a pale wash behind one line.

**The Solid Fill Rule.** A redaction is a solid block of the Redaction color with the exact bounds of the evidence. What the user sees is what the export burns in.

## Typography

**Body Font:** Inter (with ui-sans-serif, system-ui)
**Mono Font:** JetBrains Mono (with ui-monospace)

**Character:** Inter is a neutral, highly legible product sans that sets dense lists without noise. JetBrains Mono gives evidence quotes, file paths, SHA-256 hashes, and byte offsets a clear, unambiguous face (0/O and 1/l are distinct). Both are bundled locally through `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (imported in `app/layout.tsx`), so the app loads no remote fonts at runtime or build time. `--font-sans` and `--font-mono` in `app/globals.css` name them first.

### Hierarchy
- **Display** (600, 1.5rem, 1.25): the page title only, for example the package name. One per screen.
- **Headline** (600, 1.25rem, 1.3): section headings in the Settings and Export screens.
- **Title** (600, 1rem, 1.4): panel titles and the title of the selected finding.
- **Body** (400, 0.875rem, 1.5): the default for all UI text, list rows, and finding reasons. Prose blocks (finding explanations, help) are limited to 65–75ch.
- **Label** (500, 0.75rem, 1.4): field labels, column headers, badge text, file metadata. Sentence case, normal tracking.
- **Mono** (400, 0.8125rem, 1.5): evidence quotes, paths, hashes, offsets, model names. Ligatures are off.

### Named Rules
**The One Family Rule.** Inter carries all UI text. No display serif and no second sans. Contrast comes from weight and size steps, not from a font change.

**The Mono Means Data Rule.** JetBrains Mono is used only for text that the user must compare exactly: quotes, paths, hashes, offsets, model identifiers. It is never used as decoration to look "technical."

**The Sentence Case Rule.** No uppercase tracked labels and no kicker above a heading. The heading carries its own weight.

## Layout

The Review screen is three columns in reading order: the file list on the left (Panel layer), the document preview in the center (Sheet), and the findings and decision details on the right (Panel layer). Columns are separated by tonal change and a 1px Rule, not by gaps or cards.

Spacing follows a 4px base: 4px inside tight groups (icon and label), 8px between related controls, 12px row padding in dense lists, 16px panel padding, 24px between sections, 32px between major page regions. Space above a heading is larger than space below it.

Controls are 32px high by default (28px small, 24px extra small, 36px large). Data in tables and counts uses tabular numerals (`tabular-nums`).

## Elevation & Depth

Flat by default. Depth comes from tonal layering: Canvas, then Panel for the side columns, then Sheet for the document and popovers. Popovers and menus get a 1px Rule border. A shadow appears only as a response to state (an open popover or a dragged item), and it always has a vertical offset and a soft blur. No zero-offset glows.

### Named Rules
**The Flat at Rest Rule.** Surfaces at rest have no shadow. If two areas need separation, change the tone or add a 1px Rule.

## Shapes

Small, precise corners. The base radius is 6px (`--radius: 0.375rem`). Buttons and inputs use the base radius; small and extra-small buttons use 4.8px; badges and inline chips use 3.6px; dialogs and popovers use up to 8.4px. Borders are always 1px. No pill buttons, no fully rounded controls except avatars and status dots. No colored side stripe thicker than 1px on any row, card, or callout.

## Components

Primitives are shadcn `base-nova` on Base UI in `components/ui/`. Product components are in `components/`. Labels for categories, detection methods, decisions, and statuses come from `lib/utils.ts` (`categoryLabel`, `methodLabel`, `decisionLabel`, `sentenceCase`). Raw slugs never reach the screen.

### App header
- **Shell:** full-width, 48px, Panel layer with a 1px Rule below (`components/app-nav.tsx`). The main area below is the scroll container.
- **Mark:** a sheet outline with one text line and one solid Pine bar. It shows the product idea: a document with a solid redaction.
- **Navigation:** text links; the current page gets Hover Slate and medium weight.
- **Model indicator:** always visible on the right and read on the server. A dot, the locality ("Local model", "LAN model", "Remote model"), the host when not local, and the model name in mono. Remote gets the Ochre wash. It links to Settings.

### Package workspace
- **Header:** breadcrumb, package name (Display), Mode and Locality badges, one meta line (recipient, profile, file count, status), and line tabs (Scan, Review, Preview, Export). The active tab has a 2px Pine underline on the header Rule. Review shows its open count in a neutral chip.
- **Review and Preview** fill the viewport height: Panel file column (16rem), Sheet document column, Panel findings column (24rem). Each column scrolls by itself. Below `lg` they stack.
- **Scan and Export** are left-aligned content up to 56rem wide, under the header.

### File row
Icon (Brick for failed, Ochre for not supported), mono file name, size and state in muted text, and a reason line in Brick or Ochre when needed. Open count is a neutral chip on the right. A processed file with no open findings shows a muted check. Excluded files are struck through at 60% opacity. The selected row uses Pine Selection.

### Decision mark
A 14px glyph that shows the decision in every list: an Ochre ring for open, a solid Redaction block for redact, a muted check for keep, a muted dash for not an issue.

### Finding row
Collapsed: decision mark, title, category on the right, then the quote in mono and the location in one muted line. Selected: Pine Selection background, the reason, the exact quote on Highlighter inside a Sheet block, a small definition list (where, detected by, profile suggestion), a 2×2 grid of decision buttons (the current decision is Primary with a check; Redact and Keep show their keys), and ghost row actions (Reopen, Find related, Exclude file). The selected row scrolls into view.

### Evidence viewers
- **Text:** mono, 24px line height, a muted line-number gutter. Open spans use Highlighter at 55%. The selected span is full Highlighter with a 2px Pine underline and scrolls into view. Redacted spans are solid Redaction. Kept spans lose the fill and get a dotted underline.
- **Image:** fit to the column width with a 1px Rule. Boxes: Ochre outline for open, solid Redaction for redact, dashed muted outline for keep, Pine outline and ring for selected. A sticky toolbar holds Draw box and Delete box.

### Segmented filter
A `ToggleGroup` on a Muted track. The pressed item is Sheet-colored with a light shadow and carries a count. Used for the decision filter and the recipient source.

### Form section
`components/form-section.tsx`: title and description in a 15rem left column, controls on the right, sections separated by a 1px Rule. Used by New package and Settings.

### Badges
3.6px corners, 20px high, 12px medium text. Outline for facts (Mode), the locality colors for Locality, Secondary for neutral counts. Never pill-shaped.

### Buttons
Quiet and exact: small, flat, and clear about what they do.

- **Shape:** gently squared corners (6px), 1px transparent border so that all variants align.
- **Primary:** Deep Pine with light text, 32px high, 10px side padding, 14px medium-weight label. Use one per area, for the main action ("Scan package", "Export reviewed copies").
- **Outline:** Canvas background with a Rule border. Hover changes to Panel. Use for secondary actions such as "Keep" and "Not an issue".
- **Ghost:** no background until hover (Panel). Use for toolbar and row actions.
- **Destructive:** a 10% Brick tint with Brick text, 20% on hover. Never a solid red block.
- **Focus:** the border changes to the ring color with a 3px ring at 50% opacity.
- **Active:** the button moves down 1px. **Disabled:** 50% opacity, no pointer events.
- **Icons:** Lucide, 16px, in one consistent stroke. Labels name their action.

## Do's and Don'ts

### Do:
- **Do** use the shadcn tokens (`bg-primary`, `bg-muted`, `text-muted-foreground`, `border-input`) and the Cloak additions (`bg-selection`, `bg-highlight`, `bg-redaction`, `text-warning`, `bg-warning-muted`) instead of raw color values.
- **Do** keep Pine on 10% or less of any screen: primary actions, selection, focus, and the reviewed state.
- **Do** give every interactive component all states: default, hover, focus, active, disabled, loading, error.
- **Do** pair every image-region finding with a text equivalent, and keep prose at 65–75ch.
- **Do** show where the model runs (local, LAN, remote) with text and an icon; mark remote with Ochre.
- **Do** keep transitions at 150–250 ms and for state only; reduced motion makes them instant.

### Don't:
- **Don't** build SaaS marketing patterns: gradient heroes, hero-metric tiles, identical icon-card grids.
- **Don't** use uppercase tracked kickers above sections or numbered 01/02/03 section markers.
- **Don't** use side-stripe borders thicker than 1px, gradient text, or decorative glass and blur.
- **Don't** use scores, progress rings, or "safe"/"clean" language. The only success copy is "Reviewed. No open detected findings."
- **Don't** let a file that was not processed, or processed without AI, look the same as a reviewed file. Mark it with Ochre and a reason.
- **Don't** draw redactions as outlines, stripes, or blur. A redaction is a solid Redaction block.
