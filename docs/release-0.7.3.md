# Better Captions 0.7.3

Unreleased development build. Source tests and packaging pass; Adobe's Windows installer blocks installed-plugin acceptance. See [verification and remaining work](windows-verification-0.7.3.md). The published and installed Mac 0.7.2 package remains unchanged.

Apply automatically chooses an empty track above footage or creates a new one. New captions share one physical timeline clip, with individually editable sentences and a character limit that can be regrouped after Apply. Deliberate transcript splits and contiguous native Razor cuts retain separate physical clips, identities, source times and native Motion curves.

Deleting a generated clip or its entire video track no longer leaves a stale-link error on full **Update Program Monitor**. It recreates captions from the saved transcript, grouping and style on an automatic track. Surviving linked clips keep their identities and native Motion; deleted clips receive fresh media and links. Recreation requires complete absence from the active sequence, is rechecked before native writes, and never runs during automatic partial reflow. Remaining Razor fragments, copied media and clips restored by Undo are protected.

Compatible legacy caption clips are converted to one clip. Static positions and independent sizes are represented by native hold keys. A replacement is staged and its geometry checked before all originals are removed in one non-ripple transaction. Unsupported legacy animation, effects, different source bounds, custom anchors/rotation, gaps, trims and reused media stop conversion with originals preserved.

Native Razor updates require forward 1x contiguous slices in original source order on one track. External/audio reuse, reordered, duplicated, gapped, trimmed or moved slices remain protected. Automatic discovery is bounded to 64 fragments and 2,000 project clips; geometry polling is bounded to 256 native Motion keys.

For development testing, build the complete Windows/macOS ZIP with `npm run package`, extract to a permanent folder, run `node scripts/install.cjs`, and restart Premiere after upgrading. The CCX alone does not include the companion render service. Existing plugin user data and presets remain under the same plugin identity. No 0.7.3 release should be published until the native checks below are complete.
