# S-Captions 0.7.69

Test build.

- **Undo while typing in a sentence.** While the sentence editor is open on a native caption layer, each pause in typing (0.75 s) becomes one Premiere history step, "S-Captions: Typing". Pressing Cmd commits any typing not yet saved, so Cmd+Z right after typing undoes that latest burst. Cmd+Z and Shift+Cmd+Z then step through the typing while the editor stays open, and the editor's text and caret follow.
- If Premiere's Undo lands before the latest typing was saved, Undo removes just that unsaved typing, like a text editor; that typing cannot be redone.
- **One step per edit.** Leaving the editor (click elsewhere, Cmd+Enter, scissors) steps Premiere back over its typing steps and commits the final text once, as "S-Captions: Edit text". One Cmd+Z afterwards undoes the whole edit. If the text ends as it began, no step is left. Escape takes back all the typing.
- The typing steps are only merged when Premiere's history still ends with exactly those steps; otherwise they stay as they are and nothing typed is lost.
- Test hooks for agents: `scripts/agent.cjs test_typing` and `test_history`.
