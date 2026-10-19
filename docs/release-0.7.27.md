# Better Captions 0.7.27 — word-background icon preview

The word-background control uses the supplied Type Off icon on its plain neutral
background when word background is disabled. An enabled background uses Lucide
Type over its exact stored color and opacity, with a checkerboard underneath to
show partial transparency. An active visible outline switches the letter to
Type Outline with the selected text fill and outline stroke.

The separate outline button has no fill and uses the standard icon stroke when
the outline is off, has zero width/opacity, or has mixed colors. An active
outline previews the chosen text fill and outline color.

The Mac ribbon mockup keeps one color popup open at a time. Opening the font,
case or weight picker dismisses an open color popup, and outside clicks close it.

This changes the panel and design preview only. Caption values, document formats
and the installed 0.7.24 native renderer are unchanged.
