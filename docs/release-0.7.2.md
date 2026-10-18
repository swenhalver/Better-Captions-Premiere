# Better Captions 0.7.2

Agent edits now preserve sentence-boundary markers. Previously, editing a caption or its position through the agent hooks could remove those markers, allowing a later Regroup to join sentences that lacked punctuation. The optional marker is preserved through caption validation, and invalid non-Boolean values are rejected.

This release includes 0.7.1's character-based caption grouping: a 56-character default, configurable from 1 to 500, with spaces and punctuation counted and whole words kept intact. Existing linked captions keep their boundaries, timing, media identities and native keyframes. Style presets preserve the destination character limit.

See [0.7.1's grouping details](release-0.7.1.md) and the [completed 0.7.0 native Mac preset checks](mac-verification-0.7.0.md). See [0.7.2 native Mac verification](mac-verification-0.7.2.md) for migration, grouping, agent-hook and preset acceptance, exact native-key preservation and remaining limits.

## Installation

Download the full `Better-Captions-Swen-0.7.2-Windows-macOS.zip`, extract it to a permanent folder, and run `node scripts/install.cjs`. Restart Premiere after upgrading. The same plugin identity preserves the preset library without uninstalling it. Requirements are unchanged from 0.7.1.
