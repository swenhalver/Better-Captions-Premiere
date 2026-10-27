# 0.7.78 — Blank line length

Scrolling text now has a keyframable **Blank line length** control after Current line position. Set 0–30 seconds in tenths; 0 (Auto) preserves the average spoken-line cadence. Positive values insert only whole silence intervals, capped at Visible lines: 2 seconds inserts nothing for a 0.99-second pause and two blanks for a 4.5-second pause. Any remainder holds the last state. Phrase splitting keeps its separate 0.6-second threshold.

The panel shows Auto at zero, supports reset and previous/next keyframe navigation, and commits scalar edits through Premiere's existing UXP Undo/Redo transaction. The full explainer is available on both the label and numeric field. Older native binaries omit the control.
