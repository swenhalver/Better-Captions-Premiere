# S-Captions 0.7.74

Includes 0.7.69 to 0.7.73, which were test builds.

- **Undo while typing a sentence.** On a native caption layer, each pause in typing (0.75 s) in the sentence editor is one Premiere history step, "S-Captions: Typing". Cmd+Z and Shift+Cmd+Z step through those pause points while the editor stays open; its text and caret follow within about a second. Typing again after an Undo continues from there.
- Typing not yet saved as a step when Undo arrives is dropped, like the latest burst in a text editor, and cannot be redone. Pressing Cmd also starts saving it, but a save takes about 0.4 to 0.6 s, so a quick Cmd+Z right after typing normally arrives first and takes this path.
- **One step per edit.** Leaving the editor (clicking elsewhere, Cmd+Enter, the scissors) steps Premiere back over its typing steps and commits the final text once as "S-Captions: Edit text". One Cmd+Z afterwards undoes the whole edit. If the text ends as it began, no step is left. Escape takes all the typing back.
- Typing steps are only merged when Premiere's history still ends with exactly those steps (checked by Premiere's undo position and the layer's edit token). Otherwise they stay as they are; nothing typed is lost.
- After Premiere Undo, making the same change again is now written to Premiere (before, the panel skipped a state it had written once already). This also fixes re-applying a style after undoing it.
- The panel keeps following Premiere Undo/Redo while the caption search box has focus.
- Test hooks for agents: `scripts/agent.cjs test_typing` (drives the sentence editor) and `test_history` (one Premiere Undo or Redo); the panel's state lists recent typing events.
