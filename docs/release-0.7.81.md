# 0.7.81 — Continuous pause-line help

Finishes 0.7.80 by removing the obsolete “up to Visible lines” cap from Pause Line Length help. Every full interval of silence contributes an ordinary blank line to the continuous stream, including intervals beyond the visible window. The native implementation from 0.7.80 already follows this rule; this update aligns the panel tooltip and README with it.

Includes 0.7.80’s Caption grouping move, Pause Line Length and Characters per line native/panel names with stable disk IDs, continuous scrolling/paging across storage, and BCAP v8 explicit break/join markers. See [0.7.80](release-0.7.80.md) for the complete behavior change. Existing saved values and documents remain intact.
