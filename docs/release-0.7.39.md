# Better Captions 0.7.39 — stable scrolling during numeric drags

Numeric controls prevent pointer focus from scrolling the panel. Pointer-down
locks each enclosing scroll container at its current horizontal/vertical position
and suppresses wheel/touch scrolling during the gesture. Pointer-up, cancellation,
lost capture, window blur, disabling or unmounting releases the lock. Normal
click-to-type and keyboard adjustment remain available.
