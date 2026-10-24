# S-Captions 0.7.68

Includes everything from 0.7.65 to 0.7.67, which were test builds.

- **Undo and Redo use Premiere's own history.** Every panel change to a native caption layer is one step in Premiere's history, named in the History panel (for example "S-Captions: Split caption" or "S-Captions: Style"). That covers transcript text, word timing, splits and merges, Characters per caption, Smart line fit, styles, presets, animation, and the panel's Position, Width, Height, alignment and scrolling controls. Cmd+Z and Shift+Cmd+Z work wherever focus is, including the S-Captions panel, as do Edit › Undo and Redo. The panel shows the result within about a second.
- 0.7.64's separate panel keyboard history is removed. Premiere handles Cmd+Z before the panel ever sees it, so it never ran.
- How it works: Premiere does not record script changes to the caption document, so each transcript or style edit also sets a small edit token on the hidden Layout editing guide control in the same undo step. Undo and Redo move the token back and forth, and the panel puts back the matching document. This also works while the S-Captions panel is a hidden tab, as long as it stays open. Remembered documents last for the Premiere session, like Premiere's own history.
- The panel now notices any change to a caption layer's document within one connection check, not only on its 30-second full read.
- Current line position: the first line now glides in from the entry edge to its slot (native effect, installed with 0.7.65).
