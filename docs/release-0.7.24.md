# Better Captions 0.7.24 — ribbon control order and joined backgrounds

Font size has Lucide decrease/increase buttons around the editable value, with
no visible px suffix. Line height follows the alignment controls. Primary
formatting icons use consistent proportions in the installed toolbar and the
Mac ribbon design preview.

Line height changes the actual vertical spacing of wrapped preview lines. Native
documents now accept the ribbon's minimum of 0.6; older values up to 10 remain
readable. The preview remeasures background joins after text wrapping, font
loading and resizing rather than retaining corners from an earlier layout.

When Color spaces between words is enabled, joined same-line backgrounds keep
rounded outer ends and square connecting edges. Text layout, timing and the
stored document format are unchanged.

Word backgrounds have separate left/right (inline) and top/bottom (block)
padding. Older documents keep their existing uniform padding until an axis is
explicitly changed. Axis overrides use BCAP v6 and require the matching native
effect and background service.

The emphasis segment includes a working Lucide Underline toggle beside Bold and
Italic. Underline is independent for past/current/upcoming words and renders in
both the native effect and canvas path. Its optional state is stored with the
v6 extension, preserving untouched v1–5 documents.

Interactive native control reads, edits and keyframe seeks use one checked host
evaluation instead of three after warm-up. The local ExtendScript JSON codec
copies ordinary string runs in chunks to avoid processing long document
revisions character by character. Independent edit preflight and readback checks
are retained.

See [Mac verification](mac-verification-0.7.24.md) for actual installed acceptance
and known limitations.
