# 0.7.103: Delete line

**Any line can be deleted, not just a Pause.** Select a line in the Words list and press the trash button in the toolbar: Delete line removes that line and its words. It works on text lines and on blank lines you added, wherever their words are stored. Deleting a Pause works as before. The next line is selected in its place, or the line before when it was the last one.

Delete line is a real delete. Clearing a line's text still leaves a timed blank line; Delete line takes the line away. Each delete is one Undo step in Premiere. Open editors and pending edits are written as their own Undo steps first; if Premiere does not confirm them, nothing is deleted. Typing in another line right afterwards waits until Premiere has confirmed the delete.

Nothing is retimed and nothing ripples: the time the line took becomes silence. Every other line keeps its text, times, styles and line breaks, and the clip's start, position and size do not change. Between two remaining text lines, the next line starts with a manual break, so the line before it never regroups into it.

**Pauses.** The gaps before and after the deleted line become one gap. That gap shows as many pause rows as the two gaps showed together, so the deleted line never comes back as extra pause rows, and pauses you deleted earlier stay deleted. Limits: the merged gap is still one gap under the Visible lines cap, so if the two gaps together showed more rows than the cap, it shows the cap. Changing Pause Line Length or Visible lines later recounts the merged gap from the same hidden rows: a longer pause length or lower cap shows fewer rows, never resurrected ones.

**The last line.** Deleting the only line leaves an empty caption layer, still connected. The panel shows "No lines left", the native effect draws nothing, and Undo in Premiere brings the line back.

**Tests.** New tests cover the delete itself, breaks and pause counts, the empty layer, and the Undo-step barrier (including a typing edit Premiere had not yet confirmed, which stops the delete). `npm test` and `npm run check` pass. The native effect is unchanged from 0.7.102. Delete line still needs to be checked inside Premiere.
