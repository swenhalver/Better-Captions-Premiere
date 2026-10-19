# Better Captions 0.7.18 — Premiere-style numeric controls

Position, Width and Height appear in the plugin’s Styling tab, connected to the
same native effect parameters shown in Effect Controls. Blue numeric values
support horizontal dragging or click-to-type editing. Width and Height are
independent. Per-row reset arrows restore native defaults; stopwatches indicate
whether keyframing is enabled in Effect Controls. Previous/next buttons navigate native keyframes when animation is enabled.
No duplicate keyframe timeline is shown in the plugin. Fields show the evaluated
value at Premiere’s current timeline playhead, including interpolated values. On animated properties, edits/reset affect the value at
the current playhead and preserve other keys and their interpolation.

Font size, opacity, spacing, outline, shadow, bubble and background numeric fields
use the same drag/click-to-type interaction. Shift increases and Alt decreases
drag precision. Arrow keys adjust the value; Enter commits typing; Escape cancels.
The editor keeps the existing compact styling controls and user panel layout.

This includes the 0.7.17 native effect repair: outlines render below an unchanged
clean fill; Uppercase and Lowercase are enabled as shared display-only modes.
Source words and times are preserved. The separately installed updated native
binary is required for upper/lower version-4 documents. Older documents retain
their original compatible format until a new display mode is selected.

See [native geometry contract](native-caption-controls.md),
[outline/case details](release-0.7.17.md) and
[Mac verification](mac-verification-0.7.18.md).
