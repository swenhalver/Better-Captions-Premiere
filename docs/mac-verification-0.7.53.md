# S-Captions 0.7.53 — macOS verification

Verified in Premiere Pro 2026 26.5.2 against the existing Junk Your Vehicle project and UGC Video - 01 - All Clips sequence. Existing native carrier clip 000f42ec was reused; no new timeline clips or transcript migration were needed.

- Svelte check: zero errors and warnings. JavaScript: 1,073 passed, two skipped, zero failed.
- CTest: core, macOS rasterizer and scrolling-spacing tests passed (3/3). The strict core sanitizer suite and official Adobe SDK native build/adapter checks passed.
- Installed UXP 0.7.53 files match the CCX byte-for-byte. Installed native binary matches the official SDK build. The previous native bundle and service were backed up before replacement.
- Actual panel tab and native Effect Controls heading show S-Captions. Existing effect match name, parameter IDs, plugin IDs and saved paths are unchanged. Native creation tests exercise both renamed and older installed effect display names.
- The panel's primary Visible lines field and native Effect Controls both show 2. Earlier 0.7.52 verification exercised plugin 3→1 and native 1→2 automatic propagation. After this native install, all parameter descriptors, document revision and original 00:00:06:14 playhead matched the captured baseline exactly.
- Program Monitor at 00:00:04:12 shows the spoken caption. At 00:00:06:14 the same long silence that previously retained “It Hasn't Started In Months” now shows no caption: both visible rows have scrolled out. Source text/timing and authored controls are preserved. Evidence is in artifacts/verification-0.7.53.
- Final test-launch receipt reports ok:true, PID 64244, project window 21998 fully within S-Space at (-2560,1137,2560,1409), zero observed visible main-display windows, and foreground PID 24550 before and after. Adobe requested startup focus; the startup observer hid Premiere and immediately restored the prior foreground app. The launcher verifies actual reveal state because Adobe/AppKit can return false from unhide even when its window is visible.

The app-not-open system alert was triggered by querying the old Computer Use handle after quitting Premiere. Subsequent restarts send Quit and verify termination through process inventory, then bind the newly running app. No post-Quit stale-handle UI polling is used. The current Finder/system window inventory showed the alert absent.

These launch observations are sampled runtime evidence, not a guarantee against every transient Adobe/macOS focus request. The launcher retains physical-window checks and leaves an unsuccessful isolated launch hidden. It does not change the shared S-Space helper or ordinary Premiere startup preferences.

Cleanup: task S-Space app claims were released and inventory confirmed Premiere remained on S-Space. An optional final screenshot was blocked by the locked Mac; desktop control stopped and the Computer Use kernel was reset to discard stale handles. The available Computer Use API exposes no screen-capture release operation, so release of its separate capture could not be verified. The shared monitor and user apps were preserved. Mouse input used Codex Computer Use, with no BetterTouchTool clicking.
