# Three interface concepts

**Historical review.** This page records the original three-way exploration and its earlier publication. Those prototypes now live at `design-concepts/explorations/`. The user selected the combined Transcript + Styling design, which now occupies `design-concepts/index.html` and the live `/concepts/` route. See [Combined interface review](combined-interface.md) for current behavior, scoped design documentation and deployment evidence; source paths, conclusions and publication details below describe the original snapshot.

The user requested a review of additions to the base plugin and three ground-up interface designs. The browser prototypes live at `design-concepts/index.html` and are published at [the online comparison](https://better-captions-premiere-review.swenhalver.chatgpt.site/concepts/). They are isolated from the installed Svelte panel and native services.

## Feature review

Compared upstream `16c32128506a9c1a29a3577ea6d8e37339e9e6b9` with fork `2ffed3249371aa0e95437fb2e5e6b5f881b5e3e8`. A fresh fetch found no newer shared branch commits. Unmerged work from another checkout is outside this review.

| Area | Verified upstream behavior | Fork additions | Source evidence |
| --- | --- | --- | --- |
| Transcription | Exports an existing sequence transcript to JSON. | Direct native transcription of enabled audio sources, source reuse, timeline timestamp mapping. | Upstream `src/api/premierepro.ts`; current `uxp/api.js`, `uxp/transcript.js`, `uxp/transcript-core.js`. |
| Editing | Read-only cue browsing and maximum word count. | Text corrections, per-word start/end edits, overlap validation, split/merge, regroup and undo, linked-clip protections. | Both versions of `TranscriptPreview.svelte`; current `lib/transcript/edit.ts` and `parser.ts`. |
| Word appearance | Base text appearance plus highlight color. | Separate upcoming/base, active and spoken states with relative size, font, weight, color, opacity and bubbles. | Both versions of `lib/types.ts`; current `components/WordStates.svelte` and canvas engine. |
| Premiere output | Renders frames and imports an image sequence to the project; has a separate canvas preview. | Transparent ProRes phrase clips inserted on a selected track, linked updates, timeline timing readback, main Program Monitor preview. | Both versions of `ExportButton.svelte`; current `cep/host/bridge.jsx`, `cep/runtime.cjs`. |
| Geometry | Numeric position and wrapping controls. | Native position/independent size handles, constant-font reflow, Motion keyframes, selected-caption tracking. | `lib/program-monitor.ts`, export planner, renderer and native bridge. |
| Existing creative tools | Font, weight, stroke, shadow, background, Fade, Pop, Bounce, Typewriter and Karaoke already present. | Integration with word states and native clip updates. | Upstream and fork `lib/types.ts`, `AnimationPanel.svelte`, canvas engine. |
| Foundation | Original scaffold and bundled shell add-on. | One visible UXP panel, invisible bounded CEP service, private local agent hooks, Windows/macOS installation and tool resolution. | `uxp/`, `cep/`, `scripts/install.cjs`, `security/FORK-CHANGES.md`. |

Roll-up is absent from the reviewed animation schema. Native Windows installation and fresh Mac runtime checks remain separate pending work; the mockups make no claim to have completed them.

## Concepts

- **Transcript desk:** continuous caption context with clickable words and a persistent word inspector. Best default for correction-heavy editing; detailed timing is less visual.
- **Timing desk:** selected phrase plus time ranges for individual words, sample playhead and frame controls. Best for timing work; less sequence context is visible.
- **Style inspector:** upcoming/current/spoken state controls, live type samples and property disclosures, with caption editing beneath. Best for visual finishing; text correction requires more navigation.

Recommendation: Transcript desk as the main work area, Timing desk's word ranges inside the selected-word inspector, and Style inspector as the appearance workspace. All remain proposals until selected. The style samples are typography swatches, not a replacement Program Monitor.

Click-a-word selection inside the panel, frame nudges, and Set to playhead are proposed interface shortcuts. They do not imply direct word clicking inside Premiere's Program Monitor. The browser uses a fictional transcript with 24fps timing. Native Transcribe, track selection and Update actions are disabled. Timing and appearance edits affect only in-memory sample data. Notes alone persist in browser storage and can be downloaded; they do not synchronize between devices.

## Verification

The prototypes have no build dependency; `node --check design-concepts/app.js` passes. Browser checks covered word selection, frame increments, Set start to playhead, invalid overlap feedback, no-result search and clearing, text edits retaining existing timing when counts match, regroup and undo, and immediate relative-size updates. Browser console reported no errors. Desktop at 1280px and mobile at 390px, including a 280px panel, showed no page or panel horizontal overflow. Mobile feature comparisons become stacked records.

Screenshot evidence is under `.impeccable/review/concepts/`; those local QA artifacts are ignored. The production panel and renderer were not modified, so its test suite was not rerun for this isolated design artifact.

The final interaction corrections expose a maximum-word selector before regrouping, preserve keyboard focus through workspace-mode changes, and keep the Timing desk's selected row visible below one opaque sticky heading/ruler. The complete selected phrase is a fixed sibling above the timing scroll region. Frame nudges and Set to playhead remain proposed sample-only interactions.

## Documentation evidence

The scoped [design-system record](../design-concepts/DESIGN.md) and [component sidecar](../design-concepts/.impeccable/design.json) document this non-shipping browser surface. They preserve the root `DESIGN.md` and root `.impeccable/design.json` as production authority. The review's fixed palette, denser panel type scale, browser comparison shell and editable yellow caption samples are intentional local differences; none establishes an approved global visual change.

The documenter checked `index.html`, `styles.css`, `app.js`, `PRODUCT.md`, the root design record and sidecar, the surface brief, and the comparison, mobile transcript, mobile timing, mobile style and 280px style-detail captures. The refreshed `comparison.png`, `mobile-timing-panel.png`, `timing-space-selection.png` and `desktop-timing-space.png` were inspected after the final timing correction. The saved `timing-fix-evidence.json` reports the complete phrase outside the scroller, visible ruler and visible selected range for the initial and last words at both 1280px and 390px.

The sidecar includes nine self-contained component examples; unused color declarations were not promoted into the token set. JSON parsing, the eight canonical Markdown sections, the narrative mapping and eight-step color metadata ramps passed static validation. This pass changed documentation only and did not repair global design drift.

## Published review

Published the comparison to the existing owner-private Site on 2026-10-17. The exact Site source commit is `e772b6d45664506ab31f58e3e28748c7231574ab`; deployment `appgdep_6ad2fdf0158881919d24990773cc6570` succeeded. The live `/concepts/` page was opened and its frame-nudge/reset interaction verified, with no browser console errors. Existing root editor files and access settings were preserved.

The fresh finish reviewer resolved all three scored findings: timing visibility, predictable grouping and keyboard focus. Its final bounded verdict is `ship`; this does not claim an exhaustive audit of the surface. The live comparison screenshot is saved in the design task's `outputs/better-captions-three-concepts.png`.
