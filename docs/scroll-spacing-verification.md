# Scrolling spacing correction — 2026-10-20

Scrolling and static captions now use the same active-style row composer. Glyph advances, padding, margins, wrapping, bubble joins and authored row spacing are composed once. Scrolling translates those rows using the existing animation timing and history window. The previous worst-state sizing remains limited to the existing capacity/viewport policy.

The user withdrew the separate multiple-line report. No line-count settings, caption dimensions, saved styles, timing or source transcript were changed.

## Verification

- Core regression matrix: 486 geometry cases across unequal word-state styles, padding and margins, wrapping, Smart fitting, alignment, word spacing and line height. Down retains its reverse history ordering with correct unequal-row advances.
- All three sanitizer-backed CMake tests passed: core, CoreText rasterizer and the new scrolling-spacing rasterizer test.
- CoreText parity covers 27 style/spacing combinations, comparing the visible viewport after the intended block translation. The existing viewport clip remains independent.
- Scrolling-off pixel output was byte-identical before and after across the same 27 fixtures. The raw RGBA baseline and final SHA-256 were both `6e1e69d8e4443010cf0da207f90594419803d65b6226a7029d5c623ee857ffb4`.
- Installed the rebuilt native bundle, restarted Premiere, and exported scrolling-off/on frames from a disposable copy of the user's sequence.
- The visible glyph-column spans in the common text row matched exactly after the correction. For example, the first three glyph spans remained x=36–68, 71–75 and 82–86 in both modes; the old scrolling render moved them to 51–84, 87–91 and 98–102.
- The static Premiere export was also pixel-identical before and after the plugin update. Scrolling's fade and viewport can independently change alpha or clip pixels; those presentation effects are not spacing changes.
- Removed the temporary test sequence, restored the original active sequence/playhead, and saved. All six original complete sequence graphs matched the current pre-test snapshot exactly.

Native SDK build and adapter/helper checks passed. Native-only correction; no unrelated UXP/CEP installation or release version changes were required.

Local comparison images are in `artifacts/verification-scroll-spacing/` and are excluded from Git.
