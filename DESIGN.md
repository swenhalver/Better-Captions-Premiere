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
  word-state-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: ".4rem .3rem"
  status-tag:
    backgroundColor: "transparent"
    textColor: "{colors.panel-secondary}"
    rounded: "{rounded.control}"
    padding: ".1rem .4rem"
  caption-cue-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.panel-text}"
    padding: ".875rem 1.125rem"
  word-timing-block:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.panel-text}"
    padding: ".3rem"
    height: "2.3rem"
  word-timing-block-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.panel-text}"
  text-area-key-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: ".25rem"
    width: "1.8rem"
  settings-section:
    backgroundColor: "transparent"
    textColor: "{colors.panel-text}"
    padding: ".5rem 1.125rem 1.125rem"
---

# Design System: Better Captions

## Overview

**Creative North Star: "The Premiere Native Workspace"**

Better Captions belongs beside footage in Premiere: calm charcoal surfaces, compact system typography and familiar rectangular controls. Blue identifies selection, focus and the main action; neutral hierarchy keeps the transcript readable under controlled ambient light.

The interface is dense without hiding state. Labels stay explicit, timing uses tabular figures, and supporting detail opens through native disclosures. Selection connects sentence timing, word appearance and caption placement without adding a video canvas. The browser review shell remains a fixture around the installed panel’s visual system.

**Key Characteristics:**

- Host-aware charcoal hierarchy.
- Compact, familiar rectangular controls.
- Restrained blue action and selection.
- Flat surfaces with visible keyboard states.
- Explicit selection and editing scope.

## Colors

A neutral editor palette uses blue for interaction and soft semantic colors for feedback. Frontmatter values are normative; the source is `webview-ui/src/app.css`.

### Primary

- **Action Blue** (`primary`, `primary-hover`): the apply action and its hover state.
- **Selection Slate** (`selection`): selected cues, words, appearance states and enabled keyframe controls.
- **Focus Blue** (`accent`): keyboard outlines, active workspace tabs, selected word boundaries, enabled keyframe icons, playback timing and range controls.

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

The current panel has two workspaces: Transcript and Styling. Transcript puts search and sentence grouping above the caption list, then anchors the selected sentence’s word lane and timing controls in its editor. Sentence text and caption timestamps are edited directly in the list; compact Split/Merge actions belong in the lane toolbar. Styling remains a single column at all panel widths, with appearance selection, a type sample, selected-caption geometry, and disclosed appearance/layout controls. Selection persists when switching workspaces.

The word lane scrolls horizontally inside its own bordered region. Fit content is the default and uses the available width without horizontal scrolling. Numeric precision zooms enlarge that fitted width. Vertical wheel gestures over the lane change zoom around the pointer; horizontal and Shift-scroll gestures pan. It never wraps into multiple timing lanes. Narrow panels retain the same controls; toolbar buttons may wrap, text wraps, and X/Y fields stay in two columns.

## Elevation & Depth

A darker field ground, stepped charcoal surfaces and single-pixel separators establish hierarchy. Controls remain flat at rest and during interaction.

**The Flat Surface Rule.** Use tonal changes and thin separators for hierarchy. The panel has no box-shadow vocabulary; the focus outline communicates interaction, not elevation.

## Shapes

Controls, tags and loading placeholders share gently squared corners through `rounded.control`. Panels, rows, word-timing blocks and workspace tabs keep straight section edges. Borders and dividers use a single-pixel stroke; workspace selection uses a two-pixel underline. Icons are simple inline strokes, usually (1.25rem) inside a square (2.25rem) action. The compact keyframe toolbar uses (1.1rem) SVG icons inside (1.8rem) controls.

## Components

### Mac text ribbon

The user-selected styling direction follows a compact native rich-text toolbar.
Case, segmented Bold/Italic, foreground and word-background swatches, outline,
font search, supported numeric weight, font size, line height and alignment share
a wrapping strip. Keep font fields together when docked. Alignment appears only
for All words. A closed case selector shows Aa; its menu uses complete names.

Color swatches open direct HSLA channel sliders and draggable values. Alpha is
opacity; do not open another operating-system color dialog. The background
popover also owns bubble enable, padding, corners and Color spaces between words.
Preserve independent colors when changing only alpha and independent opacities
when changing only color. Spacing, Outline, Shadow and Layout remain real tabs.

Use official Lucide icons wherever a matching icon exists, with the packaged ISC
notice. Bold, Italic, Outline and Line height share the same rendered icon size;
do not let the line-height glyph inherit the smaller numeric-field text size.

### Buttons

Neutral buttons use raised charcoal, a divider-colored border and regular label text. Hover changes the ground and border; press uses the field ground. The blue primary variant uses semibold white text and a transparent border. Icon buttons begin transparent. Disabled buttons use opacity (0.5) and a default cursor.

All share the global focus treatment: a two-pixel accent outline, offset by (2px). State changes are immediate; the panel defines no transition or animation duration.

### Inputs / Fields

The caption font field is a searchable combobox with its own charcoal list rather
than a browser datalist. Opening shows installed families; typing filters, arrows
choose an item, Enter applies and Escape cancels. The list scrolls independently
and uses the normal blue focus/selection treatment. A count and Refresh appear
only while the list is open. Numeric weight options come from the chosen family's
installed faces/range. Italic stays available and synthesizes a slant when needed.

