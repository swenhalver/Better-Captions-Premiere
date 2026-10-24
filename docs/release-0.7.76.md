# S-Captions 0.7.76

- Typing undo: pressing Cmd in the line editor now puts the pending typing into Premiere's history first, as its own "S-Captions: Typing" step committed directly from the plugin (no host round trip), and writes the text right after. A Cmd+Z right after typing undoes exactly that burst and Shift+Cmd+Z brings it back. Pauses in typing use the same fast step.
- The typed text is remembered for the step before the step is committed, so an Undo that lands between the step and its text write leaves the previous text in place, and Redo restores the typed text. Such a step still merges into "Edit text" when the editor closes if it was redone.
- Opening the line editor prepares the layer for fast steps (gives its current text a remembered undo token). If the fast step can't be used (Premiere moved the layer, or another edit is running), typing falls back to the previous save path, and the unsaved-tail fallback still applies.
- Caption reads and undo restores now report Premiere's undo position so typing steps stay mergeable after following Undo/Redo.
