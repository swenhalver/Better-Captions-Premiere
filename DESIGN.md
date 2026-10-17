---
name: Better Captions
description: A compact Premiere-native caption editing workspace.
colors:
  panel-bg: "var(--uxp-host-background-color, #232323)"
  panel-text: "var(--uxp-host-text-color, #ededed)"
  panel-border: "var(--uxp-host-border-color, #414141)"
  panel-secondary: "var(--uxp-host-text-color-secondary, #b0b0b0)"
  surface: "#292929"
  surface-raised: "#363636"
  surface-overlay: "#454545"
  input: "oklch(23% .002 260)"
  selection: "oklch(38% .043 258)"
  primary: "oklch(49% .15 258)"
  primary-hover: "oklch(55% .15 258)"
  accent: "oklch(80% .105 258)"
  success: "#9fd5b5"
  warning: "#e9c57d"
  error: "#ffb4a9"
  error-bg: "#3a2927"
  white: "#ffffff"
typography:
  title:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "1.154rem"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: ".923rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: ".846rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: ".25rem"
spacing:
  xs: ".25rem"
  s: ".5rem"
  m: ".875rem"
  l: "1.125rem"
  xl: "1.5rem"
components:
  button-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.panel-text}"
    rounded: "{rounded.control}"
    padding: ".4rem .75rem"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: ".4rem .75rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.panel-text}"
    rounded: "{rounded.control}"
    padding: ".4rem"
  field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.panel-text}"
    rounded: "{rounded.control}"
    padding: ".4rem .55rem"
  workspace-tab:
    backgroundColor: "transparent"
    textColor: "{colors.panel-secondary}"
    padding: ".8rem .15rem"
  workspace-tab-selected:
    textColor: "{colors.accent}"
  word-state-tab-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.panel-text}"
    rounded: "{rounded.control}"
    padding: ".45rem .2rem"
  status-tag:
    backgroundColor: "transparent"
    textColor: "{colors.panel-secondary}"
    rounded: "{rounded.control}"
    padding: ".1rem .4rem"
  caption-cue-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.panel-text}"
    padding: ".875rem 1.125rem"
  settings-section:
    backgroundColor: "transparent"
    textColor: "{colors.panel-text}"
    padding: ".5rem 1.125rem 1.125rem"
---

# Design System: Better Captions

## Overview

**Creative North Star: "The Premiere Native Workspace"**

Better Captions belongs beside footage in Premiere: calm charcoal surfaces, compact system typography and familiar rectangular controls. Blue identifies selection, focus and the main action; neutral hierarchy keeps the transcript readable under controlled ambient light.

The interface is dense without hiding state. Labels stay explicit, timing uses tabular figures, and supporting detail opens through native disclosures. The browser review shell is a fixture, not part of the installed panel’s visual system.

**Key Characteristics:**

- Host-aware charcoal hierarchy.
- Compact, familiar rectangular controls.
- Restrained blue action and selection.
- Flat surfaces with visible keyboard states.

## Colors

A neutral editor palette uses blue for interaction and soft semantic colors for feedback. Frontmatter values are normative; the source is `webview-ui/src/app.css`.

### Primary

- **Action Blue** (`primary`, `primary-hover`): the apply action and its hover state.
- **Selection Slate** (`selection`): selected cues and the active compact word-state tab.
- **Focus Blue** (`accent`): keyboard outlines, active workspace tabs, playback timing and native range controls.

### Neutral

- **Host Charcoal / Host Ink / Host Divider / Host Muted** (`panel-bg`, `panel-text`, `panel-border`, `panel-secondary`): host-adaptable panel ground, readable text, separators and supporting text.
- **Panel Charcoal** (`surface`): sequence header, tab strip and output area.
- **Raised Charcoal / Hover Charcoal** (`surface-raised`, `surface-overlay`): default buttons, loading placeholders and hover feedback.
- **Field Charcoal** (`input`): recessed fields and pressed neutral buttons.
- **Action White** (`white`): primary-button text.

Functional feedback uses **Saved Sage** (`success`) for success messages, **Timing Amber** (`warning`) for estimated timing, and **Error Peach** (`error`) over **Error Charcoal** (`error-bg`) for actionable errors.

**The Host Palette Rule.** Honor the host’s background, text, border and secondary-text overrides. The documented fallbacks describe the browser fixture; they must not replace host theme values.

Modern engines use the source’s OKLCH declarations; the input, selection, primary and accent tokens have hex fallbacks in `app.css`. Hue variables resolve to (260) for the near-neutral field and (258) for blue. Unused aliases and browser-shell-only colors are intentionally absent from this system.

## Typography

