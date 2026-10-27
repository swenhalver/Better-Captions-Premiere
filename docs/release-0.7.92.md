# 0.7.92 — Blank lines keep their own row when filled again

Typing a word or two into a blank line no longer pulls in the line after it. In 0.7.91 a blank that only Characters per line kept apart from its neighbours could merge with them once it held short text again. Then the next edit could overwrite the neighbouring line's words.

Blanking a line, or typing into a blank, now puts a manual line break before that line and before the next one, the same way text typed into a pause row already worked. The line keeps exactly its original time, before and after, through leaving the editor, refreshing, Undo and Redo, and reopening the project. The next line's words, times and styles are unchanged; it only gains that break. Changing Characters per line or Smart line fit keeps both breaks.

A line that starts with a manual break keeps that break when you retype its first word. New words typed into a one-word line still wrap like normal text instead of sticking together as one unbreakable unit.

The native caption effect is unchanged.
