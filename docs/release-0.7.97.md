# 0.7.97: Opening or switching sequences while scrubbing shows no read error

0.7.96 quieted playhead-race reads in the regular poll and the native controls, but the refresh that runs when the panel opens or the active sequence changes still showed "The playhead moved while reading caption line fit." if the playhead moved during its caption-layer read.

That refresh now treats the recoverable `BC_NATIVE_STALE` read as unfinished, not failed. The sequence stays marked as still discovering its caption layers, and the regular connection poll repeats the full refresh quietly until a read succeeds. That refresh restores the saved session, binds the native layer and records which output is already applied. A saved session restored by the first attempt is kept, so edits made in between are not reloaded over. Until discovery completes, live output does not write, the transcript import fallback does not run, and caption selection/motion following waits.

Other refresh failures still show their errors. The native effect is unchanged.
