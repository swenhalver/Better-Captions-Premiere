# S-Captions 0.7.63

- Split uses the focused line editor’s text cursor, snapping to the nearest word boundary. Clicking the scissors preserves editor focus.
- Pending text edits and the split are saved together; otherwise the selected word remains the split point. Existing word timing and linked-clip protections are preserved.

- Added keyboard-only panel edit history for transcript edits, split/merge, grouping, styling, presets and animation. Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z and Ctrl+Y redo. Text inputs retain normal typing undo.
- Matching native readbacks move through existing history without discarding redo. Native clip links and geometry remain authoritative.
