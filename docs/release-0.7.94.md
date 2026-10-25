# 0.7.94 — Current line counts from the top

Current line position now numbers the visible lines from the top, the same way as line position styles: Line 1 is the top line and, with 4 visible lines, Line 4 is the bottom. This holds for Up and Down scrolling. Before, Up scrolling counted from the bottom, so Current line 1 was the bottom line while Line 1 styling applied to the top.

Saved values keep their number, so an Up-scrolling clip set to 1 now holds the current line at the top. To keep it at the bottom where new lines appear, set Current line to the Visible lines count (for example 4). Horizontal scrolling still ignores the setting. The panel's explanation and the README say "counted from the top".

The native caption effect changed and was rebuilt.
