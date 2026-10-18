---
name: Better Captions combined interface
description: Non-shipping design-system record for the selected Transcript and Styling browser mockup.
colors:
  page: "#171717"
  panel: "#252525"
  surface: "#2b2b2b"
  raised: "#363636"
  input: "#1d1d1d"
  line: "#454545"
  quiet: "#363636"
  text: "#ededed"
  muted: "#b8b8b8"
  accent: "#a3c6ff"
  selection: "#344860"
  error: "#ffb4a9"
typography:
  body:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
  metadata:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.45
  sentence:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  word:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  word-title:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "15px"
    fontWeight: 550
    lineHeight: 1.45
  review-body:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  review-title:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-.02em"
rounded:
  control: "3px"
  trim-handle: "2px"
  timing-block: "1px"
spacing:
  compact: "4px"
  field: "5px"
  related: "7px"
  field-grid: "9px"
  section: "10px"
  panel-inset: "12px"
components:
  button-default:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "2px 5px"
  button-native-unavailable:
    backgroundColor: "#2c4667"
    textColor: "#b9cbe1"
    rounded: "{rounded.control}"
    padding: "5px 9px"
    width: "100%"
  button-keyframe:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "3px"
    width: "27px"
    height: "28px"
  button-keyframe-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.accent}"
  field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 7px"
  workspace-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "10px 0"
  workspace-tab-selected:
    textColor: "{colors.accent}"
  sentence-selected:
    backgroundColor: "#2d3c4e"
    textColor: "{colors.text}"
    padding: "10px 12px"
  word-selected:
    backgroundColor: "{colors.selection}"
    textColor: "#f0f6ff"
    rounded: "{rounded.control}"
    padding: "1px 3px"
  state-option:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "7px 2px"
  timing-block:
    backgroundColor: "#414a56"
    textColor: "{colors.text}"
    rounded: "{rounded.timing-block}"
    padding: "4px 5px"
    height: "38px"
  timing-block-selected:
    backgroundColor: "#4b6b92"
    textColor: "#ffffff"
  trim-handle:
    backgroundColor: "#d1e3ff"
    rounded: "{rounded.trim-handle}"
    padding: "0"
    width: "11px"
    height: "44px"
  inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    padding: "10px 12px"
  plugin-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    height: "900px"
---

# Design System: Better Captions combined interface

## Overview

**Creative North Star: "The Premiere Native Workspace"**

**Non-shipping review scope.** This record describes design-concepts/index.html, editor.css, editor.js, timing.mjs and geometry.mjs. The user selected one combined panel with exactly two tabs: Transcript joins the continuous sentence list to the selected sentence's horizontal word timeline; Styling holds independent Past words, Current word and Next words settings, plus the selected caption's Position & size keyframes. The original three proposals remain at explorations/ as decision history.

Flat charcoal surfaces, compact system text, rectangular controls and restrained blue selection retain the established Premiere-native direction. The surrounding browser page supplies width controls, explanation and local review notes. The panel is explicitly labeled as a synthetic mockup with no Premiere connection. [The root DESIGN.md](../DESIGN.md) and its sidecar remain the production design authority; this local record does not alter the installed Svelte panel, native services or renderer/schema.

**Key Characteristics:**

- Exactly two tabs with shared sentence and word selection.
- A continuous transcript together with its selected sentence's single horizontal word lane.
- Shared adjacent boundaries, frame precision and no word overlap.
- Independent past/current/next appearance with shared caption layout and animation.
- Selected-caption center, width and height keyframes with explicit sample/native boundaries.
- Flat tonal hierarchy, explicit labels and visible keyboard focus.
- Browser review furniture and labeled caption type samples outside native output claims.

Fixed review colors and a dense pixel scale are intentional local fixture choices. The production system retains host overrides, a (13px) base, rem spacing and its existing control radius. Detector advisories about fixed tokens and dense type are scoped to this mockup.

## Colors

The frontmatter records the reused UI palette from editor.css. Its CSS variables are the source for this browser fixture.

### Primary

