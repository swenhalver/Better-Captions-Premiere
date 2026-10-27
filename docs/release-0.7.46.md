# Better Captions 0.7.46

- Authored padding contributes to line height whether word backgrounds are on or off. Toggling the background alone does not move text or change line spacing.
- Asymmetric top/bottom padding is included in layout bounds so backgrounds fit instead of being clipped against glyph-only bounds.
- Caption groups remain on one line; regrouping owns line boundaries.
- Speech gaps longer than 0.6 seconds reserve one timed blank row.
- Style popups and font pickers follow their parent controls through nested scrolling and resizing.
