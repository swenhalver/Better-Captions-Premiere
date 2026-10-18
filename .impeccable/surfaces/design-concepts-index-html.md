---
version: 1
slug: "design-concepts-index-html"
primary_target: "design-concepts/index.html"
related_targets: ["design-concepts/editor.css","design-concepts/editor.js","design-concepts/timing.mjs","design-concepts/geometry.mjs"]
---

# Interface concepts — review surface

Scope: Three interactive alternatives, not a replacement of the installed panel. Operate mode inside the established Premiere-native visual world. User explicitly requested three ground-up designs and previously requested online review. Existing code-first choice carries forward; all three remain proposals until the user chooses.

Grounded structural candidates, ordered: (1) current task tabs, (2) guided transcribe/review/style/apply steps, (3) caption list plus properties inspector, (4) sequence-wide caption table, (5) inline transcript desk, (6) word timing desk, (7) appearance inspector with a compact caption selector. Surface seed 5a76b6b5 dealt 5, 6, 7. Present these three equally. The user's Premiere-native direction pins palette and familiar controls. No decorative catalog grammar or fake Program Monitor.

## Direction contract

THESIS: Make the fork's editing capabilities discoverable through three different work arrangements. The main unit is a caption containing timed words; appearance, timing and native geometry remain distinct concepts.

OWN-WORLD: Host charcoal, system sans, restrained blue selection, squared controls, tabular timecodes, one-pixel separators. Yellow belongs only to the sample active-word appearance. Browser review furniture sits outside plugin chrome.

STORY: Compare three functional panels, click a word, adjust its timing, change word appearance and leave notes. Read a verified base-versus-fork audit. Browser demo data never suggests a native Premiere connection.

FIRST VIEWPORT: Three approximately 360px panels across desktop, each with a short rationale above and a tradeoff below. Transcript desk leads with continuous phrase rows and a pinned contextual word inspector. Timing desk leads with a selected phrase and per-word timing bars, playhead and frame adjustments. Style inspector leads with state swatches and editable typography/bubble controls, with the selected caption and timing disclosure below. Compare becomes a single selectable panel on mobile. Native apply remains a visible disabled footer action.

FORM: Candidates 5, 6, 7; seed 5a76b6b5. Code-led comparison artifact at design-concepts/index.html; no production panel or renderer changes.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

No new visual identity is approved: preserve production DESIGN.md and its sidecar; document this surface independently. No shipping raster assets are needed.

## Selected combination — 2026-10-17

The user explicitly chose a two-tab combination: versions 1 + 2 form an editing tab, where selecting a sentence shows its word timeline and overlap is impossible; version 3 becomes Styling with independent past/current/next looks and full effects including stroke. This precise selection supersedes the open three-way comparison above. Keep its seed as decision history; no new concept roll or confirmation is needed. Code-led online review remains the authorized deliverable.

THESIS: Read the transcript, select a sentence, and retime words without overlap in one tab; style each spoken state in the other.

OWN-WORLD: Preserve the pinned Premiere-native charcoal, platform type, rectangular controls and restrained blue selection. Caption color and font are editable content, not UI identity.

STORY: Select a sentence, see a single horizontal lane of sequential word blocks, select a word, adjust shared boundaries with drag/keyboard/frame controls, then switch to Styling without losing selection. Past, Current and Next have independent typography, stroke, shadow and bubble settings. A modest selected-caption type sample makes each effect visible. Keep animation and caption layout in disclosures within Styling; exactly two plugin tabs.

FIRST VIEWPORT: One real 360px plugin mockup on a quiet review page. Transcript list and selected-sentence timeline are simultaneously visible; timing inspector sits with that timeline. Sentence changes replace the timeline. One-lane blocks never overlap: connected boundaries move together, minimum one frame per word; gaps remain protected. At 280px the timeline scrolls horizontally inside its frame while readable word labels and timing controls remain usable. Styling reveals one state at a time and keeps selection context. Caption samples are labeled as type samples, never a fake Program Monitor.

FORM: User-selected combination of seed 5a76b6b5 candidates 5/6/7. Replace this route with the combined browser mockup; preserve original concepts at explorations/. Installed Svelte/native implementation stays unchanged. Browser native actions are disabled and sample data is explicitly labeled. New per-state effects are interface proposals, not claims about existing renderer support.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## User extension — text-area keyframes

The user additionally requested keyframe controls for placing and sizing the text area on video. Preserve the approved two-tab world. Add a discoverable Position & size disclosure in Styling, scoped to the selected caption across all word states. It exposes X/Y center position, independent width/height, stopwatches, previous/add/remove/next keyframes, exact frame navigation, scrubbing, and per-keyframe Linear/Ease/Hold interpolation. Width reflows at fixed font size; the native Program Monitor remains the sole video display. The online mockup evaluates sample geometry values; native Motion controls already exist, but these proposed panel controls still need bridge integration. Preserve geometry through tab changes, undo, and sentence regroup/split/merge.
