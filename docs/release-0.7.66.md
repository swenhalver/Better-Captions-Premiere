# S-Captions 0.7.66

Includes everything from 0.7.65.

- **Undo and Redo now use Premiere's own history.** Every panel change to a native caption layer is one step in Premiere's history, named in the History panel (for example "S-Captions: Split caption"): transcript text, word timing, splits and merges, Characters per caption, Smart line fit, styles, presets, animation, and the panel's Position, Width, Height, alignment and scrolling controls. Cmd+Z and Shift+Cmd+Z work wherever focus is, including in the S-Captions panel, as do Edit › Undo and Redo. The panel follows within about a second and a half.
- 0.7.64's separate panel keyboard history is removed. Premiere handles Cmd+Z before the panel sees it, so that history never ran.
- How it works: Premiere does not record script changes to the caption document, so each document edit also sets a small edit token on the hidden Layout editing guide control. Undo and Redo move that token, and the panel puts back the matching document. Keep the S-Captions panel open while undoing transcript or style edits.

Test build: it writes temporary undo diagnostics to the UXP log.