**UI Font:** Segoe UI, then the platform system stack. No webfont or display face is loaded.

The root size is (13px), with a base line-height of (1.45). Most text is regular (400); headings, tabs, sequence identity and the primary action use semibold (600).

### Hierarchy

- **Title:** larger section and empty-state headings; use the `title` token.
- **Body:** caption text, sequence identity and workspace tabs; use `body`. Caption list text has a line-height of (1.5).
- **Label:** field labels, compact controls and disclosures; use `label`. Buttons use a line-height of (1.4).
- **Caption:** timecodes, metadata and help; use `caption`. Sequence metadata may inherit the base line-height.

Timing and numeric inputs use tabular figures. Keep text wrapping available for sequence names, caption text and errors.

**The Steady Type Rule.** Keep interface text on the system stack. Fonts selected for rendered captions are content settings, not UI typography.

## Layout

The installed panel fills its container and scrolls its middle content region. Header and output controls remain outside that scroll region; the output area can scroll when it reaches (40%) of panel height. The normal docked range is (280–480px).

Use the shared spacing rhythm for section padding and gaps. Field groups use two equal columns with (0.875rem) row and (0.5rem) column gaps; wide fields span both columns. Form controls have a minimum block size of (2.25rem); the apply button uses (2.5rem).

Transcript list and editor stack below the container breakpoint (48rem, or 624px at the base size). At that breakpoint, they form columns `minmax(18rem, .8fr)` and `minmax(22rem, 1fr)`. The stacked list is bounded by `clamp(7rem, 16vh, 12rem)`; expanded lists allow (60vh). Use container width, not the outer browser window, to choose this topology.

## Elevation & Depth

A darker field ground, stepped charcoal surfaces and single-pixel separators establish hierarchy. Controls remain flat at rest and during interaction.

**The Flat Surface Rule.** Use tonal changes and thin separators for hierarchy. The panel has no box-shadow vocabulary; the focus outline communicates interaction, not elevation.

## Shapes

Controls, tags and loading placeholders share gently squared corners through `rounded.control`. Panels, rows and workspace tabs keep straight section edges. Borders and dividers use a single-pixel stroke; workspace selection uses a two-pixel underline. Icons are simple inline strokes, usually (1.25rem) inside a square (2.25rem) action.

## Components

### Buttons

Neutral buttons use raised charcoal, a divider-colored border and regular label text. Hover changes the ground and border; press uses the field ground. The blue primary variant uses semibold white text and a transparent border. Icon buttons begin transparent. Disabled buttons use opacity (0.5) and a default cursor.

All share the global focus treatment: a two-pixel accent outline, offset by (2px). State changes are immediate; the panel defines no transition or animation duration.

### Inputs / Fields

Explicit labels sit above dark recessed fields with a small gap (0.375rem). Inputs, selects and textareas share one-pixel borders and the control radius. Hover lightens the border; focus uses the global outline. Textareas use line-height (1.6) and a minimum block size of (5rem). Checkbox and range accents use Focus Blue.

### Navigation

Workspace tabs use muted text, semibold weight and an accent underline when selected. Compact word-state tabs sit inside a dark bordered group and use a filled selection state. Preserve tab semantics and Arrow, Home and End keyboard navigation.

### Tags

The browser-demo status tag is a small outlined rectangle with muted caption text. It describes fixture state and is not an interactive filter or a pill.

### Sections / Containers

Settings use flat, full-width sections separated by thin borders. Native summary markers and compact semibold headings reveal secondary controls. There is no floating card style or shadow treatment.

### Caption Cues

Each full-width row combines a muted ordinal, tabular timecode and wrapping caption text. Selection uses Selection Slate; hover uses Raised Charcoal; playing timing uses Focus Blue. Keyboard focus is drawn inside the row with outline-offset (-2px).

## Do's and Don'ts

### Do:

- **Do** honor host background, text, border and secondary-text overrides.
- **Do** use the shared spacing, corner and type scales for new controls.
- **Do** preserve visible keyboard focus, explicit field labels and tabular timing.
- **Do** use muted semantic status colors with actionable text.
- **Do** keep details in named disclosures when they would crowd a narrow panel.

### Don't:

- **Don't** replace system UI typography with decorative display lettering.
- **Don't** add ornamental shadows or motion to the flat host controls.
- **Don't** use selection blue as a general container background.
- **Don't** confuse user-configurable caption output styling with panel UI tokens.
- **Don't** carry the browser review toolbar or synthetic fixture labels into native chrome.

<!-- Extracted from app.css, main-webview.svelte and components/*.svelte; reviewed against desktop and docked QA captures. BrowserPreview.svelte is a review wrapper only. -->
