# Better Captions 0.7.9 — Mac development verification

Verified 2026-10-18 on Apple Silicon with Adobe Premiere Pro 26.5.2. This is a
development build on `swen/native-caption-effect`, not a production native-effect
release. Existing movie captions and experimental native adjustment layers remain
separate output types; reconnection does not convert, insert or replace clips.

## Installed payload

- Adobe UPIA reported successful installation of the packaged UXP panel 0.7.9.
  The invisible CEP service was updated with its owned reversible installer.
- All 23 shipped UXP/CEP payload files were compared with the installed copies
  after the final service update: 23 exact matches, no differences.
- The official-SDK arm64 effect was installed with the per-user helper, which
  verified the bundle signature, file equality and hashes and retained a backup.
  Executable SHA-256:
  `688697ac134ff530f9e02121f4843a53b33346b50c7cba40615631a9c910ec03`.
- An installed-only failure was caught before acceptance: `native` had been used
  as a variable in ExtendScript, where it is reserved. The variable was renamed,
  the complete host script now has a strict ES3 parse regression, and the corrected
  service was repackaged/reinstalled before the following successful checks.

## Actual Premiere checks

Tests used the existing saved scratch project `Native Effect Scratch.prproj`.
The original production project remained closed. Its SHA-256 was unchanged before
and after testing. Scratch-only appearance changes were restored before saving.

| Check | Observed result |
| --- | --- |
| Native reconnection | Selecting an existing native caption adjustment layer restored its embedded sentence, word timings and styles automatically, without Refresh. Agent state identified the exact selected layer, reported native-effect mode and zero reconnect failures. |
| Native live style update | Agent `patch_style` changed the current-word RGB to `#D946EF`; the Program Monitor showed the current word in magenta on the same layer. The original `#ffd900` was restored. Both settled with no queued, blocked or running output. |
| Native Effect Controls | Current word, Previously spoken words and Upcoming words appeared below the existing Position/Width/Height controls on an older saved layer. Neutral overrides retained its appearance. |
| Native size override | Current word → Size changed from 100% to 150%. Premiere's field read back 150.0 and the Program Monitor visibly enlarged the current word and bubble. It was restored to 100.0. |
| Legacy reconnection | Switching to the saved Better Captions Fresh Speech sequence restored its saved caption, style and exact linked media automatically. No Refresh or manual apply was used to reconnect. |
| Compact styling | The actual installed panel displayed the All words/Past/Current/Next toolbar, numeric weight selector, B/I/color controls, case selector and collapsed advanced settings. Movie-caption Position/Width/Height used compact stopwatch/value/reset rows. |
| Relative B | In the installed movie-caption panel, choosing Current and toggling B retained the All words baseline of 700 and stored a current-word +100 offset. Automatic output began without an Update Program Monitor click. |
| Display placement | Premiere's complete window stayed within the other monitor after each test and sequence/menu operation; no corrective move was needed during these acceptance checks. |

The scratch sequence already contains several old movie-caption comparison clips;
they were retained. These checks do not claim that opening it cleaned up historical
test duplicates or migrated those clips.

## Source and build checks

- Full JavaScript suite: 706 tests, 704 passed, 2 Windows-only skips, 0 failures.
- Svelte/TypeScript: 0 errors and 0 warnings. Production webview/service build and
  CCX/Windows-macOS packaging passed.
- Official-SDK compiled adapter smoke, native appearance/downsample tests,
  arbitrary-data lifecycle and source-time regressions passed. Native style and
  arbitrary-data tests also passed with ASAN/UBSAN.
- Controller regressions cover project-path isolation with identical sequence
  GUIDs, stale discovery responses, exact legacy link recovery without rendering,
  native adoption without an unsolicited write, one supported guarded update,
  bounded document polling and preservation of other projects' cached styles.

Local acceptance receipts/screenshots are retained under the temporary
`better-captions-verification/mac-079-1792358008` directory. CI results are linked
from the branch's draft pull request; portable Windows CI does not establish an
installed Windows Premiere result.

## Limits

Native layers use Effect Controls for geometry, grouping and keyframes; this panel
does not yet edit those native streams. Native font weight/relative B, italic,
tracking, percentage word spacing and some other movie-renderer features are
disabled/refused because the current native document cannot represent them.
New-control keyframe/reset/Undo/Redo acceptance is still pending. Native Title
Case is ASCII-only. Direct Program Monitor handle dragging and adjustment-layer
Razor/source-time behavior remain unresolved as detailed in the
[native acceptance record](native-effect-acceptance.md). Fresh caption creation
continues through the existing movie workflow.