Explicit labels sit above dark recessed fields with a small gap (0.375rem). Inputs, selects and textareas share one-pixel borders and the control radius. Hover lightens the border; focus uses the global outline. Textareas use line-height (1.6) and a minimum block size of (5rem). Checkbox and range accents use Focus Blue.

### Navigation

The Transcript and Styling workspace tabs use muted text, semibold weight and an accent underline when selected. Preserve tab semantics and Arrow, Home and End keyboard navigation. Word appearance uses a separate three-button group labeled Past words, Current word and Next words. These equal-width buttons use caption-size text; the pressed state combines Selection Slate with an accent border and text. Preserve their pressed-button semantics rather than presenting them as additional workspaces.

### Tags

The browser-demo status tag is a small outlined rectangle with muted caption text. It describes fixture state and is not an interactive filter or a pill.

### Sections / Containers

Settings use flat, full-width sections separated by thin borders. Native summary markers and compact semibold headings reveal secondary controls. There is no floating card style or shadow treatment.

Typography is open by default for the chosen word state. Stroke, Shadow and Word bubble are collapsed groups whose summaries show On or Off; their fields remain visible but disabled when the effect is disabled. Caption layout & background, animation, initial placement and timing sync remain secondary to the active editing task.

### Caption Cues

Each full-width row combines a muted ordinal, tabular timecode and wrapping caption text. Click the sentence or its timestamps to edit in place. Edits commit on blur or their keyboard action, support Escape cancellation, and preserve Undo and validation. Selection uses Selection Slate; hover uses Raised Charcoal; playing timing uses Focus Blue. Keyboard focus is drawn inside the row with outline-offset (-2px).

### Sentence Word Lane

The selected sentence has a single horizontal time lane. Timing blocks have widths and positions proportional to the word’s duration and start time. Selected blocks use Selection Slate with an accent border; every word exposes directly draggable edge handles on hover/focus, and dragging selects it in the same gesture. A three-label ruler, zoom selector, frame count and two-column Start/End spinner fields expose timing. Spinner arrows apply one frame immediately. A thin noninteractive lane marker follows Premiere’s CTI; there is no separate plugin playhead slider or duplicate sentence strip.

**The Single Lane Rule.** Keep the selected sentence’s words on one time-based lane. Edges snap to sequence frames and stop at adjacent boundaries. They remain independent, including when words touch, so trimming an edge can open a gap without moving its neighbour. Dragging a whole word translates both ends while space is available, then shortens at a neighbour or caption boundary. The minimum edited word duration is three frames. Preserve draggable handles and numeric spinner controls; Split acts before the selected word.

### Word Appearances and Type Sample

Each of Past words, Current word and Next words has independent font family, size, weight, italic, color, opacity, letter spacing, case, stroke, shadow and word-bubble settings. The sample uses these content styles on clickable words, wraps them inside a recessed rectangular field, and is explicitly labeled “Type sample.” It is an interactive specimen; Premiere’s Program Monitor remains the video output surface. User-chosen caption colors, bubble corners and text effects do not become panel UI tokens.

### Position & Size

A flat disclosure labeled Selected caption groups Position, Width and Height. Position exposes X/Y fields; width and height each occupy a full field row. Each track has a stopwatch, static/key count, previous/add-or-remove/next keyframe icons, and interpolation. Pressed stopwatches and key diamonds use Selection Slate with accent icons. The compact toolbars retain the common keyboard outline and disabled states.

A caption-frame field and range control lead the tracks; refresh and Undo remain visible above them. The geometry controls apply across all word states of the selected caption. Width reflows text at its existing font size, while height is independent. The browser fixture labels its sample interactions; native Motion controls require an applied caption.

**The Explicit Scope Rule.** Label all-caption appearance controls separately from selected-caption Position & size controls. Keep the selected sentence visible in Styling and retain its selection when changing workspaces.

## Do's and Don'ts

### Do:

- **Do** honor host background, text, border and secondary-text overrides.
- **Do** use the shared spacing, corner and type scales for new controls.
- **Do** preserve visible keyboard focus, explicit field labels and tabular timing.
- **Do** use muted semantic status colors with actionable text.
- **Do** keep details in named disclosures when they would crowd a narrow panel.
- **Do** expose selected-caption geometry separately from the three all-caption word appearances.
- **Do** keep the word lane horizontally scrollable and provide numeric and frame-step timing controls.

### Don't:

- **Don't** replace system UI typography with decorative display lettering.
- **Don't** add ornamental shadows or motion to the flat host controls.
- **Don't** use selection blue as a general container background.
- **Don't** confuse user-configurable caption output styling with panel UI tokens.
- **Don't** carry the browser review toolbar or synthetic fixture labels into native chrome.

<!-- Updated from app.css, main-webview.svelte, PanelTabs, TranscriptPreview, WordTimeline, WordStates, WordSample, TextAreaControls and StylePanel for the approved 2026-10-17 production composition. Browser desktop, docked and keyframe captures support the visual rules; Adobe runtime acceptance remains unverified. BrowserPreview.svelte is a review wrapper only. -->
