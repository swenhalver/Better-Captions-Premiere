# 0.7.98: Add line

A blank line can now be added above or below the selected line, from the Add line above and Add line below buttons in the selected-words toolbar beside Split and Merge, or with Enter: at the start of a line's text Enter adds a line above, at the end it adds one below, and between words it splits the line there. Enter during IME composition or key repeat does nothing. In the new line's editor, Cmd+Enter saves and Escape cancels.

The new line uses free time at that boundary first, up to one pause row's length. Where the lines touch, it takes time from one neighbouring word: the end of the last word above, or else the start of the first word below, by at most half that word's duration and at most one cadence. The notice then says how many frames it took and from which word. Every other word keeps its text, times and line breaks; nothing ripples, and the project's geometry and styles are unchanged.

On a native layer, Add line is one Undo step of its own. Edits still waiting to be written settle first as their own steps. Text typed into the new line before Premiere confirms Add line is held, then written as a separate typing step. If Premiere cannot confirm the step, the editor saves the text as an ordinary edit.

The native effect is unchanged.
