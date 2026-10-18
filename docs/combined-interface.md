# Combined interface review

The user selected Transcript desk + Timing desk as one plugin tab and Style inspector as the second tab, then requested keyframes for text-area placement and sizing. The current browser artifact is `design-concepts/index.html`, with `editor.css`, `editor.js`, the shared frame-boundary module `timing.mjs` and geometry evaluator `geometry.mjs`. The original three concepts are retained at `design-concepts/explorations/`.

## Scope and behavior

- Transcript: select a sentence in the continuous list to open its single horizontal word lane. The selected phrase and word inspector stay together. Drag word edges, use arrow keys or frame nudges, enter seconds, or set a boundary to the sample playhead. Touching edges move together and every word retains at least one frame. Disconnected gaps are bounded by neighbouring words. No timing interaction can create an overlap. Handles expose slider semantics: arrows move one frame, Shift+Arrow moves five, and Home/End move to the valid limits. Numeric edits round to frames and clamp; invalid input preserves the valid timing.
- Styling: independent Past words / Current word / Next words. Each has font, weight, size, fill, opacity, letter spacing, case, italic, stroke, shadow and word bubble controls. Shared caption layout/background and animation settings are disclosures within this second tab. Switching tabs retains the selected sentence, word, timings and style values. Copy style and Undo are explicit actions.
- Position & size: the first disclosure in the scrollable Styling body controls the selected caption across all word states. Center X/Y, independent width/height, stopwatches, key navigation and outgoing interpolation operate on sample geometry. The lower Height controls remain reachable by scrolling at 280px.
- Native Transcribe, track selection and Update Program Monitor are disabled. A labeled type sample demonstrates appearance without introducing a second video monitor. Animation settings are recorded, but browser animation playback is not claimed.
- Browser samples are synthetic. Sample edits live in memory; notes persist in local browser storage. Download review exports notes and sample configuration, including each caption's geometry and keyframes. Nothing is synchronized between devices.

The plugin has exactly two ARIA tabs, with Left/Right and Home/End navigation. Its reviewed fixture height is 900px on desktop and 920px at the mobile breakpoint. The sentence list and styling settings have their own scroll regions; the entire Transcript workspace also scrolls when optional text/grouping controls expand. The word lane intentionally scrolls horizontally at narrow widths. These fixture dimensions do not replace the installed panel's responsive sizing.

## Position & size behavior

Geometry uses a 1920 × 1080px sample frame. Position stores center X/Y together; Width and Height have independent tracks. A stopwatch enables a track and creates a key at the current frame. Editing a value while enabled creates or updates one key at that frame, including shared X/Y updates. Previous/next buttons navigate keys; the diamond adds or removes a key. Disabling a stopwatch holds the evaluated value and clears its keys; removing the last key also makes the track static. Undo restores the prior state.

The numeric playhead is relative to the selected caption's start. The timecode readout and slider use absolute sequence time, ending one frame before the caption's end boundary. After keyframe selects Linear, Ease in/out or Hold for the outgoing segment and is enabled only at a key. The browser evaluates interpolated values while scrubbing; it does not render on-video geometry. Font size remains unchanged. Regroup, split and merge resample geometry to preserve its value at each integer frame; key counts and interpolation labels can therefore change.

## Renderer boundary

The current production schema already has global stroke, shadow and caption background controls. Its per-word `WordAppearance` supports font, weight, scale, fill, opacity and bubble settings, but no per-state stroke/shadow fields. Independent per-state stroke and shadow in this proposal therefore require renderer/schema integration before shipping in Premiere. The installed Svelte panel, native services and serialized work lane were not changed by this design task.

Native Motion already owns on-video placement, independent sizing and keyframes. The new Position & size panel controls are a browser proposal; connecting them to the native bridge remains pending. Their evaluated sample values are separate from the labeled type sample and do not establish a second Program Monitor.

## Verification

Implementation validation passes `node --check design-concepts/editor.js` and `node --test design-concepts/timing.test.mjs design-concepts/geometry.test.mjs`: ten tests total. Five boundary tests cover shared edges, extreme edits, gaps, invalid input and 8,000 deterministic mixed edits that retain integer, positive, non-overlapping intervals. Five geometry tests cover shared Position keys and replacement, interpolation and bounds, independent valid dimensions, disabling/final-key removal, and per-frame preservation through split/merge resampling.

Browser evidence under `.impeccable/review/hybrid/` covers pointer dragging, keyboard boundaries, numeric clamping and Undo, frame nudges, sentence changes, tab selection/focus, independent state styling, style persistence, stroke/shadow samples, regroup/undo, text re-timing and empty search. The desktop 1280px and mobile 390px views, including a 280px plugin panel, have no page or panel horizontal overflow. The timeline itself intentionally scrolls horizontally. Default transcript controls fit inside the panel and the complete workspace remains scrollable when optional controls are expanded. Browser console has no errors.

