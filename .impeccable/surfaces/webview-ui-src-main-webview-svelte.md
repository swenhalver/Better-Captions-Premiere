---
version: 1
slug: "webview-ui-src-main-webview-svelte"
primary_target: "webview-ui/src/main-webview.svelte"
related_targets: ["webview-ui/src/app.css","webview-ui/src/components/TranscriptPreview.svelte","webview-ui/src/components/WordStates.svelte"]
---

# Caption panel

Mode: Operate. A docked Premiere editor for correcting transcript and word appearances. Primary target: webview-ui/src/main-webview.svelte.

## Direction contract

THESIS: A Premiere-native caption workspace. Keep the transcript immediately editable, with familiar Transcript / Styling tabs instead of a long stack of expanded settings.

OWN-WORLD: User-pinned Premiere native supersedes the assigned continuity-script direction (candidate 4, seed 81cb2555). Charcoal surfaces, system UI typography, blue active tabs and selection, compact rectangular fields, tabular timing. Restrained palette follows an editor working beside footage under controlled ambient light.

STORY: Confirm sequence, transcribe in Premiere, choose and edit a caption, style upcoming/current/spoken words, then apply to the main Program Monitor. Native-only actions remain clearly unavailable in the synthetic browser fixture.

FIRST VIEWPORT: Compact title and sequence header, native transcription action, two tabs, scrollable sentence list and the selected sentence’s one-lane word timeline. Persistent lower apply area. At wide widths the transcript list sits alongside its editor; the docked version stacks them. Signature interaction: choosing a cue anchors its editor and preserves selection across tabs, with direct access to all three word states. Timing edges are independent and clamp to adjacent words on the sequence frame grid; trimming touching words can open a gap without moving neighbours. Whole-word dragging translates timing in free space and shortens at a neighbour or caption boundary, down to three frames. Fit content is the default zoom. Styling holds Past words / Current word / Next words, each with typography, stroke, shadow and bubble controls. Selected-caption Position & size supplies X/Y, independent width/height, stopwatches, key navigation, interpolation and Undo. Width reflows at fixed font size. A labeled type sample is an interactive specimen, while Premiere remains the sole video monitor.

FORM: Premiere-native canon explicitly requested by the user. The seven considered sources were subtitle proofs, film-festival catalogues, type specimens, continuity scripts, exhibition signage, contact sheets and sound cue sheets. Catalog challengers (console, cassette, grid specimen, lexicon, atlas, emission rail) do not override that pinned choice. No raster comp; this session builds code-first, no standing default recorded.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Approved production implementation, 2026-10-17

The user combined concepts 1 and 2 into Transcript and designated concept 3 as Styling, then requested native keyframe controls and a functional Mac-compatible GitHub build. This implements that confirmed composition in the Svelte UXP panel. Browser-only keyframes are explicitly labeled sample controls. Native operations use bounded, identity-checked Premiere transactions and readback. This is an extension of the user-pinned Premiere world; no new direction choice or raster comp is required.

## Reusable style presets, 2026-10-17

Local extension: add a compact preset picker above the existing Styling controls. Save a named snapshot of all three resolved word appearances, shared layout/background and animation. Apply, rename, replace and delete use the existing native-style fields, buttons and inline feedback. Presets live in plugin user data across projects on the same computer; the hosted preview uses browser storage and says so. Applying a look preserves placement, grouping, timing and native area/keyframes. Save errors stay visible and stale revisions require a reload. The existing design system and two-tab structure remain authoritative.

## Character grouping correction, 2026-10-17

The user requires a character limit instead of a word limit. Preserve the existing Transcript grouping disclosure and control treatment; label the numeric field Characters per caption and show the character count in its summary. Count spaces/punctuation and explain whole-word exceptions. Regroup may split or rejoin unlinked captions across earlier automatic boundaries, preserving timings, sentence/placement/speaker boundaries and native linked-clip protections. Saved legacy word limits become the 56-character default without silently regrouping captions. No visual-system change is authorized or needed.

## One physical clip and linked grouping, 2026-10-17

The remote 0.7.3 continuation extends the same two-tab interface. Apply defaults to Automatic above footage. A new transcript uses one physical clip; sentence rows still open individual word timelines. Regroup works after Apply by changing internal rendered groups without replacing clip identities or keys. Deliberate transcript splits and supported native Razor cuts remain physical splits. Keep the character field readable at 280px even when its summary wraps. The design system is unchanged. Browser review covers the visible controls; native installation is blocked on this Windows PC and 0.7.3 remains unreleased.

## Installed-font search and typography, 2026-10-18

Replace the unreliable font datalist with a compact autocomplete combobox and a
scrollable list of local installed families. Search/select stays inside the panel;
the popup preserves the host palette, explicit keyboard focus, arrow/Enter/Escape
behavior and narrow-width fit. Weight choices are numeric and reflect only real
faces or variable ranges. Relative B uses the next available heavier weight above
All words. Italic remains available for every font, using synthetic slant when a
native italic face is absent. Font count/refresh and failure recovery belong in
the open popup, preserving the compact closed toolbar.

## Direct transcript editing, 2026-10-18

The user requested the caption list as the single sentence-editing surface.
Click sentence text or its timestamps to edit in place; remove the duplicate
selected-caption heading/word strip and separate text/timing disclosures. Keep
the horizontally scrollable word lane, with directly draggable edges on every
word, and place its Start/End spinner fields in two columns even in a narrow
panel. Input arrows adjust one frame and apply immediately. Premiere's CTI drives
the lane marker; a separate plugin playhead slider and persistent gesture-help
paragraph do not belong here. Compact Split-before-selected-word and Merge-next
actions belong in the lane toolbar, replacing the old disclosure. Fit content
is the default zoom; numeric zooms preserve precise scrolling. Word edits enforce
a three-frame minimum and shorten on collision while keeping neighbours fixed.
Preserve native
palette, focus, Undo and timing
validation, including non-destructive Escape cancellation.
