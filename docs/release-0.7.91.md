# 0.7.91 — Empty lines and typing into pauses

You can now delete every word of a line. The line stays where it was as a blank line, keeps its time, and shows as "Blank line" in the transcript. In Premiere it is an empty row, like a pause row, with no text, background or shadow. Click it to type text back in: the new words go into the same time.

Pause rows take text too. Click the "Pause" label of a pause row and type. The words become their own line in that pause slot's time, and the other pause rows stay around it. Escape, or leaving the editor without typing, changes nothing. While the editor is open, typing steps follow Premiere Undo and Redo as before, and closing the editor merges them into one Edit text step.

The native caption effect was rebuilt. The document format is unchanged; a word may now have empty text. Derived pause row times now match the panel's exactly.