The extension's `.impeccable/review/keyframes/checks.json` records Position/Width/Height tracks, interpolation midpoint values `[1080, 759, 1368, 258]`, a held X value of `960`, unchanged font size `54`, and Undo/tab persistence. Browser checks also covered key removal. Its size records show no horizontal page or panel overflow at 1280px, 390px, a 280px panel within 390px, and the 676px user viewport.

The detector ran once for this iteration. Its fixed-token and dense-type advisories are scoped to the established native panel/prototype, not an approval to rewrite production design tokens. The sample fonts are editable caption content.

## Documentation evidence

The scoped [design-system record](../design-concepts/DESIGN.md) and [component sidecar](../design-concepts/.impeccable/design.json) now describe the selected combined interface and Position & size extension. Their tokens come from `editor.css`; ten self-contained component examples show the current tabs, sentences, words, states, timing and geometry controls. The geometry specimen includes all three tracks, stopwatches, key navigation, relative/absolute time displays and outgoing interpolation. The root production design record and sidecar remain unchanged.

The documenter reconciled `index.html`, `editor.css`, `editor.js`, `timing.mjs`, the selected-combination surface contract, `checks.json`, and these eight captures under `.impeccable/review/hybrid/`: `desktop-transcript.png`, `desktop-styling.png`, `mobile-transcript.png`, `mobile-styling.png`, `mobile-transcript-panel.png`, `mobile-styling-panel.png`, `narrow-transcript-panel.png` and `narrow-styling-panel.png`. The narrow Styling capture includes enabled stroke and shadow controls. This was a documentation correction to the finish review's stale scoped-record finding, without another UI revision or browser audit.

Static validation passed: YAML and JSON parse, eight canonical sections in order, twelve palette tokens matched to the source CSS, valid component/token references, ten self-contained examples with scoped classes, eight-step color metadata ramps, and exact Markdown-to-sidecar narrative mapping. All eight cited captures and the sixteen saved browser-check records were present. Runtime tests were not repeated for this documentation-only correction.

For the extension, the documenter additionally inspected `geometry.mjs`, `geometry.test.mjs`, the updated editor source and User extension surface contract, and six captures under `.impeccable/review/keyframes/`: `desktop.png`, `mobile.png`, `narrow.png`, `user-676.png`, `height-controls.png` and `narrow-height-controls.png`. The last two confirm the lower Height controls after scrolling. No additional browser audit or implementation edit was performed during this documentation update.

The extension's documentation validation also passed: the sidecar's three geometry tracks, six pressed keyframe controls, current time displays, canonical token references and narrative mapping are consistent, and all six captures plus four overflow-check records are present.

## Published review

The Position & size extension was published to the existing [owner-private Styling review](https://better-captions-premiere-review.swenhalver.chatgpt.site/concepts/?tab=style) on 2026-10-17. Site source commit `8ee76964d6238f476488670412fe88ee0aa0f7c3`, deployment `appgdep_6ad30b515f9081918284a016da9914ba`, and version `appgprj_6ad2dbaa92d881919fd7f5eca5e9e47f~appgver_6c8d10a36ffc81918a0b72500f567f9d` succeeded. Access settings remained owner-private.

The live browser check confirmed Position interpolation: X moves from 960 at relative frame 0 to 1200 at frame 24 and evaluates to 1080 at frame 12. No console errors were reported. Its final full-page capture is `../better-captions-interface-design/outputs/better-captions-keyframe-controls.png` from the repository root. The fresh extension finish review returned `ship` with no material fixes; its report is `work/keyframe-finish-review.md`.

The prior combined mockup was published to the existing [owner-private review Site](https://better-captions-premiere-review.swenhalver.chatgpt.site/concepts/) on 2026-10-17. Its Site source commit is `5c24ac2981553f3589be407c6f3dd752148ae679`; deployment `appgdep_6ad306dffd9c8191b72aab5fae2c0fb5` succeeded. This earlier revision predates the Position & size extension.

The publishing agent verified the live numeric end edit: entering `999` clamps the selected word's end to `5.958s` and moves the connected next word's start to the same value. The live page had no console errors or horizontal page overflow at the actual user viewport (676px outer / 661px client). Its final full-page captures are `../better-captions-interface-design/outputs/better-captions-combined-transcript.png` and `../better-captions-interface-design/outputs/better-captions-combined-styling.png` from the repository root. The scoped documentation reconciliation followed deployment and does not imply those documentation files were included in that Site source commit.
