# 0.7.82 — Editable pause lines in the transcript

Pause rows are numbered lines in the transcript, with their start/end time, a muted Pause label and a delete control. Selecting a row seeks to its start. Deleting removes one pause line from both the list and native rendering using Premiere’s existing edit-token Undo/Redo.

Every full Pause Line Length interval contributes one blank line, capped at Visible lines, then reduced by the saved deletion count. Auto uses the complete stream’s average spoken-line duration. Remaining silence holds the last state. Blank lines otherwise retain ordinary line height, slots, current-line behavior and transitions, with upcoming text visible beyond them.

BCAP v9 adds a per-word pause deletion count at the word following the gap. Existing documents load with zero deletions and preserve words, times, styles and manual splits. Split/join markers from v8 remain intact. Deletions survive regrouping, line edits and pause-length changes; if fewer automatic blanks remain than the deletion count, the gap shows none.

Includes the Caption grouping move, exact Pause Line Length and Characters per line names with stable native disk IDs, and continuous scrolling/paging across storage from 0.7.80. Restores the supplied tooltip wording “up to Visible lines,” superseding 0.7.81’s uncapped interpretation.
