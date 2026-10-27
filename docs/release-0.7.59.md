# S-Captions 0.7.59

The native Smart line fit effect parameter is removed. Smart line fit is now only a panel button: press it and the panel measures the caption's Width and font, then sets Characters per caption to the number of characters that fit one line. The number stays until you change it again. The renderer groups captions only by Characters per caption.

Undo and Redo follow Premiere. Every panel change to a native caption layer (transcript text, timing, grouping, styles, animation, the character limit, position and size) is a Premiere history step. Edit › Undo and Redo revert and restore them, and the panel shows "Updated from Premiere" when it picks the change up. The panel's own single-step "Undo edit" button is gone.
