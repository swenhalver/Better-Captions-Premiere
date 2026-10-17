# Premiere-native interface review

Better Captions 0.5.0 implements the approved **Transcript / Styling** combination in the production Svelte UXP panel. Native transcription stays in the header; apply/update stays in the lower action area. A sentence selection opens its word timeline in the same workspace. The list and word editor stack in a narrow dock and sit alongside each other at expanded widths. Word boundaries snap to frames and cannot cross neighbours. Keyboard tab navigation, grouping, text correction, split/merge and transcript Undo remain available.

Styling keeps Past words, Current word and Next words independent. Each has typography, color/opacity, case, tracking, stroke, shadow and bubble settings. The labeled type sample lets the editor select a word; the Program Monitor remains the sole video display. Position & size exposes the selected native caption’s X/Y, independent width/height, stopwatches, key navigation, interpolation and Undo. It starts collapsed so typography remains easy to reach.

The [online interactive review](https://better-captions-premiere-review.swenhalver.chatgpt.site) is private to the owner’s ChatGPT account. Its toolbar switches between 280, 360, 480 pixels and expanded width. It runs the compiled production interface with synthetic captions, browser-local styling and sample keyframes. Transcription, timeline application and native Motion require Premiere. The original combined mockup and concept history remain at `/concepts/`.

## Verification, 2026-10-17

- Local Windows suite: **215 tests pass**, no skips. Includes native-action fixtures, stale/changed clip protection, transaction refusal/readback, source-time keyframes, independent dimensions, Undo, real FFmpeg alpha encoding, non-overlap word timing and per-state rendering.
- `npm run check`: 0 errors, 0 warnings. Both production bundles and the CCX/universal ZIP package build.
- [GitHub build run](https://github.com/swenhalver/Better-Captions-Premiere/actions/runs/39009788040): test, Svelte check, build and package **passed on macOS and Windows**. CI does not launch Premiere.
- Browser: word end clamped at 0.833333s before the next word at 0.84s; two width keys at frames 0 and 24 interpolate; Next font size 50 remains independent from Current 73.6; browser console has no errors.
- One bounded visual inspection covered expanded 1280×900, remote 390×844, 280px panel controls and the observed 1280×720 browser. No document or control overflow. Captures are retained locally in `.impeccable/review/`.
- Design detector returned `[]`. Fresh independent Impeccable reviewer returned **ship**, with no material fixes, scoped to the supplied UI evidence. Production rules are recorded in DESIGN.md and its sidecar.

## Native runtime boundary

The user approved installing 0.4.0 on Windows. Creative Cloud reported `-1`, and a clean UPIA retry reported `-903`; Adobe’s log included `launchElevateServer failed` and database refresh failure `-151`. No manual store-copy bypass was attempted. These installation failures are distinct from the plugin’s passing build/tests.

Actual **0.5.0 Premiere installation and keyframe interaction on macOS remain unverified**. Earlier native evidence in `tests/verification-result.json` belongs to an earlier build. See [0.5.0 release and installation notes](release-0.5.0.md) for requirements and known host boundaries. The GitHub release is a prerelease until fresh host acceptance.

## Integration boundaries

The user’s functional-build request authorizes the production renderer/bridge changes. New appearance fields are optional and inherit prior defaults for old sessions. New native text-area operations are allowlisted, serialized, identity-checked, bounded and read back after one undoable Premiere transaction. One UXP panel and one invisible CEP service remain; CSP, private file transport, worker ownership, timeouts and watcher visibility protections remain in place. Existing roll-up/fade logic and the ExportButton apply algorithm are preserved; coordinate these overlapping files when merging other work.

For future remote updates, reuse Site project `appgprj_6ad2dbaa92d881919fd7f5eca5e9e47f` and the separate ignored `work/remote-preview` checkout. Keep owner-private access and credentials in memory only. The Site publication does not merge the plugin repository’s main branch.
