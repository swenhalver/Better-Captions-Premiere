# S-Captions 0.7.54

Fix automatic reconnection when a saved movie-caption session remains after the timeline has switched to a native S-Captions layer. Read-only discovery can complete while the old session has pending edits. It reconnects to an explicitly selected native layer, or the sole enabled native layer when no live movie captions or competing selection exist. The old movie session stays saved; the native layer's own transcript becomes the editor source.

After adopting a fully verified native document, the panel settles the obsolete output warning without replaying a failed render, setter or clip creation. Pending edits already belonging to a native layer remain protected. A stale movie overflow flag no longer appears against the reconnected native document.

Regression coverage exercises the actual component controller, pending saved edits, a previously unconfirmed movie render, startup without a selection, ambiguous targets and pending native edits.
