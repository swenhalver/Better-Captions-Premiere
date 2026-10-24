# 0.7.85 — Reflow forgets merged lines

Characters per line and Smart line fit reflow the whole transcript, clearing merge joins and merge-created edge breaks while retaining scissors/caret splits and pause-line deletions. Document and limit changes share one Premiere Undo/Redo step.

BCAP v10 distinguishes temporary merge edges from manual breaks. Older documents treat a break directly adjoining a join run as a merge edge when reflowing.
