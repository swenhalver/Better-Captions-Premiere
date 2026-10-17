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

FIRST VIEWPORT: Compact title and sequence header, native transcription action, two tabs, scrollable sentence list and the selected sentence’s one-lane word timeline. Persistent lower apply area. At wide widths the transcript list sits alongside its editor; the docked version stacks them. Signature interaction: choosing a cue anchors its editor and preserves selection across tabs, with direct access to all three word states. Timing edges clamp to adjacent words; connected edges move together on the sequence frame grid. Styling holds Past words / Current word / Next words, each with typography, stroke, shadow and bubble controls. Selected-caption Position & size supplies X/Y, independent width/height, stopwatches, key navigation, interpolation and Undo. Width reflows at fixed font size. A labeled type sample is an interactive specimen, while Premiere remains the sole video monitor.

FORM: Premiere-native canon explicitly requested by the user. The seven considered sources were subtitle proofs, film-festival catalogues, type specimens, continuity scripts, exhibition signage, contact sheets and sound cue sheets. Catalog challengers (console, cassette, grid specimen, lexicon, atlas, emission rail) do not override that pinned choice. No raster comp; this session builds code-first, no standing default recorded.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Approved production implementation, 2026-10-17

The user combined concepts 1 and 2 into Transcript and designated concept 3 as Styling, then requested native keyframe controls and a functional Mac-compatible GitHub build. This implements that confirmed composition in the Svelte UXP panel. Browser-only keyframes are explicitly labeled sample controls. Native operations use bounded, identity-checked Premiere transactions and readback. This is an extension of the user-pinned Premiere world; no new direction choice or raster comp is required.

## Reusable style presets, 2026-10-17

Local extension: add a compact preset picker above the existing Styling controls. Save a named snapshot of all three resolved word appearances, shared layout/background and animation. Apply, rename, replace and delete use the existing native-style fields, buttons and inline feedback. Presets live in plugin user data across projects on the same computer; the hosted preview uses browser storage and says so. Applying a look preserves placement, grouping, timing and native area/keyframes. Save errors stay visible and stale revisions require a reload. The existing design system and two-tab structure remain authoritative.
