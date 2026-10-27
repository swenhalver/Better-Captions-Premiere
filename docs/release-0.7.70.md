# S-Captions 0.7.70

Test build, includes 0.7.69.

- Diagnostics for the sentence editor's typing steps: a failed caption document write now logs its stage to the UXP log, and the panel keeps the underlying error of a failed merge.
- The typing test hook can continue an editor that is already open.
- History labels: merging typing steps no longer leaves a stale "Edit transcript" label for the next edit.
