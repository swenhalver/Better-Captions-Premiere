# Better Captions 0.7.42 installed Mac verification

Verified in the installed Premiere Pro native effect on 2026-10-19.

## Native reset arrows

Clicked the actual Reset Parameter arrows on the stock **Width, px** and **Height, px** controls, then checked both the visible controls and the original saved Width/Height properties through Premiere's scripting API.

| Containing sequence | Width after Reset | Height after Reset |
| --- | ---: | ---: |
| 720 x 1280 | 648 | 1152 |
| 1080 x 1080 | 972 | 972 |
| 1920 x 1080 | 1728 | 972 |
| 3840 x 2160 | 3456 | 1944 |

All test copies retained a 720 x 1280 source carrier. Native diagnostics confirmed the containing-sequence lookup succeeded for every reset. This exercises the distinction between source dimensions and sequence dimensions.

Premiere provides zero dimensions during effect registration and retains old stream range/default metadata in existing clips. The implementation therefore keeps original disk IDs 2/3 for saved data and animation, and exposes fresh supervised UI-only dimension controls with IDs 309/310. Reset resolves an Auto sentinel using Adobe's containing-timeline and Sequence Info suites. Show animation controls reveals the original streams.

The installed-host bridge also passed Width 648 -> 649 -> 648 and Height 210 -> 211 -> 210 edits with exact saved-value and UI-display readback. Premiere reports keyframe capability on these UI-only parameters despite the native Cannot Time Vary flag, so validation checks actual animation and keys rather than rejecting that capability flag alone.

## Typography and scrolling

The renderer no longer scales fonts or decorative geometry to fit a requested scrolling-line count. Real Premiere PNG exports of the first scrolling row with Visible lines set to 1 and 8 were byte-identical as decoded pixels. A taller caption box at a later timestamp produced one text band for Visible lines = 1 and three text bands for Visible lines = 3.

Visible lines is a maximum within the available physical height. More rows require enough height at the authored font size.

## Independent boundaries

Inspected the native Boundaries group, named boundary-mode choices, four edge groups and the Top group's independent inset, fade toggle, width, amount and easing controls. Real rendered exports confirmed:

- Top inset 50% removed the upper rows.
- Bottom inset 50% removed the lower row.
- Left inset 50% clipped all caption pixels left of x=360 in a 720-pixel-wide frame.
- Right inset 50% clipped all caption pixels at or right of x=360.
- Enabling only the Left fade changed pixels in its own fade region.

Core and CoreText pixel tests additionally cover all four independent fades, easing curves, legacy equivalence and empty intersections.

## Preservation and artifacts

Removed the three temporary sequence copies after testing. The six original normalized sequence graphs matched the pre-test snapshot exactly after ignoring the two new UI-only dimension properties. Clip identities, timing, media references, original saved dimensions, styles and keyframes were preserved.

Local screenshots, rendered PNGs and a reset-proof contact sheet are in `artifacts/verification-0.7.42/`. Generated verification artifacts are excluded from Git and the distributable archive.

The native binary was built against the local official Adobe SDK, passed its compiled adapter smoke checks and sanitizer-backed helper tests, and matched the installed binary by SHA-256. The experimental native bundle remains separate from the UXP/CEP package.

Final JavaScript tests: 1,025 total, 1,023 passed, 2 skipped, zero failures. Svelte diagnostics: zero errors and warnings.

The temporary layout guide uses a short rendered lease and background cleanup. Wait until the cyan guide clears before starting an export; render callbacks do not provide a verified monitor/export discriminator.