- **Focus Blue** (accent): focus outlines, active workspace labels, selected-state labels, range controls and timing metadata.
- **Selection Slate** (selection): the selected word in the phrase. Selected sentence, state and timeline blocks use their observed local blue-gray treatments.
- The unavailable native update uses a subdued blue component treatment; its disabled state remains visible.

### Neutral

- **Review Charcoal** (page): the review page behind the single panel.
- **Panel Charcoal** (panel) and **Section Charcoal** (surface): panel body, header, word inspector and output footer.
- **Raised Charcoal** (raised) and **Field Charcoal** (input): neutral buttons and recessed fields.
- **Divider Gray** (line) and **Quiet Divider** (quiet): control boundaries and internal section rules.
- **Panel Ink** (text) and **Muted Ink** (muted): primary content and supporting labels.

**Error Peach** (error) carries invalid input feedback. Boundary clamping is explanatory status text. The sample playhead uses the normal blue range control; this combined interface has no amber playhead marker.

**The Sample Color Rule.** Yellow bubbles, selected caption fonts and state opacity belong to the editable caption samples. They are not panel accents or UI typography.

## Typography

**UI Font:** Segoe UI followed by the platform system stack. The artifact loads no external font.

The panel uses the body, label and metadata roles from the frontmatter. Semibold headings use (550–600); sentence rows, phrase words and the selected-word inspector use their own roles. Timecodes and timing inputs use tabular figures. Timeline word labels use (11px), while the ruler and sample/footer explanations use (9px).

The review shell uses the review-body and review-title roles. Its heading reduces to (24px) at the (680px) viewport breakpoint; the supporting explanation uses (13px). These page headings stay outside plugin chrome.

Editable type samples default to Arial and offer Arial, Georgia, Verdana, Trebuchet MS and Impact. Size is entered in pixels. The selected-sentence sample renders caption values at (0.4) scale, and state swatches at (0.3), including stroke, shadow, padding and corners. The sample demonstrates appearance rather than pixel-accurate native output.

**The UI Type Rule.** Keep panel controls on the system stack. Editable caption fonts remain content settings.

## Layout

The review page centers a maximum (1080px) container with (32px) padding. Its workbench places the chosen panel width beside a flexible explanation column of at least (240px), with a (56px) gap. At (850px) and below, page side padding becomes (20px), the gap becomes (28px), and the explanation column minimum becomes (210px).

At (680px) and below, the workbench stacks the panel above the explanation and notes. Page side padding becomes (16px), and the selected panel width is capped by available space. The width control offers (280px), (360px) and (480px). These are browser review widths, not installed-panel sizing rules.

The panel is a vertical flex layout with sequence context and two workspace tabs above its content, and status/Undo plus disabled native output below it. Its final fixture height is (900px), or (920px) at the mobile breakpoint. The later CSS overrides are authoritative over earlier fixture-height declarations. Field groups use two equal columns with the field-grid gap.

- **Transcript:** search and optional grouping settings precede the scrollable continuous sentence list. The selected sentence, word lane, timing inspector and sample playhead stay together beneath the list. The list retains at least (110px); the whole Transcript workspace also scrolls when expanded text/grouping controls require more room.
- **Word lane:** the selected sentence uses one horizontal row of sequential time blocks beneath a ruler. The lane is (75px) high, grows to preserve readable labels, and scrolls horizontally inside its frame. Zoom offers (100%), (150%) and (200%). Selecting a sentence replaces the lane; selecting a word brings its block into view. At (280px), lane scrolling is intentional and does not widen the panel or page.
- **Styling:** selected-sentence context, three state choices and a labeled type sample precede a scrolling settings region. Position & size opens first in this region; Typography, Stroke, Shadow, Word bubble, Caption layout and Animation follow it. The lower Height track remains reachable by scrolling, including at (280px). Position's X/Y fields share a two-column row with interpolation spanning the next row; Width and Height each pair a value with interpolation. The type sample can scroll within a (140px) maximum height when content grows.

The sample playhead and default timing controls fit inside the reviewed panel heights. Expanded Transcript controls use the workspace scroll fallback. No video canvas, player or simulated Program Monitor is present.

## Elevation & Depth

