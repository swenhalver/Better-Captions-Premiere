# S-Captions 0.7.72

Test build, includes 0.7.69 to 0.7.71.

- Typing again after Cmd+Z in the sentence editor now still merges into one step when the editor closes. Premiere numbers each new action after every earlier one, also after an undo; 0.7.69 to 0.7.71 expected consecutive numbers.
- If Premiere Undo or Redo lands while a typing step is being saved, the step is not written at all and the editor follows Premiere (before, a step could bury the Undo).
- The panel's state for agents lists recent typing events (Cmd flushes, written and confirmed steps with Premiere's undo position, followed Undo/Redo).
