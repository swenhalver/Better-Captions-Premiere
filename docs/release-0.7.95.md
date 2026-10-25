# 0.7.95 — Independent edges no longer chop rounded bubbles

With Boundary mode set to Independent edges, an edge whose inset is 0% now follows the caption's complete paint, the same way the default directional edge does. A word bubble with negative margins (for example the -5 px left margin) used to lose its left rounded corners where it crossed the box edge. Now it draws whole. Edges with a positive inset still crop exactly where they are set, and fade widths keep their length.

The native caption effect changed and was rebuilt.