Panel hierarchy comes from charcoal levels, recessed fields and single-pixel separators. UI controls have no box-shadow or animated elevation. Hover and press change the control ground immediately. Editable caption text shadow is a content effect, independent of panel elevation.

**The Flat Surface Rule.** Use tone and separators for the review panel; focus outlines identify interaction rather than elevation.

There is no UI transition vocabulary. The reduced-motion rule forces automatic scrolling. Animation values in Styling are recorded sample settings; browser animation playback is not implemented.

## Shapes

Controls use gently squared corners. Timing blocks are sharper, with narrow vertical handles extending above and below the blocks. Panel boundaries, sentence rows and section edges stay square. Borders use single-pixel strokes; active workspace selection uses a two-pixel underline. Small inline SVG strokes identify the sequence, stopwatch, previous/next keyframe and keyframe diamond. A selected diamond fills with the accent color. Rounded yellow caption bubbles are editable sample content.

## Components

### Buttons

Neutral buttons have a raised ground and visible border, with a (30px) base minimum height. Hover lightens the ground and border; press returns to the field ground. Compact actions and frame nudges use local smaller heights. Focus is a two-pixel accent outline with a (2px) offset; trim handles use zero outline offset.

Transcribe, destination-track selection and Update Program Monitor are disabled. The update footer communicates the intended destination without performing native work. Undo restores up to (40) in-memory snapshots covering caption edits, caption geometry/keyframes, state styles, shared layout and animation. Copy style explicitly copies the selected state to one or both other states.

### Inputs / Fields

Visible labels sit above recessed fields and selects. Start and End show seconds, with adjacent one-frame nudges and the selected word's frame duration. Timing values round to integer frames and clamp to valid boundaries; invalid or empty values retain the valid timing and show a status error. Numeric style fields clamp to their displayed ranges on commit. Disabled effect fieldsets remain visible at reduced opacity.

### Navigation

Transcript and Styling are an ARIA tablist with selected state, roving tab focus and an associated tabpanel. Left/Right arrows switch tabs; Home/End select the first/last tab. The selected tab is reflected in the URL. Tab changes retain sentence, word, timing and style state, and restore focus to the tab.

Past words, Current word and Next words form a separate pressed-button group inside Styling. They select which independent style is being edited. Native details/summary controls preserve their open state through render updates.

### Sentences, Words and Grouping

Each full-width sentence button combines an ordinal, tabular time range and wrapping text. Selection uses a blue-gray row; the selected word is emphasized in that row and selectable in the phrase and timeline. Clicking a sentence selects its first word and replaces the timeline. Search filters sentences and provides a clear-search empty state.

Grouping exposes the maximum before applying: (4), (6) or (8) words, with sentence-ending stops. Split, Merge next and regroup retain existing word times and gaps. They also resample geometry to preserve its evaluated values at every integer frame in the resulting caption ranges; keyframe count and interpolation labels can change. Text edits preserve timing when word counts match; changed counts distribute the sentence's frames without overlap and request timing review. A sentence must retain at least one frame per word.

### Word Timing

The selected word has separate start and end handles. Pointer dragging, arrow keys, frame nudges, numeric seconds and Set start / Set end to the sample playhead all use timing.mjs. Touching edges are shared: moving one also moves its adjacent word's edge. A disconnected gap can be used only within the neighbouring word's boundary. Every word stays ordered, inside its sentence and at least one frame long; editing cannot create overlap.

Handles expose slider labels, limits, current frame values and spoken seconds. Arrow keys move one frame; Shift+Arrow moves five; Home/End use the valid minimum/maximum. Pointer cancellation restores the prior timing. Limit feedback explains why movement stopped. The sample is (24fps); its playhead slider supplies a boundary value and does not play media.

### Position and Size Keyframes

The open Position & size disclosure starts the scrollable Styling body. Its scope line names the selected sentence, all word states and the (1920 × 1080px) sample frame. Center X/Y belong to one Position track; Width and Height are independent tracks. These values belong to the selected caption, whereas the past/current/next appearance settings apply across sample captions.

