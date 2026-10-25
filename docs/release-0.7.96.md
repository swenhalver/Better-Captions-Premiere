# 0.7.96: Scrubbing the timeline no longer shows read errors

Scrubbing or playing the timeline used to flash "Error: The playhead moved while reading native caption controls. Read them again." under Pause Line Length and the other native controls. The connection line could also show "The playhead moved while reading caption line fit."

These reads are now discarded quietly. Premiere's host reports a read whose playhead moved mid-sample as a recoverable `BC_NATIVE_STALE` read, and that code reaches the panel through both the CEP and UXP transports. The controls keep showing their last confirmed values and pick up fresh ones on the next scheduled read, either the playhead debounce or the regular poll. Expected busy or queued-read transport waits are handled the same way. Until a fresh read succeeds, the old clock is marked stale: an edit made in that time waits for the fresh read and never runs against the old playhead, and a keyframe arrow click takes one fresh read first. The connection poll skips its failure backoff for these reads and keeps the revision of a discarded document read, so it still follows Premiere Undo/Redo.

Writes, real connection or validation failures and unconfirmed changes still report their errors. The native effect is unchanged.
