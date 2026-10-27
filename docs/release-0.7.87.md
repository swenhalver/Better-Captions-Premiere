# 0.7.87 — Fill, Balance and Pretty line wrapping

Transcript > Caption grouping now offers three line-wrap modes. Fill retains greedy wrapping; Balance keeps Fill’s line count while evening line lengths; Pretty redistributes the last two lines to avoid short or single-word endings. Manual breaks, pause gaps and the existing 5.5-second line-duration limit constrain wrapping, and the panel and native effect share deterministic grouping.

Changing the mode reflows the document, forgetting merge joins and merge edges. A single Premiere Undo restores the previous mode and exact merged document; Redo reapplies them. Smart line fit works with all three modes. Wrap mode is a grouping setting and is excluded from style presets.

BCAP v11 appends one uint32 line-wrap enum after the existing style footer: Fill 0, Balance 1, Pretty 2. Older documents load as Fill.
