# S-Captions 0.7.88

Style the visible line positions from the Styling toolbar. Line 1 is the top slot; positions override Past, Current and Next only for properties they set. Unset controls show inheritance, and the overrides strip or a number reset returns a property to inherit. Hidden positions retain their settings.

Line fonts, colors, opacity, word backgrounds, outline, shadow, padding, corners and margins follow their slots. Non-uniform line spacing and numeric/color style values blend through scrolling and shared-line Fade, Slide and Pop transitions. Pause rows occupy slots. In paged and horizontal scrolling modes, positions are rows within the page. Case, line height, word spacing and alignment stay global.

Position edits use Premiere Undo/Redo. Style presets include positions; older presets clear them. Smart line fit measures the active positions with their resolved word-state appearances, and the selected Line scope stays open through same-clip refreshes. Relative bold endpoints resolve to supported font weights before blending.

BCAP v12 appends a position-style block after the v11 wrap-mode field. Documents without position overrides keep writing v11. Fill/Balance/Pretty grouping, merge-reset reflow and their single-step Undo/Redo are preserved.
