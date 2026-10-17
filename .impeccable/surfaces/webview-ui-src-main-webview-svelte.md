---
version: 1
slug: "webview-ui-src-main-webview-svelte"
primary_target: "webview-ui/src/main-webview.svelte"
related_targets: ["webview-ui/src/app.css","webview-ui/src/components/TranscriptPreview.svelte","webview-ui/src/components/WordStates.svelte"]
---

# Caption panel

Mode: Operate. A docked Premiere editor for correcting transcript and word appearances. Primary target: webview-ui/src/main-webview.svelte.

## Direction contract

THESIS: A Premiere-native caption workspace. Keep the transcript immediately editable, with familiar Transcript / Style / Motion tabs instead of a long stack of expanded settings.

OWN-WORLD: User-pinned Premiere native supersedes the assigned continuity-script direction (candidate 4, seed 81cb2555). Charcoal surfaces, system UI typography, blue active tabs and selection, compact rectangular fields, tabular timing. Restrained palette follows an editor working beside footage under controlled ambient light.

STORY: Confirm sequence, transcribe in Premiere, choose and edit a caption, style upcoming/current/spoken words, then apply to the main Program Monitor. Native-only actions remain clearly unavailable in the synthetic browser fixture.

FIRST VIEWPORT: Compact title and sequence header, native transcription action, three tabs, scrollable caption list and selected-caption text edit. Persistent lower apply area. At wide widths the transcript list sits alongside its editor; the docked version stacks them. Signature interaction: choosing a cue anchors its editor and preserves selection across tabs, with direct access to all three word states.

FORM: Premiere-native canon explicitly requested by the user. The seven considered sources were subtitle proofs, film-festival catalogues, type specimens, continuity scripts, exhibition signage, contact sheets and sound cue sheets. Catalog challengers (console, cassette, grid specimen, lexicon, atlas, emission rail) do not override that pinned choice. No raster comp; this session builds code-first, no standing default recorded.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
