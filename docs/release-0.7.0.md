# Better Captions 0.7.0

Save named caption styles and reuse them across projects. This release builds on 0.6.0's native keyframe editor and retains its Position/Width/Height controls, protected easing and Undo/Redo behavior.

## Style presets

Open **Styling → Save preset…**, name the current look and save it. Choose a saved preset and **Apply**, then update the Program Monitor to render the change. **Manage…** provides rename, replace-with-current-style and delete, with confirmation before replacement or deletion.

A preset contains all three resolved word appearances (past, current, next), including type, stroke, shadow and word bubbles; shared layout and caption background; and animation with fades. Applying it preserves caption text, word timing, grouping, placement and native area/keyframes. Names are unique regardless of capitalization, and up to 200 presets can be stored.

The UXP panel saves presets in its own user-data folder using an atomic file replacement. This library is shared across Premiere projects on the same computer and survives panel/application restarts and upgrades under the same plugin identity. Corrupt files, denied access and stale saves produce visible errors instead of resetting the library. Presets are local; cloud synchronization and import/export are not included. The online preview uses its browser's local storage and labels that scope explicitly.

## Verification

- 352 local Windows tests passed outside the installer migration suite. That existing suite requires symbolic-link privileges unavailable in this desktop session; full Windows/macOS verification runs in the repository CI.
- New coverage exercises complete look capture, inheritance replacement, name collisions, scope preservation, native persistence, stale writers, file/storage failures, browser reopening, and the allowlisted UXP transport. Svelte validation reports zero errors and warnings.
- Browser interaction checks saved and reopened a preset, restored font size/italic/animation after changing them, renamed it, and rejected a duplicate name. Visual checks cover a 280px panel, a 480px panel and the user's 676px browser viewport.
- The inherited 0.6.0 keyframe editor was verified in Premiere Pro 26.5.2 on macOS; see [its acceptance notes](release-0.6.0.md). The new preset feature has automated native-storage/transport checks and browser verification, but has not yet been exercised inside Premiere on a Mac in this release session.

## Installation

Download the complete `Better-Captions-Swen-0.7.0-Windows-macOS.zip`, extract it into a permanent folder, then run `node scripts/install.cjs` from that folder. It contains both the UXP panel CCX and the matching invisible CEP renderer. Restart Premiere after installation and open **Window → UXP Plugins → Better Captions**.

Premiere Pro 26.3+, Creative Cloud Desktop, Node.js 24+, FFmpeg/FFprobe and macOS Fontconfig are required. The native runtime limitations documented for 0.6.0 still apply.
