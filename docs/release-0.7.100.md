# 0.7.100: Unsaved no longer changes the line's height

While you edit a line's text, Unsaved now shows at the right end of that line's timestamp row instead of on its own row under the text. The spot is always there while the editor is open; only its text comes and goes. So Unsaved appearing after you type, or going away when the edit is saved, no longer changes how tall the line is. Before, that change in height could make the line list shift when the edited line was near the bottom of the list.

The text box now wraps long words the same way as the line text it replaces, so opening and closing the editor keeps the line's height too.

This build also adds read-only measurements of the line list's scroll position, the edited row and the text cursor to the panel's diagnostic state. Agents use them to measure scrolling inside Premiere. They change nothing on screen.

This fixes one cause of the list moving that was measured in a browser. It still has to be confirmed inside Premiere. Caption text, timing, history and styles are unchanged. The native effect is unchanged.
