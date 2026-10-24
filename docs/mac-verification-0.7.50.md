# macOS verification: 0.7.50

The native placement box no longer imposes either the unconditional layout rectangle or scrolling viewport CGContext clip. Directional rollUpAlpha masks only the selected edge; it no longer rejects pixels outside unrelated viewport edges. Explicit All four sides mode retains its authored crop/fade rectangle. Actual video-frame limits remain.

Core, raster and scrolling ASan/UBSan tests: all three passed in 21.88 seconds. Regression fixtures preserve glyph/background paint beyond all four sides of a 60 × 10 placement box and compare entire narrow/wide bitmaps. Explicit masks multiply the expected premultiplied pixels. The compiled Adobe adapter test also preserves exact full-frame pixels when a left/top anchored placement rectangle shrinks to 1 × 1; center/edge alignment remains functional. Full official SDK build passed.

JavaScript suite: 1,065 passed, two skipped, zero failed. Svelte: zero errors, zero warnings.

Installed UXP client files match the 0.7.50 CCX; installed native binary matches the SDK-built artifact. Native SHA-256: `56032bf86430162ecccbd7046dc0bb0dce182266482dc72427a9843dea1be823`. lsof confirms the reopened Premiere process loaded that installed native module.

Before update, exported the actual production frame 00:00:03:09 showing the flat cropped left of the green It background. After update/restart, the Program Monitor shows the complete rounded green background extending beyond that prior placement edge. Evidence: placement-box-before-installed.png and placement-box-after-program-monitor.png under artifacts/verification-nowrap-silence.

The MCP verification bridge did not reconnect after restart; Computer Use screenshot/input calls then timed out. Therefore no post-update QE export or backend sequence-graph reread is claimed. No test sequences were created or production caption parameters changed. Project was saved before restart; it remains open at the same sequence and displayed playhead 00:00:03:09. Saved project timestamp remains the pre-restart save time.

This correction targets the active native effect. Legacy generated-movie export remains separate: its cropped media bounds also define future logical guide dimensions and require a model/protocol migration before safe expansion. Canvas preview has no separate placement-box clipping operation.

Logs: /tmp/bc-50-native-tests-final.log,/tmp/bc-50-native-build-final.log,/tmp/bc-50-js-tests.log,/tmp/bc-50-check.log,/tmp/bc-50-install.log.
