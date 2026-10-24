# 0.7.85 — Reflow forgets merged lines

Characters per line and Smart line fit reflow the whole transcript, clearing merge joins and merge-created edge breaks while retaining scissors/caret splits and pause-line deletions. Document and limit changes share one Premiere Undo/Redo step.

BCAP v10 distinguishes temporary merge edges from manual breaks. Older documents treat a break directly adjoining a join run as a merge edge when reflowing.

Installed and rebuilt native effect on 2026-10-23. Automated validation: 1,174 JavaScript tests passed, two skipped; Svelte reported zero errors/warnings; native CTest passed 3/3. Adobe reported Installation Successful, with exactly one S-Captions registration and one installed UXP folder.

Live verification found a preexisting blocker on a moved/trimmed layer: preserved caption times before sequence zero are rejected by generic transcript validation, preventing Merge and reflow. The original embedded document and all 107 native parameters remained identical. The next build corrects native timeline validation and groups a continuous character-limit gesture into one undo step before Part 1 acceptance is complete.
