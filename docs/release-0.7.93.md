# 0.7.93 — Boundary fades always run from 0% to 100%

An enabled boundary fade now always runs from fully transparent at the crop edge to the text's full opacity at the inner end of Fade width. The Fade amount setting is gone. It was removed from the S-Captions panel (directional and all-four-edge modes) and from Effect Controls.

Fade enabled, Fade width/Transition thickness, Inset, Boundary position and Fade curve work as before. The old Fade amount streams are still saved in the effect so parameter order and every other saved setting stay the same, but they are hidden and their values are ignored. Clips that had Fade amount set to 0% or 50% now show the full gradient.

The native caption effect changed and was rebuilt.