Each track has an accessible pressed-state stopwatch, key count, previous key, add/remove diamond and next key. Enabling its stopwatch creates a key at the current sample frame. Editing a numeric value while enabled creates or updates that frame's key; X and Y updates share the same Position key. A pressed diamond identifies a key at the playhead. Disabling retains the evaluated current value and clears that track's keys; removing its final key also returns it to static. Undo restores the prior values and keys.

The playhead input is relative to the caption's start frame; the blue timecode output and slider refer to absolute sequence time. The frame range ends at the caption's last frame, one frame before its end boundary. Native number/range controls support keyboard navigation. Enter, blur or change commits numeric drafts; values round and clamp to their displayed limits, while empty or invalid input preserves the valid state.

After keyframe selects Linear, Ease in/out or Hold for the outgoing segment from the key at the playhead. It is disabled between keys. Linear interpolates proportionally, Ease in/out uses a smooth start and finish, and Hold retains the left key's value until the next key. Values before the first key or after the last remain at that endpoint. Displayed pixel values are rounded; the model keeps the evaluated interpolation values.

Text-area geometry does not change caption font size. The mockup evaluates and exports sample values; it does not place or resize a video overlay or use the type sample as a video monitor. Native Motion owns on-video placement and independent text-area sizing. Connecting these new panel controls to that bridge remains pending.

### Independent Appearance and Shared Settings

Past words, Current word and Next words each own font, weight, size, fill, opacity, letter spacing, case, italic, stroke, shadow and word bubble settings. State styling applies across all sample captions. The labeled type sample updates these effects and allows a word to become current without changing the selected sentence.

Caption layout/background and Animation are shared settings in the same Styling tab. Layout includes alignment, line height, sample line width and caption background controls. Animation offers Fade, Pop, Bounce, Typewriter and Karaoke with fade-in/out values; playback still requires a renderer.

The current production schema already supports global stroke and shadow, but its per-word WordAppearance has no per-state stroke/shadow fields. Independent state effects here are an interface proposal requiring renderer/schema integration before shipping. The mockup does not change production source, native services or serialized work.

### Browser Review Notes

Notes persist only in this browser through local storage. Download review exports notes plus the in-memory captions/timings, each caption's geometry/keyframes, state styles, layout, animation and frame rate as JSON. Storage failure offers download as the retention path. Sample edits are not automatically persisted or synchronized. Reset demo restores the sample model and Undo history while preserving the chosen tab and browser notes.

## Do's and Don'ts

### Do:

- **Do** keep exactly two plugin tabs, with the selected sentence and its word lane together in Transcript.
- **Do** route every timing edit through shared frame boundaries and preserve at least one frame per word.
- **Do** preserve visible focus, explicit labels, tabular timing and contextual validation.
- **Do** keep independent state effects separate from shared caption layout and animation settings.
- **Do** keep Position & size scoped to the selected caption across all states, with font size independent of geometry.
- **Do** retain narrow-panel scrolling and clearly label sample data, type samples and unavailable native actions.
- **Do** use the root design system when implementing this direction in the production panel.

### Don't:

- **Don't** treat review-only tokens or per-state effects as an already shipped renderer/schema change.
- **Don't** introduce a third plugin tab for timing or animation in this selected combination.
- **Don't** allow word edits to overlap, reorder words or collapse a word below one frame.
- **Don't** add a fake Program Monitor or imply direct word clicking inside Premiere's monitor.
- **Don't** present evaluated sample geometry as a completed native Motion bridge integration.
- **Don't** imply that sample edits or browser notes synchronize between devices.
- **Don't** promote editable caption colors, fonts, bubbles or text shadows into panel UI styling.

<!-- Evidence: index.html; editor.css; editor.js; timing.mjs; geometry.mjs; ../PRODUCT.md; ../DESIGN.md; the Selected combination and User extension contracts in ../.impeccable/surfaces/design-concepts-index-html.md; ../docs/combined-interface.md; checks.json and the eight captures under ../.impeccable/review/hybrid/ plus checks.json and six captures under ../.impeccable/review/keyframes/ listed in that review. Documentation-only reconciliation, 2026-10-17. -->
