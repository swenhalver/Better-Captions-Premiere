# S-Captions 0.7.64

Includes everything from 0.7.63, which was not installed separately.

- **Undo and Redo shortcuts.** Cmd+Z undoes and Shift+Cmd+Z or Ctrl+Y redoes, covering transcript edits, splits, merges, grouping, styling, presets and animation. There are no buttons. Text fields keep their normal typing undo. When Premiere changes the layer, the panel's history follows it without losing Redo.
- **Split at the text cursor.** While the line editor has focus, the scissors split at the cursor, snapping to the nearest word boundary.
- **Current line position.** A new scrolling-caption setting chooses which visible line holds the line being spoken, counted from where new lines appear. 1 keeps the previous behavior. With 3 visible lines, 2 is the center line, and upcoming lines show ahead of it. Pair it with the top and bottom fades to fade spoken and upcoming lines. Horizontal scrolling ignores it.

This build includes a rebuilt native effect.
