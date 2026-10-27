# 0.7.99: The line list stays put while you edit

Editing a line no longer makes the line list jump. Before, the list scrolled again every time its rows were rebuilt: on each typing step, when the edit was saved, and when Premiere confirmed it or the panel refreshed. That scrolling also moved the panel around the list.

Now the list only scrolls when the selection moves to a different line, pause or caption: choosing a line, Add line, splitting, or a selection made in Premiere. It scrolls just far enough to show that line. Only the list scrolls, never the panel around it. While the same line stays selected, the list stays where you scrolled it. That holds even when an Undo or an edit to an earlier line shifts the rows below it.

Caption text, timing, history and styles are unchanged. The native effect is unchanged.
