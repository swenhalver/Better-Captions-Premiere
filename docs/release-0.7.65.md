# S-Captions 0.7.65

- **Undo and Redo now use Premiere's own history.** Every panel change to a native caption layer (transcript text, word timing, splits and merges, Characters per caption, Smart line fit, styles, presets, animation, and the panel's Position, Width, Height, alignment and scrolling controls) is one named step in Premiere's Edit › Undo, such as "Undo S-Captions: Split caption". Cmd+Z and Shift+Cmd+Z, or Edit › Undo and Redo, revert and restore them, and the panel follows. The panel's separate keyboard history from 0.7.64 is removed, because it never received Premiere's shortcuts.
- **Current line position:** the first line now glides in from the entry edge to its slot.

Test build: it also writes temporary undo diagnostics to the UXP log.

This build includes a rebuilt native effect.
